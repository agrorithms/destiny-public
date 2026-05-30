import { NextRequest, NextResponse } from 'next/server';
import { BungieAPIError, getDiscoveryBungieClient } from '@/lib/bungie/client';
import { isBungieSystemDisabledError } from '@/lib/bungie/maintenance';
import { bulkUpsertPlayers, formatBungieDisplayName, searchPlayersByName } from '@/lib/db/queries';
import type {
    BungieResponse,
    DestinyExactPlayerSearchResponse,
    DestinyUserSearchMembership,
    DestinyUserSearchResponse,
    PlayerInfo,
} from '@/lib/bungie/types';
import type { PlayerSearchResult } from '@/lib/db/queries';
import { withNoStore } from '@/lib/http/cache';

const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 5, 6]);
const configuredFallbackCacheTtlMs = parseInt(process.env.BUNGIE_SEARCH_FALLBACK_CACHE_TTL_MS || '15000', 10);
const FALLBACK_CACHE_TTL_MS = Number.isFinite(configuredFallbackCacheTtlMs)
    ? Math.max(configuredFallbackCacheTtlMs, 1000)
    : 15000;

interface ParsedSearchQuery {
    baseName: string;
    partialCode: string | null;
    exactCode: number | null;
}

interface SearchResponseResult {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
    secondaryDisplayName: string;
    isExactFullMatch: boolean;
    isExactNameMatch: boolean;
}

const fallbackCache = new Map<string, { expiresAt: number; promise: Promise<PlayerInfo[]> }>();

function parseQuery(query: string): ParsedSearchQuery {
    const trimmed = query.trim();
    const hashIndex = trimmed.indexOf('#');

    if (hashIndex === -1) {
        return {
            baseName: trimmed,
            partialCode: null,
            exactCode: null,
        };
    }

    const baseName = trimmed.slice(0, hashIndex).trim();
    const suffix = trimmed.slice(hashIndex + 1);
    const partialCode = /^\d{1,3}$/.test(suffix) ? suffix : null;
    const exactCode = /^\d{4}$/.test(suffix) ? parseInt(suffix, 10) : null;

    return {
        baseName,
        partialCode,
        exactCode,
    };
}

function isValidMembership(member: DestinyUserSearchMembership): boolean {
    return Boolean(member?.membershipId) && VALID_MEMBERSHIP_TYPES.has(Number(member?.membershipType));
}

function selectPrimaryMembership(
    memberships: DestinyUserSearchMembership[],
    owner?: DestinyUserSearchMembership
): DestinyUserSearchMembership | null {
    const validMemberships = memberships.filter(isValidMembership);
    if (validMemberships.length === 0) return null;

    const crossSaveOverride = Number(
        owner?.crossSaveOverride
        || validMemberships.find((member) => Number(member.crossSaveOverride) > 0)?.crossSaveOverride
    );
    if (VALID_MEMBERSHIP_TYPES.has(crossSaveOverride)) {
        const crossSavePrimary = validMemberships.find(
            (member) => Number(member.membershipType) === crossSaveOverride
        );
        if (crossSavePrimary) return crossSavePrimary;
    }

    const applicablePrimary = validMemberships.find((member) => {
        const applicable = member.applicableMembershipTypes;
        return Array.isArray(applicable)
            && applicable.length > 0
            && applicable.includes(Number(member.membershipType));
    });

    return applicablePrimary || validMemberships[0];
}

function memberToPlayer(
    member: DestinyUserSearchMembership,
    owner?: DestinyUserSearchMembership
): PlayerInfo | null {
    const membershipId = String(member?.membershipId || '');
    const membershipType = Number(member?.membershipType);

    if (!membershipId || !VALID_MEMBERSHIP_TYPES.has(membershipType)) {
        return null;
    }

    const bungieName = owner?.bungieGlobalDisplayName || member?.bungieGlobalDisplayName;
    const bungieCodeRaw = owner?.bungieGlobalDisplayNameCode ?? member?.bungieGlobalDisplayNameCode;
    const bungieCode = bungieCodeRaw !== undefined && bungieCodeRaw !== null
        ? Number(bungieCodeRaw)
        : undefined;

    return {
        membershipId,
        membershipType,
        displayName: member?.displayName || bungieName || membershipId,
        bungieGlobalDisplayName: bungieName || undefined,
        bungieGlobalDisplayNameCode: Number.isFinite(bungieCode as number) ? bungieCode : undefined,
    };
}

function mapGlobalSearchResponseToPlayers(rawResponse: BungieResponse<DestinyUserSearchResponse>): PlayerInfo[] {
    const raw = rawResponse?.Response;
    const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.searchResults)
            ? raw.searchResults
            : [];

    const players: PlayerInfo[] = [];

    for (const row of rows) {
        const memberships = Array.isArray(row?.destinyMemberships) ? row.destinyMemberships : [];
        const primaryMembership = selectPrimaryMembership(memberships, row);
        if (!primaryMembership) continue;

        const player = memberToPlayer(primaryMembership, row);
        if (player) players.push(player);
    }

    return dedupePlayers(players);
}

