import { NextRequest, NextResponse } from 'next/server';
import { getAllRaidDefinitions, getRaidNameFromHash } from '@/lib/bungie/manifest';
import { getDiscoveryBungieClient } from '@/lib/bungie/client';
import { runConcurrentDiscovery } from '@/lib/discovery/snowball-concurrent';
import { checkPlayerActivity } from '@/lib/crawler/active-sessions';
import { getDb } from '@/lib/db';
import {
    type ActiveSessionDbRow,
    deleteActiveSessionForPlayer,
    formatBungieDisplayName,
    hasCompleteBungieDisplayName,
    getPlayerIdentity,
    getPlayerRaidCompletionSummary,
    getPlayerRaidTeammateSummary,
    getPlayerRecentCompletions,
    getActiveSessionForPlayer,
    type PlayerIdentity,
    upsertPlayer,
} from '@/lib/db/queries';
import { getActivityDisplayName } from '@/lib/utils/activity';

const refreshInFlight = new Map<string, Promise<void>>();
const activeVerifyInFlight = new Map<string, Promise<void>>();
const identityFetchInFlight = new Map<string, Promise<PlayerIdentity | null>>();
const recentRefresh = new Map<string, number>();
const validMembershipTypes = new Set([1, 2, 3, 5, 6]);

interface PartyMemberInput {
    membershipId?: string;
    membershipType?: number;
    displayName?: string;
    status?: number;
}

interface PartyMemberOutput extends Record<string, unknown> {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    status?: number;
}

interface PlayerLookupRow {
    membership_id: string;
    membership_type: number;
    bungie_global_display_name: string | null;
    bungie_global_display_name_code: number | null;
    display_name: string | null;
}

