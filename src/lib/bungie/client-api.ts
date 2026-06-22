// Browser-safe Bungie API client. Runs in the user's browser using a PUBLIC API key
// (NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY) so per-user, display-only calls never consume the
// server's private rate-limit budget (reserved for the crawler/scanner).
//
// IMPORTANT: This module must stay free of server-only imports (no better-sqlite3, no
// Node APIs, no private BUNGIE_API_KEY, no manifest cache). It only imports pure URL
// builders, pure search mappers, and types.
import { BungieEndpoints } from './endpoints';
import {
    filterByPartialCode,
    mapExactSearchResponseToPlayers,
    mapGlobalSearchResponseToPlayers,
    parseQuery,
} from './search-mapping';
import type {
    BungieResponse,
    DestinyExactPlayerSearchResponse,
    DestinyProfileResponse,
    DestinyUserSearchResponse,
    PlayerInfo,
} from './types';

export type ClientBungieErrorKind = 'rate_limited' | 'maintenance' | 'privacy' | 'network' | 'api';

export class ClientBungieError extends Error {
    kind: ClientBungieErrorKind;

    constructor(kind: ClientBungieErrorKind, message: string) {
        super(message);
        this.name = 'ClientBungieError';
        this.kind = kind;
    }
}

export function isClientBungieError(error: unknown): error is ClientBungieError {
    return error instanceof ClientBungieError;
}

/** Human-friendly message for a failed client Bungie call, for inline UI hints. */
export function describeClientBungieError(error: unknown): string {
    if (isClientBungieError(error)) {
        switch (error.kind) {
            case 'rate_limited':
                return 'Bungie is rate limiting requests — try again in a moment.';
            case 'maintenance':
                return 'Bungie API is under maintenance.';
            case 'privacy':
                return 'The user has chosen for this data to be private. Data may be incomplete';
            case 'network':
                return 'Could not reach Bungie. Check your connection.';
            default:
                return 'Bungie request failed.';
        }
    }
    return 'Bungie request failed.';
}

// Mirrors the server's isBungiePrivacyRestrictionError (src/lib/crawler/active-sessions.ts).
// An account-wide privacy restriction ("No peeking", ErrorCode 1665) fails the whole
// getProfile call — this is what drives the private-profile banner.
function isPrivacyResponse(json: { ErrorStatus?: string; ErrorCode?: number; Message?: string }): boolean {
    if (json.ErrorStatus === 'DestinyPrivacyRestriction') return true;
    if (json.ErrorCode !== undefined && [217, 1601, 1665].includes(json.ErrorCode)) return true;
    const message = json.Message || '';
    return message.includes('No peeking') || message.includes('chosen for this data to be private');
}

function getPublicApiKey(): string {
    const key = process.env.NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY;
    if (!key) {
        throw new ClientBungieError('api', 'NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY is not configured');
    }
    return key;
}

async function clientRequest<T>(url: string, init?: RequestInit): Promise<BungieResponse<T>> {
    let response: Response;
    try {
        response = await fetch(url, {
            ...init,
            headers: {
                'X-API-Key': getPublicApiKey(),
                ...init?.headers,
            },
        });
    } catch (error) {
        if (isClientBungieError(error)) throw error; // missing key
        throw new ClientBungieError('network', (error as Error)?.message || 'Network error');
    }

    if (response.status === 429) {
        throw new ClientBungieError('rate_limited', 'Bungie rate limit (HTTP 429)');
    }

    let json: BungieResponse<T> | null = null;
    try {
        json = (await response.json()) as BungieResponse<T>;
    } catch {
        throw new ClientBungieError('api', `Malformed Bungie response (HTTP ${response.status})`);
    }

    // Bungie wraps errors in the body with ErrorCode 1 = Success.
    if (json && json.ErrorCode !== undefined && json.ErrorCode !== 1) {
        if (json.ErrorStatus === 'SystemDisabled') {
            throw new ClientBungieError('maintenance', json.Message || 'Bungie SystemDisabled');
        }
        if (json.ErrorStatus === 'ThrottleLimitExceededMomentarily' || json.ThrottleSeconds > 0) {
            throw new ClientBungieError('rate_limited', json.Message || 'Bungie throttled');
        }
        if (isPrivacyResponse(json)) {
            throw new ClientBungieError('privacy', json.Message || 'Bungie privacy restriction');
        }
        throw new ClientBungieError('api', `${json.ErrorStatus}: ${json.Message}`);
    }

    if (!response.ok) {
        throw new ClientBungieError('api', `Bungie HTTP ${response.status}`);
    }

    return json as BungieResponse<T>;
}

/**
 * Fetch a player's profile with components 100 (identity), 204 (character activities),
 * and 1000 (transitory). One call serves both identity hydration and live-session status.
 * Returns the raw `.Response` payload — the server's active-session-update endpoint parses it.
 */
export async function fetchPlayerProfileClient(
    membershipType: number,
    membershipId: string
): Promise<DestinyProfileResponse> {
    const url = BungieEndpoints.getProfile(membershipType, membershipId, [100, 204, 1000]);
    const response = await clientRequest<DestinyProfileResponse>(url);
    return response.Response;
}

/**
 * Search Bungie for a player by Bungie name. Mirrors the (now-removed) server fallback:
 * exact lookup when a full 4-digit code is given, prefix search otherwise.
 */
export async function searchBungiePlayerClient(query: string): Promise<PlayerInfo[]> {
    const parsed = parseQuery(query);
    if (!parsed.baseName || parsed.baseName.length < 3) return [];

    if (parsed.exactCode !== null) {
        const url = BungieEndpoints.searchDestinyPlayerByBungieName(-1);
        const response = await clientRequest<DestinyExactPlayerSearchResponse>(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: parsed.baseName, displayNameCode: parsed.exactCode }),
        });
        return mapExactSearchResponseToPlayers(response);
    }

    const url = BungieEndpoints.searchByGlobalName(0);
    const response = await clientRequest<DestinyUserSearchResponse>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayNamePrefix: parsed.baseName }),
    });
    return filterByPartialCode(mapGlobalSearchResponseToPlayers(response), parsed);
}
