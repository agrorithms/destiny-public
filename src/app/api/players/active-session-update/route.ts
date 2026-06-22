import { NextRequest, NextResponse } from 'next/server';
import { parseAndStoreActivity } from '@/lib/crawler/active-sessions';
import { buildActiveSessionPayload, enrichPartyMembersFromJson } from '@/lib/active-session/format';
import { isDatabaseMaintenanceError } from '@/lib/db';
import {
    deleteActiveSessionForPlayer,
    formatBungieDisplayName,
    getActiveSessionContainingPlayer,
    getActiveSessionForPlayer,
    getPlayerIdentity,
    upsertPlayer,
    type PlayerIdentity,
} from '@/lib/db/queries';
import { withNoStore } from '@/lib/http/cache';
import { getClientIp } from '@/lib/http/request-ip';
import type { DestinyProfileResponse } from '@/lib/bungie/types';

const validMembershipTypes = new Set([1, 2, 3, 5, 6]);

// Per-IP + per-player cooldown: at most one update per player per 30s from a given IP.
const PER_PLAYER_COOLDOWN_MS = 30_000;
const recentUpdate = new Map<string, number>();

// Reasonableness bounds for a session start time.
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;

interface UpdateBody {
    membershipId?: unknown;
    membershipType?: unknown;
    profileResponse?: unknown;
    privacyRestricted?: unknown;
}

function buildFallbackIdentity(membershipType: number, membershipId: string): PlayerIdentity {
    return {
        membershipId,
        membershipType,
        displayName: null,
        bungieGlobalDisplayName: null,
        bungieGlobalDisplayNameCode: null,
    };
}

function buildPlayerPayload(identity: PlayerIdentity) {
    return {
        membershipId: identity.membershipId,
        membershipType: identity.membershipType,
        displayName: formatBungieDisplayName(identity),
        baseName: identity.bungieGlobalDisplayName || identity.displayName || identity.membershipId,
    };
}

/**
 * A profile is "private" (incomplete) when the account is marked non-public, or when the
 * CharacterActivities (204) component is withheld (`privacy: 2`, no `data`). In that case we
 * can't read which activity they're in, so we fall back to DB / teammate resolution.
 */
function isProfilePrivate(profile: DestinyProfileResponse): boolean {
    if (profile.profile?.data?.userInfo?.isPublic === false) return true;
    const charActivities = profile.characterActivities;
    if (charActivities && !charActivities.data) return true;
    return false;
}

/**
 * Defense against fabricated timestamps: blank out any start time that is in the future
 * or older than 24h so parseAndStoreActivity stamps `now` instead. Activity-hash validity
 * is already governed by the raid manifest inside parseAndStoreActivity (same as the crawler).
 */
function sanitizeStartTimes(profileResponse: DestinyProfileResponse): void {
    const now = Date.now();
    const isReasonable = (iso?: string | null): boolean => {
        if (!iso) return false;
        const t = Date.parse(iso);
        if (Number.isNaN(t)) return false;
        return t <= now + MAX_FUTURE_SKEW_MS && t >= now - MAX_AGE_MS;
    };

    const charData = profileResponse.characterActivities?.data;
    if (charData) {
        for (const activity of Object.values(charData)) {
            if (activity && !isReasonable(activity.dateActivityStarted)) {
                activity.dateActivityStarted = '';
            }
        }
    }

    const currentActivity = profileResponse.profileTransitoryData?.data?.currentActivity;
    if (currentActivity && !isReasonable(currentActivity.startTime)) {
        currentActivity.startTime = '';
    }
}