function isLikelyMembershipId(str: string): boolean {
    return /^\d{16,}$/.test(str);
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

async function resolvePlayerIdentity(membershipType: number, membershipId: string): Promise<PlayerIdentity | null> {
    const cachedIdentity = getPlayerIdentity(membershipId);
    if (cachedIdentity && hasCompleteBungieDisplayName(cachedIdentity)) {
        return cachedIdentity;
    }

    const key = `${membershipType}:${membershipId}`;
    const existing = identityFetchInFlight.get(key);
    if (existing) {
        return existing;
    }

    const fetchPromise = (async () => {
        try {
            const client = getDiscoveryBungieClient();
            const profile = await client.getProfile(membershipType, membershipId, [100]);
            const userInfo = profile.Response.profile?.data?.userInfo;

            if (!userInfo) {
                return cachedIdentity;
            }

            upsertPlayer({
                membershipId: userInfo.membershipId,
                membershipType: userInfo.membershipType,
                displayName: userInfo.displayName,
                bungieGlobalDisplayName: userInfo.bungieGlobalDisplayName,
                bungieGlobalDisplayNameCode: userInfo.bungieGlobalDisplayNameCode,
            });

            return getPlayerIdentity(membershipId) || cachedIdentity;
        } catch (error) {
            console.warn('[WARN] Bungie identity lookup failed:', error);
            return cachedIdentity;
        }
    })();

    identityFetchInFlight.set(key, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        identityFetchInFlight.delete(key);
    }
}

function buildPlayerPayload(identity: PlayerIdentity | null, membershipType: number, membershipId: string) {
    if (!identity) {
        return buildFallbackPlayerPayload(membershipType, membershipId);
    }

    return {
        membershipId: identity.membershipId,
        membershipType: identity.membershipType,
        displayName: formatBungieDisplayName(identity),
        baseName: identity.bungieGlobalDisplayName || identity.displayName || identity.membershipId,
    };
}

async function refreshPlayerData(membershipType: number, membershipId: string): Promise<void> {
    const key = `${membershipType}:${membershipId}`;
    const now = Date.now();
    const lastRefreshAt = recentRefresh.get(key) || 0;

    if (now - lastRefreshAt < 30_000) {
        return;
    }

    const existing = refreshInFlight.get(key);
    if (existing) {
        await existing;
        return;
    }

    const refreshPromise = (async () => {
        const identity = await resolvePlayerIdentity(membershipType, membershipId);
        const identityForSession = identity || buildFallbackIdentity(membershipType, membershipId);

        await runConcurrentDiscovery(
            [{ membershipId, membershipType }],
            {
                maxDepth: 1,
                maxPlayers: 120,
                hoursBack: 48,
                concurrency: Math.min(parseInt(process.env.DISCOVERY_CONCURRENCY || '5', 10), 5),
            }
        );

        await verifyActiveSession(membershipType, membershipId, identityForSession);

        recentRefresh.set(key, Date.now());
    })();

    refreshInFlight.set(key, refreshPromise);

    try {
        await refreshPromise;
    } finally {
        refreshInFlight.delete(key);
    }
}

async function verifyActiveSession(membershipType: number, membershipId: string, identity?: {
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
}): Promise<void> {
    const key = `${membershipType}:${membershipId}`;
    const existing = activeVerifyInFlight.get(key);
    if (existing) {
        await existing;
        return;
    }

    const verifyPromise = (async () => {
        const discoveryClient = getDiscoveryBungieClient();
        const liveSession = await checkPlayerActivity({
            membershipId,
            membershipType,
            displayName: identity?.displayName || identity?.bungieGlobalDisplayName || membershipId,
            bungieGlobalDisplayName: identity?.bungieGlobalDisplayName || undefined,
            bungieGlobalDisplayNameCode: identity?.bungieGlobalDisplayNameCode ?? undefined,
        }, discoveryClient);

        if (!liveSession) {
            deleteActiveSessionForPlayer(membershipId);
        }
    })();

    activeVerifyInFlight.set(key, verifyPromise);
    try {
        await verifyPromise;
    } finally {
        activeVerifyInFlight.delete(key);
    }
}

function buildFallbackPlayerPayload(membershipType: number, membershipId: string) {
    return {
        membershipId,
        membershipType,
        displayName: membershipId,
        baseName: membershipId,
    };
}

function enrichPartyMembersFromJson(partyMembersJson?: string, enrich: boolean = true): PartyMemberOutput[] {
    let partyMembers: PartyMemberInput[] = [];
    if (partyMembersJson) {
        try {
            const parsed: unknown = JSON.parse(partyMembersJson);
            if (Array.isArray(parsed)) {
                partyMembers = parsed
                    .filter((value) => !!value && typeof value === 'object')
                    .map((value) => value as PartyMemberInput);
            }
        } catch {
            partyMembers = [];
        }
    }

    if (partyMembers.length === 0) {
        return [];
    }

    if (!enrich) {
        return partyMembers.map((member) => {
            const id = String(member?.membershipId || '');
            const fallbackApiName = member?.displayName && !isLikelyMembershipId(member.displayName)
                ? member.displayName
                : null;
            const baseMember = member as Record<string, unknown>;

            return {
                ...baseMember,
                membershipId: id,
                displayName: fallbackApiName || id,
            };
        });
    }

    const db = getDb();
    const ids = [...new Set(
        partyMembers
            .map((m) => String(m?.membershipId || ''))
            .filter(Boolean)
    )];

    const nameMap = new Map<string, string>();
    const typeMap = new Map<string, number>();

    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT
              membership_id,
              membership_type,
              bungie_global_display_name,
              bungie_global_display_name_code,
              display_name
            FROM players
            WHERE membership_id IN (${placeholders})
          `).all(...ids) as PlayerLookupRow[];

        for (const row of rows) {
            typeMap.set(row.membership_id, row.membership_type);
            if (row.bungie_global_display_name && row.bungie_global_display_name_code !== null) {
                nameMap.set(
                    row.membership_id,
                    `${row.bungie_global_display_name}#${String(row.bungie_global_display_name_code).padStart(4, '0')}`
                );
            } else if (row.bungie_global_display_name) {
                nameMap.set(row.membership_id, row.bungie_global_display_name);
            } else if (row.display_name) {
                nameMap.set(row.membership_id, row.display_name);
            }
        }
    }

    return partyMembers.map((member) => {
        const id = String(member?.membershipId || '');
        const knownName = nameMap.get(id);
        const fallbackApiName = member?.displayName && !isLikelyMembershipId(member.displayName)
            ? member.displayName
            : null;
        const baseMember = member as Record<string, unknown>;

        return {
            ...baseMember,
            membershipId: id,
            membershipType: member?.membershipType ?? typeMap.get(id),
            displayName: knownName || fallbackApiName || id,
        };
    });
}

