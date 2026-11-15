import { NextRequest, NextResponse } from 'next/server';
import { getAllRaidDefinitions, getRaidNameFromHash } from '@/lib/bungie/manifest';
import { isDatabaseMaintenanceError } from '@/lib/db';
import {
    getPlayerIdentity,
    getPlayerRaidPerformanceStats,
    getPlayerRaidTeammateSummary,
    getPlayerRecentCompletions,
    getActiveSessionContainingPlayer,
    getActiveSessionForPlayer,
    type PlayerIdentity,
} from '@/lib/db/queries';
import { buildActiveSessionPayload } from '@/lib/active-session/format';
import { toProfilePlayer } from '@/lib/active-session/live-profile';
import { isMembershipId } from '@/lib/active-session/roster';
import { withCache, withNoStore } from '@/lib/http/cache';

const validMembershipTypes = new Set([1, 2, 3, 5, 6]);

function buildFallbackIdentity(membershipType: number, membershipId: string): PlayerIdentity {
    return {
        membershipId,
        membershipType,
        displayName: null,
        bungieGlobalDisplayName: null,
        bungieGlobalDisplayNameCode: null,
    };
}

function buildPlayerPayload(identity: PlayerIdentity | null, membershipType: number, membershipId: string) {
    if (!identity) {
        return buildFallbackPlayerPayload(membershipType, membershipId);
    }

    return toProfilePlayer(identity);
}

function buildFallbackPlayerPayload(membershipType: number, membershipId: string) {
    return {
        membershipId,
        membershipType,
        displayName: membershipId,
        baseName: membershipId,
    };
}

function buildMaintenancePayload(
    membershipType: number,
    membershipId: string,
    hours: number,
    activeOnly: boolean
) {
    const player = buildFallbackPlayerPayload(membershipType, membershipId);

    if (activeOnly) {
        return {
            maintenance: true,
            message: 'Database maintenance is in progress. Player details are temporarily unavailable.',
            player,
            activeSession: null,
            privacyRestricted: false,
        };
    }

    return {
        maintenance: true,
        message: 'Database maintenance is in progress. Player details are temporarily unavailable.',
        player,
        hours,
        summary: [],
        recentCompletions: [],
        teammates: [],
        activeSession: null,
        privacyRestricted: false,
    };
}

// This route is a pure SQLite read with ZERO Bungie API calls. Live activity and names for
// untracked players come from the browser's own Bungie calls (public key) and stay in that
// browser — see src/lib/active-session/live-profile.ts and ADR 0010. That keeps the server's
// Bungie API budget reserved for the crawler/scanner.
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ membershipType: string; membershipId: string }> }
) {
    const { membershipType: membershipTypeRaw, membershipId } = await context.params;
    const membershipType = parseInt(membershipTypeRaw, 10);

    // Digits only: the containing-session read searches each stored Roster for this id.
    if (!isMembershipId(membershipId) || Number.isNaN(membershipType)) {
        return withNoStore(NextResponse.json({ error: 'Invalid player identity' }, { status: 400 }));
    }
    if (!validMembershipTypes.has(membershipType)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membership type' }, { status: 400 }));
    }

    const part = request.nextUrl.searchParams.get('part');
    const activeOnly = part === 'active';
    const hours = parseInt(request.nextUrl.searchParams.get('hours') || '48', 10);

    if (!activeOnly && (hours < 1 || hours > 720)) {
        return withNoStore(NextResponse.json({ error: 'hours must be between 1 and 720' }, { status: 400 }));
    }

    try {
        const identity = getPlayerIdentity(membershipId);
        const identityForSession = identity || buildFallbackIdentity(membershipType, membershipId);

        // Fast-path for profile header rendering: last-known active session from the DB.
        if (activeOnly) {
            // containing=1: session that includes this player as a party member (stored via a
            // public teammate). Used for privacy-restricted (1665) players whose own profile
            // the browser can't read — a pure DB read.
            if (request.nextUrl.searchParams.get('containing') === '1') {
                const containing = getActiveSessionContainingPlayer(membershipId, 900);
                return withNoStore(NextResponse.json({
                    player: buildPlayerPayload(identity, membershipType, membershipId),
                    activeSession: buildActiveSessionPayload(containing, identityForSession, {
                        enrichPartyMembers: true,
                    }),
                }));
            }

            const enrichRequested = request.nextUrl.searchParams.get('enrich') === '1';
            const cachedSession = getActiveSessionForPlayer(membershipId, 600);
            return withNoStore(NextResponse.json({
                player: buildPlayerPayload(identity, membershipType, membershipId),
                activeSession: buildActiveSessionPayload(cachedSession, identityForSession, {
                    enrichPartyMembers: enrichRequested,
                }),
                privacyRestricted: false,
            }));
        }

        const summary = getPlayerRaidPerformanceStats(membershipId, hours);
        const recentCompletions = getPlayerRecentCompletions(membershipId, hours, 500);
        const teammates = getPlayerRaidTeammateSummary(membershipId, hours);
        const activeSession = getActiveSessionForPlayer(membershipId, 600);
        const raids = getAllRaidDefinitions();

        const response = NextResponse.json({
            player: buildPlayerPayload(identity, membershipType, membershipId),
            hours,
            summary: summary.map((row) => ({
                raidKey: row.raidKey,
                raidName: raids[row.raidKey]?.name || row.raidKey,
                completions: row.completions,
                avgCompletionSeconds: row.avgCompletionSeconds,
                fastestClearSeconds: row.fastestClearSeconds,
                dnfRate: row.dnfRate,
                kills: row.kills,
                deaths: row.deaths,
                assists: row.assists,
                kda: row.kda,
            })),
            recentCompletions: recentCompletions.map((row) => ({
                instanceId: row.instanceId,
                raidKey: row.raidKey,
                raidName: getRaidNameFromHash(row.activityHash),
                completedAt: new Date(row.endedAt * 1000).toISOString(),
                period: row.period,
                timePlayedSeconds: row.timePlayedSeconds,
            })),
            teammates: teammates.map((row) => ({
                raidKey: row.raidKey,
                raidName: raids[row.raidKey]?.name || row.raidKey,
                teammateMembershipId: row.teammateMembershipId,
                teammateMembershipType: row.teammateMembershipType,
                teammateDisplayName: row.teammateDisplayName,
                completions: row.completions,
                avgCompletionSeconds: row.avgCompletionSeconds,
            })),
            activeSession: buildActiveSessionPayload(activeSession, identityForSession, {
                enrichPartyMembers: true,
            }),
            privacyRestricted: false,
        });

        return withCache(response, 15, 60);
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return withNoStore(NextResponse.json(buildMaintenancePayload(membershipType, membershipId, hours, activeOnly)));
        }

        console.error('[ERROR] Player profile query failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
