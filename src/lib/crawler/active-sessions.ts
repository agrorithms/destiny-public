import { getBungieClient, BungieAPIError } from '../bungie/client';
import { getRaidKeyFromHash, getRaidNameFromHash } from '../bungie/manifest';
import { deleteSessionsContainingPlayer, upsertActiveSession } from '../db/queries';
import { getDb } from '../db';
import { processWithConcurrency } from '../utils/concurrent';
import type { PlayerInfo, RaidSession } from '../bungie/types';

// How long before a session is considered "stale" and needs re-verification
const STALE_THRESHOLD_SECONDS = 300; // 5 minutes

// How long before a session is force-deleted even if re-verification fails
const MAX_SESSION_AGE_SECONDS = 7200; // 2 hours (no raid we want to show takes longer than this)

const DEFAULT_ACTIVE_SESSION_CONCURRENCY = Math.max(
    1,
    parseInt(process.env.ACTIVE_SESSION_CONCURRENCY || process.env.CRAWLER_CONCURRENCY || '4', 10)
);
const DEFAULT_STALE_SESSION_CONCURRENCY = Math.max(
    1,
    parseInt(process.env.ACTIVE_SESSION_STALE_CONCURRENCY || String(DEFAULT_ACTIVE_SESSION_CONCURRENCY), 10)
);
const DEFAULT_STALE_SESSION_REVERIFY_LIMIT = Math.max(
    1,
    parseInt(process.env.ACTIVE_SESSION_STALE_REVERIFY_LIMIT || '200', 10)
);

/**
 * Check if a player is currently in a raid activity and store the session.
 * Uses both Component 204 (CharacterActivities) and Component 1000 (Transitory).
 */
export async function checkPlayerActivity(
    player: PlayerInfo,
    clientOverride?: ReturnType<typeof getBungieClient>
): Promise<RaidSession | null> {
    const client = clientOverride || getBungieClient();

    try {
        const profile = await client.getProfile(
            player.membershipType,
            player.membershipId,
            [204, 1000]
        );

        // Authoritative online/activity signal: component 1000 (transitory).
        // If absent, treat as offline and clear any stored session for this player upstream.
        const transitory = profile.Response.profileTransitoryData?.data;
        if (!transitory) {
            return null;
        }

        // Use component 204 to get current activity metadata from the most recently started character activity.
        const charActivities = Object.values(profile.Response.characterActivities?.data || {}) as any[];
        charActivities.sort((a, b) => {
            const aTs = Date.parse(a?.dateActivityStarted || '') || 0;
            const bTs = Date.parse(b?.dateActivityStarted || '') || 0;
            return bTs - aTs;
        });
        const mostRecent = charActivities[0];

        const currentActivityHash = Number(
            mostRecent?.currentActivityHash
            || transitory.currentActivity?.currentActivityHash
            || 0
        );
        const currentActivityModeHash = Number(
            mostRecent?.currentActivityModeHash
            || transitory.currentActivity?.currentActivityModeHash
            || 0
        );
        const currentActivityModeType = Number(
            mostRecent?.currentActivityModeType
            || transitory.currentActivity?.currentActivityModeType
            || 0
        );

        const activityStartedAt =
            mostRecent?.dateActivityStarted
            || transitory.currentActivity?.startTime
            || null;

        // Some valid transitory states (for example in-orbit) report an activity hash
        // while omitting mode type. Keep these sessions instead of dropping them.
        if (!currentActivityHash) {
            return null;
        }

        const raidKey = getRaidKeyFromHash(currentActivityHash);
        const activityName = getRaidNameFromHash(currentActivityHash);

        // Get party members from Transitory if available
        const partyMembers = transitory?.partyMembers || [];

        let sessionKey: string;
        if (partyMembers.length > 0) {
            const sortedMemberIds = partyMembers
                .map((m: any) => m.membershipId)
                .sort()
                .join('-');
            sessionKey = `${currentActivityHash}-${sortedMemberIds}`;
        } else {
            sessionKey = `${currentActivityHash}-${player.membershipId}`;
        }

        const displayName = player.displayName || player.bungieGlobalDisplayName || 'Unknown';

        const effectivePartyMembers = partyMembers.length > 0
            ? partyMembers
            : [{ membershipId: player.membershipId, displayName, status: 1, emblemHash: 0 }];

        upsertActiveSession({
            membershipId: player.membershipId,
            membershipType: player.membershipType,
            displayName,
            activityHash: currentActivityHash,
            activityModeHash: currentActivityModeHash || null,
            activityModeType: currentActivityModeType || null,
            raidKey,
            startedAt: activityStartedAt || new Date().toISOString(),
            partyMembersJson: JSON.stringify(effectivePartyMembers),
            playerCount: effectivePartyMembers.length,
        });

        return {
            sessionKey,
            activityHash: currentActivityHash,
            raidName: activityName,
            raidKey: raidKey || 'unknown',
            players: effectivePartyMembers,
            startedAt: activityStartedAt || new Date().toISOString(),
            playerCount: effectivePartyMembers.length,
        };
    } catch (error) {
        if (error instanceof BungieAPIError) {
            if (
                error.errorStatus === 'DestinyPrivacyRestriction' ||
                error.errorCode === 217 ||
                error.errorCode === 1601
            ) {
                return null;
            }
        }
        console.error(`[ERROR] Unexpected error checking activity for ${player.membershipId}:`, (error as Error).message);
        return null;
    }
}