function buildActiveSessionPayload(activeSession: ActiveSessionDbRow | null, identity: {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
}, options?: { enrichPartyMembers?: boolean }) {
    if (!activeSession) return null;
    const partyMembers = enrichPartyMembersFromJson(
        activeSession.partyMembersJson,
        options?.enrichPartyMembers ?? true
    );

    return {
        membershipId: activeSession.membershipId,
        membershipType: activeSession.membershipType,
        displayName: formatBungieDisplayName(identity),
        activityHash: activeSession.activityHash,
        activityModeHash: activeSession.activityModeHash,
        activityModeType: activeSession.activityModeType,
        raidKey: activeSession.raidKey,
        raidName: getActivityDisplayName(
            activeSession.activityHash,
            activeSession.activityModeType,
            activeSession.activityModeHash
        ),
        startedAt: activeSession.startedAt,
        playerCount: activeSession.playerCount,
        partyMembers,
        checkedAt: activeSession.checkedAt,
    };
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ membershipType: string; membershipId: string }> }
) {
    const { membershipType: membershipTypeRaw, membershipId } = await context.params;
    const membershipType = parseInt(membershipTypeRaw, 10);

    if (!membershipId || Number.isNaN(membershipType)) {
        return NextResponse.json({ error: 'Invalid player identity' }, { status: 400 });
    }
    if (!validMembershipTypes.has(membershipType)) {
        return NextResponse.json({ error: 'Invalid membership type' }, { status: 400 });
    }

    const part = request.nextUrl.searchParams.get('part');
    const activeOnly = part === 'active';
    const hours = parseInt(request.nextUrl.searchParams.get('hours') || '48', 10);
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';

    if (!activeOnly && (hours < 1 || hours > 48)) {
        return NextResponse.json({ error: 'hours must be between 1 and 48' }, { status: 400 });
    }

    try {
        // Fast-path for profile header rendering: check/update active session only.
        if (activeOnly) {
            const verify = request.nextUrl.searchParams.get('verify') === '1';
            const enrichRequested = request.nextUrl.searchParams.get('enrich') === '1';
            const identity = await resolvePlayerIdentity(membershipType, membershipId);
            const identityForSession = identity || buildFallbackIdentity(membershipType, membershipId);
            const playerPayload = buildPlayerPayload(identity, membershipType, membershipId);

            if (!verify) {
                const cachedSession = getActiveSessionForPlayer(membershipId, 600);
                return NextResponse.json({
                    player: playerPayload,
                    activeSession: buildActiveSessionPayload(cachedSession, identityForSession, {
                        enrichPartyMembers: enrichRequested,
                    }),
                });
            }

            await verifyActiveSession(membershipType, membershipId, identityForSession);
            const activeSession = getActiveSessionForPlayer(membershipId, 600);
            return NextResponse.json({
                player: playerPayload,
                activeSession: buildActiveSessionPayload(activeSession, identityForSession, {
                    enrichPartyMembers: true,
                }),
            });
        }

        const identity = await resolvePlayerIdentity(membershipType, membershipId);
        const identityForSession = identity || buildFallbackIdentity(membershipType, membershipId);

        if (refresh) {
            try {
                await refreshPlayerData(membershipType, membershipId);
            } catch (error) {
                console.error('[WARN] Player refresh failed:', error);
            }
        }

        await verifyActiveSession(membershipType, membershipId, identityForSession);

        const summary = getPlayerRaidCompletionSummary(membershipId, hours);
        const recentCompletions = getPlayerRecentCompletions(membershipId, hours, 100);
        const teammates = getPlayerRaidTeammateSummary(membershipId, hours);
        const activeSession = getActiveSessionForPlayer(membershipId, 600);
        const raids = getAllRaidDefinitions();

        return NextResponse.json({
            player: buildPlayerPayload(identity, membershipType, membershipId),
            hours,
            summary: summary.map((row) => ({
                raidKey: row.raidKey,
                raidName: raids[row.raidKey]?.name || row.raidKey,
                completions: row.completions,
                avgCompletionSeconds: row.avgCompletionSeconds,
            })),
            recentCompletions: recentCompletions.map((row) => ({
                instanceId: row.instanceId,
                raidKey: row.raidKey,
                raidName: getRaidNameFromHash(row.activityHash),
                completedAt: new Date((row.period + row.timePlayedSeconds) * 1000).toISOString(),
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
        });
    } catch (error) {
        console.error('[ERROR] Player profile query failed:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