// The client fetches its own Bungie profile (public key) and POSTs the raw response here.
// The server makes NO Bungie call — it only parses the supplied JSON, upserts identity +
// active session, and returns the enriched session for display.
export async function POST(request: NextRequest) {
    let body: UpdateBody;
    try {
        body = await request.json();
    } catch {
        return withNoStore(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }));
    }

    const membershipId = typeof body.membershipId === 'string' ? body.membershipId.trim() : '';
    const membershipType = Number(body.membershipType);
    const profileResponse = body.profileResponse;
    const privacyRestricted = body.privacyRestricted === true;

    if (!/^\d{1,20}$/.test(membershipId)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membershipId' }, { status: 400 }));
    }
    if (!validMembershipTypes.has(membershipType)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membershipType' }, { status: 400 }));
    }
    if (!privacyRestricted && (!profileResponse || typeof profileResponse !== 'object')) {
        return withNoStore(NextResponse.json({ error: 'Missing profileResponse' }, { status: 400 }));
    }

    // The cooldown gates only the write path (parsing a supplied profileResponse). The
    // privacyRestricted-flag request is a pure DB read (containing lookup) used by the
    // teammate-resolution re-check, so it must not be throttled.
    if (!privacyRestricted) {
        const ip = getClientIp(request);
        const rateKey = `${ip}:${membershipType}:${membershipId}`;
        const now = Date.now();
        const last = recentUpdate.get(rateKey);
        if (last !== undefined && now - last < PER_PLAYER_COOLDOWN_MS) {
            return withNoStore(NextResponse.json({ skipped: true, reason: 'recently_updated' }));
        }
        recentUpdate.set(rateKey, now);
    }

    try {
        // Account-wide privacy (client got a 1665 "No peeking" and sent the privacyRestricted
        // flag with no profileResponse). We can't read their session, so fall back to any
        // session that already contains them (from a teammate the crawler could see).
        if (privacyRestricted) {
            const identity = getPlayerIdentity(membershipId) || buildFallbackIdentity(membershipType, membershipId);
            const containing = getActiveSessionContainingPlayer(membershipId, 900);
            return withNoStore(NextResponse.json({
                updated: false,
                privacyRestricted: true,
                player: buildPlayerPayload(identity),
                activeSession: buildActiveSessionPayload(containing, identity, { enrichPartyMembers: true }),
            }));
        }

        const profile = profileResponse as DestinyProfileResponse;

        // Hydrate identity from component 100 (so untracked players become known).
        const userInfo = profile.profile?.data?.userInfo;
        if (userInfo?.membershipId) {
            upsertPlayer({
                membershipId: userInfo.membershipId,
                membershipType: userInfo.membershipType,
                displayName: userInfo.displayName,
                bungieGlobalDisplayName: userInfo.bungieGlobalDisplayName,
                bungieGlobalDisplayNameCode: userInfo.bungieGlobalDisplayNameCode,
            });
        }

        const identity = getPlayerIdentity(membershipId) || buildFallbackIdentity(membershipType, membershipId);

        sanitizeStartTimes(profile);

        const isPrivate = isProfilePrivate(profile);

        const result = parseAndStoreActivity(
            {
                membershipId,
                membershipType,
                displayName: identity.displayName || identity.bungieGlobalDisplayName || membershipId,
                bungieGlobalDisplayName: identity.bungieGlobalDisplayName || undefined,
                bungieGlobalDisplayNameCode: identity.bungieGlobalDisplayNameCode ?? undefined,
            },
            profile
        );

        // We could read their activity hash directly → store + show their own session.
        if (result.status === 'active') {
            const stored = getActiveSessionForPlayer(membershipId, 600);
            return withNoStore(NextResponse.json({
                updated: true,
                privacyRestricted: isPrivate,
                player: buildPlayerPayload(identity),
                activeSession: buildActiveSessionPayload(stored, identity, { enrichPartyMembers: true }),
            }));
        }

        // Inactive AND public → genuinely not in an activity: clear their session.
        if (!isPrivate) {
            deleteActiveSessionForPlayer(membershipId);
            return withNoStore(NextResponse.json({
                updated: true,
                player: buildPlayerPayload(identity),
                activeSession: null,
            }));
        }

        // Inactive AND private → we couldn't see their activity. Do NOT delete their session.
        // Fallback A: any stored session that already contains them (from a public teammate).
        const containing = getActiveSessionContainingPlayer(membershipId, 900);
        if (containing) {
            return withNoStore(NextResponse.json({
                updated: false,
                privacyRestricted: true,
                player: buildPlayerPayload(identity),
                activeSession: buildActiveSessionPayload(containing, identity, { enrichPartyMembers: true }),
            }));
        }

        // Fallback B: no stored session yet, but transitory shows them in a live fireteam.
        // Return a provisional card + resolvable teammate IDs so the browser can probe a
        // public member and resolve the real raid.
        const transitory = profile.profileTransitoryData?.data;
        const currentActivity = transitory?.currentActivity;
        if (currentActivity?.startTime) {
            const enrichedParty = enrichPartyMembersFromJson(
                JSON.stringify(transitory?.partyMembers ?? []),
                true
            );
            const candidateMembers = enrichedParty
                .filter((m) => m.membershipId !== membershipId && typeof m.membershipType === 'number')
                .slice(0, 4)
                .map((m) => ({ membershipId: m.membershipId, membershipType: m.membershipType as number }));

            return withNoStore(NextResponse.json({
                updated: false,
                privacyRestricted: true,
                player: buildPlayerPayload(identity),
                activeSession: null,
                provisionalSession: {
                    membershipId,
                    membershipType,
                    displayName: formatBungieDisplayName(identity),
                    activityHash: 0,
                    raidKey: 'unknown',
                    raidName: 'Activity in progress (details private)',
                    startedAt: currentActivity.startTime,
                    playerCount: currentActivity.numberOfPlayers || enrichedParty.length,
                    partyMembers: enrichedParty,
                },
                candidateMembers,
            }));
        }

        // Private, not in any activity.
        return withNoStore(NextResponse.json({
            updated: false,
            privacyRestricted: true,
            player: buildPlayerPayload(identity),
            activeSession: null,
        }));
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return withNoStore(NextResponse.json({ skipped: true, reason: 'maintenance' }, { status: 503 }));
        }
        console.error('[ERROR] active-session-update failed:', error);
        return withNoStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
    }
}
