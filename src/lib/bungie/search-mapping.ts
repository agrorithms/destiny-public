// Pure helpers for parsing Bungie player-search responses. No DB, no Node, no server
// state — safe to import from both server routes and browser (client-api) code.
import type {
    BungieResponse,
    DestinyExactPlayerSearchResponse,
    DestinyUserSearchMembership,
    DestinyUserSearchResponse,
    PlayerInfo,
} from './types';

export const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 5, 6]);

export interface ParsedSearchQuery {
    baseName: string;
    partialCode: string | null;
    exactCode: number | null;
}

export function parseQuery(query: string): ParsedSearchQuery {
    const trimmed = query.trim();
    const hashIndex = trimmed.indexOf('#');

    if (hashIndex === -1) {
        return { baseName: trimmed, partialCode: null, exactCode: null };
    }

    const baseName = trimmed.slice(0, hashIndex).trim();
    const suffix = trimmed.slice(hashIndex + 1);
    const partialCode = /^\d{1,3}$/.test(suffix) ? suffix : null;
    const exactCode = /^\d{4}$/.test(suffix) ? parseInt(suffix, 10) : null;

    return { baseName, partialCode, exactCode };
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

export function dedupePlayers(players: PlayerInfo[]): PlayerInfo[] {
    const deduped = new Map<string, PlayerInfo>();
    for (const player of players) {
        deduped.set(player.membershipId, player);
    }
    return [...deduped.values()];
}

export function mapGlobalSearchResponseToPlayers(
    rawResponse: BungieResponse<DestinyUserSearchResponse>
): PlayerInfo[] {
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

export function mapExactSearchResponseToPlayers(
    rawResponse: BungieResponse<DestinyExactPlayerSearchResponse>
): PlayerInfo[] {
    const rows = Array.isArray(rawResponse?.Response) ? rawResponse.Response : [];
    const primaryMembership = selectPrimaryMembership(rows, rows[0]);
    const player = primaryMembership ? memberToPlayer(primaryMembership, primaryMembership) : null;

    return player ? [player] : [];
}

export function filterByPartialCode(players: PlayerInfo[], parsed: ParsedSearchQuery): PlayerInfo[] {
    if (!parsed.partialCode) return players;

    const lowerBaseName = parsed.baseName.toLowerCase();
    return players.filter((player) => {
        const playerName = (player.bungieGlobalDisplayName || player.displayName || '').toLowerCase();
        const playerCode = player.bungieGlobalDisplayNameCode;
        if (playerName !== lowerBaseName || playerCode === undefined) return false;

        return String(playerCode).padStart(4, '0').startsWith(parsed.partialCode as string);
    });
}