/**
 * Re-verify stale sessions before deleting them.
 * Checks if players in stale sessions are still in a raid.
 * If yes, refreshes their checked_at timestamp.
 * If no, removes the session.
 */
export async function refreshStaleSessions(): Promise<{
    refreshed: number;
    removed: number;
}> {
    return refreshStaleSessionsWithOptions();
}

export async function refreshStaleSessionsWithOptions(options?: {
    concurrency?: number;
    limit?: number;
}): Promise<{
    refreshed: number;
    removed: number;
}> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const concurrency = Math.max(1, options?.concurrency || DEFAULT_STALE_SESSION_CONCURRENCY);
    const limit = Math.max(1, options?.limit || DEFAULT_STALE_SESSION_REVERIFY_LIMIT);
    const client = getBungieClient();

    // Find sessions that are stale (not checked recently) but not ancient
    const staleSessions = db.prepare(`
    SELECT 
      membership_id,
      membership_type,
      display_name,
      activity_hash,
      started_at,
      checked_at
    FROM active_sessions
    WHERE checked_at < ?
      AND checked_at >= ?
    ORDER BY checked_at ASC
    LIMIT ?
  `).all(
        now - STALE_THRESHOLD_SECONDS,
        now - MAX_SESSION_AGE_SECONDS,
        limit
    ) as any[];

    if (staleSessions.length === 0) {
        return { refreshed: 0, removed: 0 };
    }

    console.log(`[SESSIONS] Re-verifying ${staleSessions.length} stale sessions...`);

    const results = await processWithConcurrency(
        staleSessions,
        concurrency,
        async (session) => {
            const player: PlayerInfo = {
                membershipId: session.membership_id,
                membershipType: session.membership_type,
                displayName: session.display_name,
            };

            const result = await checkPlayerActivity(player, client);

            if (!result) {
                deleteSessionsContainingPlayer(session.membership_id);
                return false;
            }

            return true;
        }
    );

    let refreshed = 0;
    let removed = 0;
    for (const result of results) {
        if (!result.success) continue;
        if (result.result) {
            refreshed++;
        } else {
            removed++;
        }
    }

    // Force-delete anything older than MAX_SESSION_AGE_SECONDS regardless
    const ancientDeleted = db.prepare(
        'DELETE FROM active_sessions WHERE checked_at < ?'
    ).run(now - MAX_SESSION_AGE_SECONDS);

    if (ancientDeleted.changes > 0) {
        console.log(`[SESSIONS] Force-deleted ${ancientDeleted.changes} sessions older than ${MAX_SESSION_AGE_SECONDS / 60} minutes`);
        removed += ancientDeleted.changes;
    }

    console.log(`[SESSIONS] Re-verification complete: ${refreshed} refreshed, ${removed} removed`);

    return { refreshed, removed };
}

/**
 * Check a batch of players for active raid sessions.
 * Also re-verifies stale sessions before cleaning them up.
 */
export async function pollActiveSessions(
    players: PlayerInfo[],
    maxToCheck: number = 200,
    options?: {
        playerCheckConcurrency?: number;
        staleCheckConcurrency?: number;
        staleReverifyLimit?: number;
    }
): Promise<RaidSession[]> {
    const playerCheckConcurrency = Math.max(
        1,
        options?.playerCheckConcurrency || DEFAULT_ACTIVE_SESSION_CONCURRENCY
    );
    const staleCheckConcurrency = Math.max(
        1,
        options?.staleCheckConcurrency || DEFAULT_STALE_SESSION_CONCURRENCY
    );
    const staleReverifyLimit = Math.max(
        1,
        options?.staleReverifyLimit || DEFAULT_STALE_SESSION_REVERIFY_LIMIT
    );

    const toCheck = players.slice(0, maxToCheck);
    const sessions = new Map<string, RaidSession>();
    const client = getBungieClient();

    // Step 1: Re-verify stale sessions instead of blindly deleting
    await refreshStaleSessionsWithOptions({
        concurrency: staleCheckConcurrency,
        limit: staleReverifyLimit,
    });

    // Step 2: Check new players for active sessions
    const sessionResults = await processWithConcurrency(
        toCheck,
        playerCheckConcurrency,
        async (player) => checkPlayerActivity(player, client),
        (checked, total) => {
            if (checked % 50 === 0 || checked === total) {
                console.log(`[SESSIONS] Checked ${checked}/${total} players...`);
            }
        }
    );

    let checked = 0;
    for (const result of sessionResults) {
        if (!result.success) continue;
        checked++;
        const session = result.result;
        if (session && !sessions.has(session.sessionKey)) {
            sessions.set(session.sessionKey, session);
        }
    }

    console.log(
        `[SESSIONS] Active session poll complete: ${checked}/${toCheck.length} players checked, ${sessions.size} sessions found`
    );

    return [...sessions.values()];
}
