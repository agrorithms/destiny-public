import { NextRequest, NextResponse } from 'next/server';
import { getDiscoveryBungieClient } from '@/lib/bungie/client';
import { bulkUpsertPlayers, formatBungieDisplayName, searchPlayersByName } from '@/lib/db/queries';
import type { BungieResponse, DestinyUserSearchResponse, PlayerInfo } from '@/lib/bungie/types';
import { withCache, withNoStore } from '@/lib/http/cache';

const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 5, 6]);

function parseQuery(query: string): { baseName: string; code?: number } {
    const match = query.trim().match(/^(.+?)#(\d{1,4})$/);
    if (!match) {
        return { baseName: query.trim() };
    }

    return {
        baseName: match[1].trim(),
        code: parseInt(match[2], 10),
    };
}

function mapResponseToPlayers(rawResponse: BungieResponse<DestinyUserSearchResponse>): PlayerInfo[] {
    const raw = rawResponse?.Response;
    const rows = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.searchResults)
            ? raw.searchResults
            : [];

    const players: PlayerInfo[] = [];

    for (const row of rows) {
        const memberships = Array.isArray(row?.destinyMemberships)
            ? row.destinyMemberships
            : [row];

        for (const member of memberships) {
            const membershipId = String(member?.membershipId || '');
            const membershipType = Number(member?.membershipType);

            if (!membershipId || !VALID_MEMBERSHIP_TYPES.has(membershipType)) {
                continue;
            }

            const bungieName = row?.bungieGlobalDisplayName || member?.bungieGlobalDisplayName;
            const bungieCodeRaw = row?.bungieGlobalDisplayNameCode ?? member?.bungieGlobalDisplayNameCode;
            const bungieCode = bungieCodeRaw !== undefined && bungieCodeRaw !== null
                ? Number(bungieCodeRaw)
                : undefined;

            players.push({
                membershipId,
                membershipType,
                displayName: member?.displayName || bungieName || membershipId,
                bungieGlobalDisplayName: bungieName || undefined,
                bungieGlobalDisplayNameCode: Number.isFinite(bungieCode as number) ? bungieCode : undefined,
            });
        }
    }

    return players;
}

async function runBungieFallbackSearch(query: string): Promise<PlayerInfo[]> {
    const { baseName, code } = parseQuery(query);
    if (!baseName || baseName.length < 2) return [];

    const client = getDiscoveryBungieClient();
    const response = await client.searchByBungieNamePrefix(baseName, 0);
    let candidates = mapResponseToPlayers(response);

    if (code !== undefined) {
        const normalizedCode = Number(String(code).padStart(4, '0'));
        candidates = candidates.filter((player) => {
            const playerName = (player.bungieGlobalDisplayName || player.displayName || '').toLowerCase();
            const playerCode = player.bungieGlobalDisplayNameCode;
            return playerName === baseName.toLowerCase() && playerCode === normalizedCode;
        });
    }

    const deduped = new Map<string, PlayerInfo>();
    for (const player of candidates) {
        deduped.set(player.membershipId, player);
    }

    return [...deduped.values()];
}

export async function GET(request: NextRequest) {
    const query = (request.nextUrl.searchParams.get('query') || '').trim();
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '8', 10), 1), 20);

    if (query.length < 2) {
        return withCache(NextResponse.json({ query, results: [] }), 30, 60);
    }

    try {
        let localResults = searchPlayersByName(query, limit);

        // Only fall back to the Bungie API when local results come up empty.
        // If the player is already in the DB (including with a full Name#Code), trust it.
        const shouldFallback = localResults.length === 0;
        if (shouldFallback) {
            try {
                const discovered = await runBungieFallbackSearch(query);
                if (discovered.length > 0) {
                    bulkUpsertPlayers(discovered);
                    localResults = searchPlayersByName(query, limit);
                }
            } catch (error) {
                console.error('[WARN] Bungie fallback search failed:', error);
            }
        }

        const lowerQuery = query.toLowerCase();
        const nameOnly = parseQuery(query).baseName.toLowerCase();

        const results = localResults.map((row) => {
            const baseName = row.bungieGlobalDisplayName || row.displayName || '';
            const fullName = formatBungieDisplayName(row);
            // secondaryDisplayName is strictly the platform name (display_name field).
            // This is the PSN ID / Xbox gamertag / Steam name shown under the primary result.
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

        return withCache(NextResponse.json({ query, results }), 30, 60);
    } catch (error) {
        console.error('[ERROR] Player search failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