function mapExactSearchResponseToPlayers(
    rawResponse: BungieResponse<DestinyExactPlayerSearchResponse>
): PlayerInfo[] {
    const rows = Array.isArray(rawResponse?.Response) ? rawResponse.Response : [];
    const primaryMembership = selectPrimaryMembership(rows, rows[0]);
    const player = primaryMembership ? memberToPlayer(primaryMembership, primaryMembership) : null;

    return player ? [player] : [];
}

function dedupePlayers(players: PlayerInfo[]): PlayerInfo[] {
    const deduped = new Map<string, PlayerInfo>();
    for (const player of players) {
        deduped.set(player.membershipId, player);
    }
    return [...deduped.values()];
}

function filterByPartialCode(players: PlayerInfo[], parsed: ParsedSearchQuery): PlayerInfo[] {
    if (!parsed.partialCode) return players;

    const lowerBaseName = parsed.baseName.toLowerCase();
    return players.filter((player) => {
        const playerName = (player.bungieGlobalDisplayName || player.displayName || '').toLowerCase();
        const playerCode = player.bungieGlobalDisplayNameCode;
        if (playerName !== lowerBaseName || playerCode === undefined) return false;

        return String(playerCode).padStart(4, '0').startsWith(parsed.partialCode as string);
    });
}

async function runBungieFallbackSearch(parsed: ParsedSearchQuery): Promise<PlayerInfo[]> {
    if (!parsed.baseName || parsed.baseName.length < 3) return [];

    const client = getDiscoveryBungieClient();

    if (parsed.exactCode !== null) {
        const response = await client.searchDestinyPlayerByBungieName(parsed.baseName, parsed.exactCode, -1);
        return mapExactSearchResponseToPlayers(response);
    }

    const response = await client.searchByBungieNamePrefix(parsed.baseName, 0);
    return filterByPartialCode(mapGlobalSearchResponseToPlayers(response), parsed);
}

function getFallbackCacheKey(parsed: ParsedSearchQuery): string {
    const baseName = parsed.baseName.toLowerCase();
    if (parsed.exactCode !== null) return `exact:${baseName}#${String(parsed.exactCode).padStart(4, '0')}`;

    return `prefix:${baseName}#${parsed.partialCode || ''}`;
}

function getCachedBungieFallback(parsed: ParsedSearchQuery): Promise<PlayerInfo[]> {
    const now = Date.now();
    const key = getFallbackCacheKey(parsed);
    const cached = fallbackCache.get(key);

    if (cached && cached.expiresAt > now) {
        return cached.promise;
    }

    const promise = runBungieFallbackSearch(parsed).catch((error) => {
        fallbackCache.delete(key);
        throw error;
    });

    fallbackCache.set(key, {
        expiresAt: now + FALLBACK_CACHE_TTL_MS,
        promise,
    });

    return promise;
}

function formatResults(query: string, localResults: PlayerSearchResult[]): SearchResponseResult[] {
    const lowerQuery = query.toLowerCase();
    const nameOnly = parseQuery(query).baseName.toLowerCase();

    return localResults.map((row) => {
        const baseName = row.bungieGlobalDisplayName || row.displayName || '';
        const fullName = formatBungieDisplayName(row);
        const secondaryDisplayName = row.displayName || row.membershipId;

        return {
            membershipId: row.membershipId,
            membershipType: row.membershipType,
            displayName: fullName,
            baseName,
            secondaryDisplayName,
            isExactFullMatch: fullName.toLowerCase() === lowerQuery,
            isExactNameMatch: baseName.toLowerCase() === nameOnly,
        };
    });
}

function hasExactFullMatch(query: string, localResults: PlayerSearchResult[]): boolean {
    const lowerQuery = query.toLowerCase();
    return localResults.some((row) => formatBungieDisplayName(row).toLowerCase() === lowerQuery);
}

function isResolvableAccountError(error: unknown): boolean {
    return error instanceof BungieAPIError && error.errorCode === 217;
}

export async function GET(request: NextRequest) {
    const query = (request.nextUrl.searchParams.get('query') || '').trim();
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '8', 10), 1), 20);
    const fallbackRequested = request.nextUrl.searchParams.get('fallback') === '1';

    if (query.length < 2) {
        return withNoStore(NextResponse.json({ query, results: [] }));
    }

    try {
        const parsed = parseQuery(query);
        let localResults = searchPlayersByName(query, limit);
        let fallbackUnavailable = false;
        let message: string | undefined;

        const shouldFallback = fallbackRequested
            && parsed.baseName.length >= 3
            && !hasExactFullMatch(query, localResults);
        if (shouldFallback) {
            try {
                const discovered = await getCachedBungieFallback(parsed);
                if (discovered.length > 0) {
                    bulkUpsertPlayers(discovered);
                    localResults = searchPlayersByName(query, limit);
                }
            } catch (error) {
                if (isBungieSystemDisabledError(error)) {
                    fallbackUnavailable = true;
                    message = 'Bungie search unavailable';
                } else if (!isResolvableAccountError(error)) {
                    console.error('[WARN] Bungie fallback search failed:', error);
                }
            }
        }

        const results = formatResults(query, localResults);

        return withNoStore(NextResponse.json({
            query,
            results,
            fallbackUnavailable,
            message,
        }));
    } catch (error) {
        console.error('[ERROR] Player search failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
