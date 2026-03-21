import { NextRequest, NextResponse } from 'next/server';
import { getAllRaidDefinitions, getRaidNameFromHash } from '@/lib/bungie/manifest';
import { getDiscoveryBungieClient } from '@/lib/bungie/client';
import { runConcurrentDiscovery } from '@/lib/discovery/snowball-concurrent';
import { checkPlayerActivity } from '@/lib/crawler/active-sessions';
import { getDb } from '@/lib/db';
import {
    deleteSessionsContainingPlayer,
    getPlayerIdentity,
    getPlayerRaidCompletionSummary,
    getPlayerRecentCompletions,
    getActiveSessionForPlayer,
    upsertPlayer,
} from '@/lib/db/queries';
import { getActivityDisplayName } from '@/lib/utils/activity';

const refreshInFlight = new Map<string, Promise<void>>();
const recentRefresh = new Map<string, number>();
const validMembershipTypes = new Set([1, 2, 3, 5, 6]);

function formatDisplayName(player: {
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
    membershipId: string;
}): string {
    if (player.bungieGlobalDisplayName && player.bungieGlobalDisplayNameCode !== null) {
        return `${player.bungieGlobalDisplayName}#${String(player.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }
    return player.bungieGlobalDisplayName || player.displayName || player.membershipId;
}

function isLikelyMembershipId(str: string): boolean {
    return /^\d{16,}$/.test(str);
}

async function ensurePlayerIdentity(membershipType: number, membershipId: string) {
    let identity = getPlayerIdentity(membershipId);
    if (identity) return identity;

    const client = getDiscoveryBungieClient();
    const profile = await client.getProfile(membershipType, membershipId, [100]);
    const userInfo = profile.Response.profile?.data?.userInfo;

    if (!userInfo) {
        throw new Error('Player profile unavailable');
    }

    upsertPlayer({
        membershipId: userInfo.membershipId,
        membershipType: userInfo.membershipType,
        displayName: userInfo.displayName,
        bungieGlobalDisplayName: userInfo.bungieGlobalDisplayName,
        bungieGlobalDisplayNameCode: userInfo.bungieGlobalDisplayNameCode,
    });

    identity = getPlayerIdentity(membershipId);
    if (!identity) {
        throw new Error('Player not found after upsert');
    }

    return identity;
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
        const identity = await ensurePlayerIdentity(membershipType, membershipId);
        const discoveryClient = getDiscoveryBungieClient();

        await runConcurrentDiscovery(
            [{ membershipId, membershipType }],
            {
                maxDepth: 1,
                maxPlayers: 120,
                hoursBack: 48,
                concurrency: Math.min(parseInt(process.env.DISCOVERY_CONCURRENCY || '5', 10), 5),
            }
        );

        await checkPlayerActivity({
            membershipId,
            membershipType,
            displayName: identity.displayName || identity.bungieGlobalDisplayName || membershipId,
            bungieGlobalDisplayName: identity.bungieGlobalDisplayName || undefined,
            bungieGlobalDisplayNameCode: identity.bungieGlobalDisplayNameCode ?? undefined,
        }, discoveryClient);

        recentRefresh.set(key, Date.now());
    })();

    refreshInFlight.set(key, refreshPromise);

    try {
        await refreshPromise;
    } finally {
        refreshInFlight.delete(key);
    }
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

    const hours = parseInt(request.nextUrl.searchParams.get('hours') || '48', 10);
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';

    if (hours < 1 || hours > 48) {
        return NextResponse.json({ error: 'hours must be between 1 and 48' }, { status: 400 });
    }

    try {
        await ensurePlayerIdentity(membershipType, membershipId);

        if (refresh) {
            try {
                await refreshPlayerData(membershipType, membershipId);
            } catch (error) {
                console.error('[WARN] Player refresh failed:', error);
            }
        }

        const identity = await ensurePlayerIdentity(membershipType, membershipId);
        const discoveryClient = getDiscoveryBungieClient();

        const liveSession = await checkPlayerActivity({
            membershipId,
            membershipType,
            displayName: identity.displayName || identity.bungieGlobalDisplayName || membershipId,
            bungieGlobalDisplayName: identity.bungieGlobalDisplayName || undefined,
            bungieGlobalDisplayNameCode: identity.bungieGlobalDisplayNameCode ?? undefined,
        }, discoveryClient);

        if (!liveSession) {
            deleteSessionsContainingPlayer(membershipId);
        }

        const summary = getPlayerRaidCompletionSummary(membershipId, hours);
        const recentCompletions = getPlayerRecentCompletions(membershipId, hours, 100);
        const activeSession = getActiveSessionForPlayer(membershipId, 600);
        const raids = getAllRaidDefinitions();

        let partyMembers: any[] = [];
        if (activeSession?.partyMembersJson) {
            try {
                partyMembers = JSON.parse(activeSession.partyMembersJson);
            } catch {
                partyMembers = [];
            }
        }

        if (partyMembers.length > 0) {
            const db = getDb();
            const ids = [...new Set(
                partyMembers
                    .map((m: any) => String(m?.membershipId || ''))
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
              `).all(...ids) as any[];

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

            partyMembers = partyMembers.map((member: any) => {
                const id = String(member?.membershipId || '');
                const knownName = nameMap.get(id);
                const fallbackApiName = member?.displayName && !isLikelyMembershipId(member.displayName)
                    ? member.displayName
                    : null;

                return {
                    ...member,
                    membershipId: id,
                    membershipType: member?.membershipType ?? typeMap.get(id),
                    displayName: knownName || fallbackApiName || id,
                };
            });
        }

        return NextResponse.json({
            player: {
                membershipId: identity.membershipId,
                membershipType: identity.membershipType,
                displayName: formatDisplayName(identity),
                baseName: identity.bungieGlobalDisplayName || identity.displayName || identity.membershipId,
            },
            hours,
            summary: summary.map((row) => ({
                raidKey: row.raidKey,
                raidName: raids[row.raidKey]?.name || row.raidKey,
                completions: row.completions,
            })),
            recentCompletions: recentCompletions.map((row) => ({
                instanceId: row.instanceId,
                raidKey: row.raidKey,
                raidName: getRaidNameFromHash(row.activityHash),
                completedAt: new Date(row.period * 1000).toISOString(),
                period: row.period,
            })),
            activeSession: activeSession
                ? {
                    membershipId: activeSession.membershipId,
                    membershipType: activeSession.membershipType,
                    displayName: formatDisplayName(identity),
                    activityHash: activeSession.activityHash,
                    activityModeHash: activeSession.activityModeHash,
                    activityModeType: activeSession.activityModeType,
                    raidKey: activeSession.raidKey,
                    raidName: getActivityDisplayName(activeSession.activityHash, activeSession.activityModeType),
                    startedAt: activeSession.startedAt,
                    playerCount: activeSession.playerCount,
                    partyMembers,
                    checkedAt: activeSession.checkedAt,
                }
                : null,
        });
    } catch (error) {
        console.error('[ERROR] Player profile query failed:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
