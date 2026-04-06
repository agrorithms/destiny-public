import { getDb } from './index';
import type { PlayerInfo, LeaderboardEntry } from '../bungie/types';

const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 5, 6]);
type RunnableStatement = {
    run: (...params: unknown[]) => unknown;
};
type SqlValue = string | number | null;

let playerUpsertDbRef: ReturnType<typeof getDb> | null = null;
let playerUpsertStmt: RunnableStatement | null = null;
let bulkUpsertPlayersTx: ((players: PlayerInfo[]) => void) | null = null;

let pgcrInsertDbRef: ReturnType<typeof getDb> | null = null;
let insertPGCRStmt: RunnableStatement | null = null;
let insertPGCRPlayerStmt: RunnableStatement | null = null;
let insertFullPGCRTx: ((pgcrData: InsertFullPGCRData, players: InsertFullPGCRPlayer[]) => void) | null = null;

function isValidMembershipType(type: unknown): boolean {
    return VALID_MEMBERSHIP_TYPES.has(Number(type));
}

function getPlayerUpsertResources(): {
    upsertStmt: RunnableStatement;
    bulkTx: (players: PlayerInfo[]) => void;
} {
    const db = getDb();

    if (!playerUpsertStmt || !bulkUpsertPlayersTx || playerUpsertDbRef !== db) {
        playerUpsertDbRef = db;
        playerUpsertStmt = db.prepare(`
    INSERT INTO players (membership_id, membership_type, display_name, bungie_global_display_name, bungie_global_display_name_code)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(membership_id) DO UPDATE SET
      display_name = excluded.display_name,
      bungie_global_display_name = COALESCE(excluded.bungie_global_display_name, bungie_global_display_name),
      bungie_global_display_name_code = COALESCE(excluded.bungie_global_display_name_code, bungie_global_display_name_code)
  `) as unknown as RunnableStatement;

        const stmt = playerUpsertStmt;
        if (!stmt) {
            throw new Error('Failed to initialize player upsert statement');
        }
        bulkUpsertPlayersTx = db.transaction((players: PlayerInfo[]) => {
            let skipped = 0;
            const invalidSamples: string[] = [];
            const SAMPLE_LIMIT = 5;
            for (const p of players) {
                if (!isValidMembershipType(p.membershipType)) {
                    skipped += 1;
                    if (invalidSamples.length < SAMPLE_LIMIT && Number(p.membershipType) !== 0) {
                        invalidSamples.push(`${p.membershipId}(${String(p.membershipType)})`);
                    }
                    continue;
                }

                stmt.run(
                    p.membershipId,
                    p.membershipType,
                    p.displayName,
                    p.bungieGlobalDisplayName || null,
                    p.bungieGlobalDisplayNameCode || null
                );
            }
            if (skipped > 0) {
                const sampleSuffix = invalidSamples.length > 0
                    ? ` | samples: ${invalidSamples.join(', ')}`
                    : '';
                console.log(`  ⚠️ Skipped ${skipped} players with invalid membership types${sampleSuffix}`);
            }
        });
    }

    if (!playerUpsertStmt || !bulkUpsertPlayersTx) {
        throw new Error('Failed to initialize player upsert resources');
    }

    return {
        upsertStmt: playerUpsertStmt,
        bulkTx: bulkUpsertPlayersTx,
    };
}


// =====================
// PLAYER QUERIES
// =====================

export function upsertPlayer(player: PlayerInfo): void {
    const { upsertStmt } = getPlayerUpsertResources();
    upsertStmt.run(
        player.membershipId,
        player.membershipType,
        player.displayName,
        player.bungieGlobalDisplayName || null,
        player.bungieGlobalDisplayNameCode || null
    );
}

export function bulkUpsertPlayers(players: PlayerInfo[]): void {
    const { bulkTx } = getPlayerUpsertResources();
    bulkTx(players);
}

export function getSessionPollingCandidateLimit(limit: number): number {
    const configuredCandidateLimit = parseInt(
        process.env.CRAWLER_SESSION_POLLING_CANDIDATE_LIMIT || '',
        10
    );
    const defaultCandidateLimit = Math.max(limit * 4, 400);

    if (Number.isFinite(configuredCandidateLimit) && configuredCandidateLimit > 0) {
        return Math.max(configuredCandidateLimit, limit);
    }

    return defaultCandidateLimit;
}

/**
 * Get players most likely to be online for active session polling.
 * Prioritizes:
 *   1. Players who were recently seen in a PGCR (active raiders)
 *   2. Players who were recently discovered (fresh in the system)
 *   3. Seed players / high priority players
 */
export function getPlayersForSessionPolling(limit: number = 200): PlayerInfo[] {
    const db = getDb();
    const recentWindowSeconds = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);
    const candidateLimit = getSessionPollingCandidateLimit(limit);

    // Strategy: Get players who appeared in recent PGCRs (last 6 hours)
    // These are the most likely to still be online and raiding
    const recentlyActive = db.prepare(`
    WITH recent_players AS (
      SELECT
        pp.membership_id as membershipId,
        MAX(pg.period + d.pgcrDurationSeconds) as lastSeenPeriod
      FROM pgcr_players pp
      INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
      INNER JOIN (
        SELECT
          instance_id,
          MAX(time_played_seconds) as pgcrDurationSeconds
        FROM pgcr_players
        WHERE completed = 1
        GROUP BY instance_id
      ) d ON d.instance_id = pg.instance_id
      WHERE (pg.period + d.pgcrDurationSeconds) >= ?
      GROUP BY pp.membership_id
      ORDER BY lastSeenPeriod DESC
      LIMIT ?
    )
    SELECT
      p.membership_id as membershipId,
      p.membership_type as membershipType,
      p.display_name as displayName,
      p.bungie_global_display_name as bungieGlobalDisplayName
    FROM recent_players rp
    INNER JOIN players p ON p.membership_id = rp.membershipId
    LEFT JOIN active_sessions s ON s.membership_id = rp.membershipId
    WHERE p.is_active = 1
    ORDER BY COALESCE(s.checked_at, 0) ASC, rp.lastSeenPeriod DESC
    LIMIT ?
  `).all(
        recentWindowSeconds,
        candidateLimit,
        limit
    ) as PlayerInfo[];

    if (recentlyActive.length >= limit) {
        return recentlyActive;
    }

    // If we don't have enough recently active players,
    // fill the rest with high-priority and recently discovered players
    const existingIds = new Set(recentlyActive.map((p) => p.membershipId));
    const remaining = limit - recentlyActive.length;

    const fallback = db.prepare(`
    SELECT
      p.membership_id as membershipId,
      p.membership_type as membershipType,
      p.display_name as displayName,
      p.bungie_global_display_name as bungieGlobalDisplayName
    FROM players p
    LEFT JOIN active_sessions s ON s.membership_id = p.membership_id
    WHERE p.is_active = 1
    ORDER BY COALESCE(s.checked_at, 0) ASC, priority DESC, discovered_at DESC
    LIMIT ?
  `).all(remaining + existingIds.size) as PlayerInfo[];

    // Merge without duplicates
    for (const player of fallback) {
        if (!existingIds.has(player.membershipId) && recentlyActive.length < limit) {
            recentlyActive.push(player);
            existingIds.add(player.membershipId);
        }
    }

    return recentlyActive;
}


export function getPlayersToCrawl(limit: number = 50): PlayerInfo[] {
    const db = getDb();
    return db.prepare(`
    SELECT 
      membership_id as membershipId, 
      membership_type as membershipType,
      display_name as displayName, 
      bungie_global_display_name as bungieGlobalDisplayName,
      last_crawled_at as lastCrawledAt
    FROM players
    WHERE is_active = 1
    ORDER BY priority DESC, last_crawled_at ASC
    LIMIT ?
  `).all(limit) as PlayerInfo[];
}

export function updateLastCrawled(membershipId: string): void {
    const db = getDb();
    db.prepare(`
    UPDATE players SET last_crawled_at = unixepoch() WHERE membership_id = ?
  `).run(membershipId);
}

export function getPlayerCount(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number } | undefined;
    return row?.count ?? 0;
}

export interface PlayerSearchResult {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
}

export function searchPlayersByName(query: string, limit: number = 10): PlayerSearchResult[] {
    const db = getDb();
    const normalized = query.trim().toLowerCase();
    const nameOnly = normalized.includes('#') ? normalized.split('#')[0] : normalized;

    if (!nameOnly) return [];

    const rows = db.prepare(`
    SELECT
      membership_id as membershipId,
      membership_type as membershipType,
      display_name as displayName,
      bungie_global_display_name as bungieGlobalDisplayName,
      bungie_global_display_name_code as bungieGlobalDisplayNameCode
    FROM players
    WHERE LOWER(COALESCE(bungie_global_display_name, display_name, '')) LIKE ?
    ORDER BY discovered_at DESC
    LIMIT 100
  `).all(`%${nameOnly}%`) as PlayerSearchResult[];

    const withRank = rows.map((row) => {
        const baseName = (row.bungieGlobalDisplayName || row.displayName || '').toLowerCase();
        const fullName = row.bungieGlobalDisplayName && row.bungieGlobalDisplayNameCode !== null
            ? `${row.bungieGlobalDisplayName}#${String(row.bungieGlobalDisplayNameCode).padStart(4, '0')}`.toLowerCase()
            : '';

        let rank = 4;
        if (fullName && fullName === normalized) rank = 0;
        else if (baseName === nameOnly) rank = 1;
        else if (baseName.startsWith(nameOnly)) rank = 2;
        else if (baseName.includes(nameOnly)) rank = 3;

        return { row, rank };
    });

    withRank.sort((a, b) => a.rank - b.rank);

    return withRank.slice(0, limit).map((x) => x.row);
}

export interface PlayerIdentity {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
}

export function getPlayerIdentity(membershipId: string): PlayerIdentity | null {
    const db = getDb();
    const row = db.prepare(`
    SELECT
      membership_id as membershipId,
      membership_type as membershipType,
      display_name as displayName,
      bungie_global_display_name as bungieGlobalDisplayName,
      bungie_global_display_name_code as bungieGlobalDisplayNameCode
    FROM players
    WHERE membership_id = ?
  `).get(membershipId) as PlayerIdentity | undefined;

    return row || null;
}

export interface PlayerRaidCompletionSummary {
    raidKey: string;
    completions: number;
    avgCompletionSeconds: number | null;
}

export function getPlayerRaidCompletionSummary(
    membershipId: string,
    hoursBack: number
): PlayerRaidCompletionSummary[] {
    const db = getDb();
    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    return db.prepare(`
    WITH run_durations AS (
      SELECT
        instance_id,
        MAX(time_played_seconds) as pgcrDurationSeconds
      FROM pgcr_players
      WHERE completed = 1
      GROUP BY instance_id
    )
    SELECT
      p.raid_key as raidKey,
      COUNT(DISTINCT pp.instance_id) as completions,
      CAST(ROUND(AVG(d.pgcrDurationSeconds)) AS INTEGER) as avgCompletionSeconds
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    JOIN run_durations d ON d.instance_id = p.instance_id
    WHERE pp.membership_id = ?
      AND (p.period + d.pgcrDurationSeconds) >= ?
      AND pp.completed = 1
      AND p.completed = 1
      AND p.raid_key IS NOT NULL
      AND p.activity_was_started_from_beginning = 1
    GROUP BY p.raid_key
    ORDER BY completions DESC, p.raid_key ASC
  `).all(membershipId, cutoffTimestamp) as PlayerRaidCompletionSummary[];
}

export interface PlayerRecentCompletion {
    instanceId: string;
    raidKey: string | null;
    period: number;
    activityHash: number;
    timePlayedSeconds: number;
}

export function getPlayerRecentCompletions(
    membershipId: string,
    hoursBack: number,
    limit: number = 100
): PlayerRecentCompletion[] {
    const db = getDb();
    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    return db.prepare(`
    WITH run_durations AS (
      SELECT
        instance_id,
        MAX(time_played_seconds) as pgcrDurationSeconds
      FROM pgcr_players
      WHERE completed = 1
      GROUP BY instance_id
    )
    SELECT
      p.instance_id as instanceId,
      p.raid_key as raidKey,
      p.period as period,
      p.activity_hash as activityHash,
      d.pgcrDurationSeconds as timePlayedSeconds
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    JOIN run_durations d ON d.instance_id = p.instance_id
    WHERE pp.membership_id = ?
      AND (p.period + d.pgcrDurationSeconds) >= ?
      AND pp.completed = 1
      AND p.completed = 1
      AND p.raid_key IS NOT NULL
      AND p.activity_was_started_from_beginning = 1
    ORDER BY (p.period + d.pgcrDurationSeconds) DESC
    LIMIT ?
  `).all(membershipId, cutoffTimestamp, limit) as PlayerRecentCompletion[];
}

export interface PlayerRaidTeammateSummary {
    raidKey: string;
    teammateMembershipId: string;
    teammateMembershipType: number;
    teammateDisplayName: string;
    completions: number;
    avgCompletionSeconds: number | null;
}

export function getPlayerRaidTeammateSummary(
    membershipId: string,
    hoursBack: number
): PlayerRaidTeammateSummary[] {
    const db = getDb();
    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    return db.prepare(`
    WITH run_durations AS (
      SELECT
        instance_id,
        MAX(time_played_seconds) as pgcrDurationSeconds
      FROM pgcr_players
      WHERE completed = 1
      GROUP BY instance_id
    ),
    player_runs AS (
      SELECT
        p.instance_id,
        p.raid_key
      FROM pgcr_players self
      JOIN pgcrs p ON self.instance_id = p.instance_id
      JOIN run_durations d ON d.instance_id = p.instance_id
      WHERE self.membership_id = ?
        AND (p.period + d.pgcrDurationSeconds) >= ?
        AND self.completed = 1
        AND p.completed = 1
        AND p.raid_key IS NOT NULL
        AND p.activity_was_started_from_beginning = 1
    )
    SELECT
      pr.raid_key as raidKey,
      mate.membership_id as teammateMembershipId,
      mate.membership_type as teammateMembershipType,
      COALESCE(
        CASE
          WHEN pl.bungie_global_display_name IS NOT NULL AND pl.bungie_global_display_name_code IS NOT NULL
            THEN pl.bungie_global_display_name || '#' || substr('0000' || pl.bungie_global_display_name_code, -4, 4)
          ELSE NULL
        END,
        pl.bungie_global_display_name,
        pl.display_name,
        mate.bungie_global_display_name,
        mate.display_name,
        mate.membership_id
      ) as teammateDisplayName,
      COUNT(DISTINCT pr.instance_id) as completions,
      CAST(ROUND(AVG(d.pgcrDurationSeconds)) AS INTEGER) as avgCompletionSeconds
    FROM player_runs pr
    JOIN pgcr_players mate ON mate.instance_id = pr.instance_id
    JOIN run_durations d ON d.instance_id = pr.instance_id
    LEFT JOIN players pl ON pl.membership_id = mate.membership_id
    WHERE mate.membership_id <> ?
      AND mate.completed = 1
    GROUP BY pr.raid_key, mate.membership_id, mate.membership_type
    ORDER BY pr.raid_key ASC, completions DESC, teammateDisplayName ASC
  `).all(membershipId, cutoffTimestamp, membershipId) as PlayerRaidTeammateSummary[];
}

export interface ActiveSessionDbRow {
    membershipId: string;
    membershipType: number;
    displayName: string;
    activityHash: number;
    activityModeHash: number | null;
    activityModeType: number | null;
    raidKey: string | null;
    startedAt: string;
    partyMembersJson: string;
    playerCount: number;
    checkedAt: number;
}

export function getActiveSessionForPlayer(membershipId: string, maxAgeSeconds: number = 600): ActiveSessionDbRow | null {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;

    const row = db.prepare(`
    SELECT
      membership_id as membershipId,
      membership_type as membershipType,
      display_name as displayName,
      activity_hash as activityHash,
      activity_mode_hash as activityModeHash,
      activity_mode_type as activityModeType,
      raid_key as raidKey,
      started_at as startedAt,
      party_members_json as partyMembersJson,
      player_count as playerCount,
      checked_at as checkedAt
    FROM active_sessions
    WHERE membership_id = ?
      AND checked_at >= ?
    LIMIT 1
  `).get(membershipId, cutoff) as ActiveSessionDbRow | undefined;

    return row || null;
}

// =====================
// PGCR QUERIES
// =====================

export function hasPGCR(instanceId: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT 1 FROM pgcrs WHERE instance_id = ?').get(instanceId);
    return !!row;
}

export interface InsertFullPGCRData {
    instanceId: string;
    activityHash: number;
    raidKey: string | undefined;
    period: number;
    startingPhaseIndex: number;
    activityWasStartedFromBeginning: boolean;
    completed: boolean;
    playerCount: number;
    source?: string;
}

export interface InsertFullPGCRPlayer {
    instanceId: string;
    membershipId: string;
    membershipType: number;
    displayName: string;
    bungieGlobalDisplayName?: string;
    characterClass: string;
    lightLevel: number;
    completed: boolean;
    kills: number;
    deaths: number;
    assists: number;
    timePlayedSeconds: number;
}

function getInsertFullPGCRTransaction(): (pgcrData: InsertFullPGCRData, players: InsertFullPGCRPlayer[]) => void {
    const db = getDb();

    if (!insertPGCRStmt || !insertPGCRPlayerStmt || !insertFullPGCRTx || pgcrInsertDbRef !== db) {
        pgcrInsertDbRef = db;
        insertPGCRStmt = db.prepare(`
    INSERT OR IGNORE INTO pgcrs 
    (instance_id, activity_hash, raid_key, period, starting_phase_index, 
     activity_was_started_from_beginning, completed, player_count, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO NOTHING
  `) as unknown as RunnableStatement;

        insertPGCRPlayerStmt = db.prepare(`
    INSERT OR IGNORE INTO pgcr_players 
    (instance_id, membership_id, membership_type, display_name, 
     bungie_global_display_name, character_class, light_level, 
     completed, kills, deaths, assists, time_played_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as unknown as RunnableStatement;

        const pgcrStmt = insertPGCRStmt;
        const playerStmt = insertPGCRPlayerStmt;
        if (!pgcrStmt || !playerStmt) {
            throw new Error('Failed to initialize PGCR statements');
        }
        insertFullPGCRTx = db.transaction((pgcrData: InsertFullPGCRData, players: InsertFullPGCRPlayer[]) => {
            pgcrStmt.run(
                pgcrData.instanceId,
                pgcrData.activityHash,
                pgcrData.raidKey || null,
                pgcrData.period,
                pgcrData.startingPhaseIndex,
                pgcrData.activityWasStartedFromBeginning ? 1 : 0,
                pgcrData.completed ? 1 : 0,
                pgcrData.playerCount,
                pgcrData.source || 'unknown'
            );

            for (const player of players) {
                playerStmt.run(
                    player.instanceId,
                    player.membershipId,
                    player.membershipType,
                    player.displayName,
                    player.bungieGlobalDisplayName || null,
                    player.characterClass,
                    player.lightLevel,
                    player.completed ? 1 : 0,
                    player.kills,
                    player.deaths,
                    player.assists,
                    player.timePlayedSeconds
                );
            }
        });
    }

    if (!insertFullPGCRTx) {
        throw new Error('Failed to initialize PGCR insert transaction');
    }

    return insertFullPGCRTx;
}

export function insertFullPGCR(
    pgcrData: InsertFullPGCRData,
    players: InsertFullPGCRPlayer[]
): void {
    const tx = getInsertFullPGCRTransaction();
    tx(pgcrData, players);
}

export function getPGCRCount(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM pgcrs').get() as { count: number } | undefined;
    return row?.count ?? 0;
}

// =====================
// LEADERBOARD QUERIES
// =====================

export function getLeaderboard(params: {
    raidKey?: string;
    hoursBack: number;
    limit?: number;
    fullClearsOnly?: boolean;
}): LeaderboardEntry[] {
    const db = getDb();
    const { raidKey, hoursBack, limit = 100, fullClearsOnly = true } = params;

    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    let query = `
    SELECT 
      pp.membership_id as membershipId,
      pp.membership_type as membershipType,
      pp.display_name as displayName,
      pp.bungie_global_display_name as bungieGlobalDisplayName,
      COUNT(DISTINCT pp.instance_id) as completions,
      COALESCE(p.raid_key, 'unknown') as raidName
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    JOIN (
      SELECT
        instance_id,
        MAX(time_played_seconds) as pgcrDurationSeconds
      FROM pgcr_players
      WHERE completed = 1
      GROUP BY instance_id
    ) d ON d.instance_id = p.instance_id
    WHERE (p.period + d.pgcrDurationSeconds) >= ?
      AND pp.completed = 1
      AND p.completed = 1
  `;

    const queryParams: SqlValue[] = [cutoffTimestamp];

    // Filter to full clears only (started from beginning)
    if (fullClearsOnly) {
        query += ` AND p.activity_was_started_from_beginning = 1`;
    }

    // Filter to specific raid
    if (raidKey) {
        query += ` AND p.raid_key = ?`;
        queryParams.push(raidKey);
    }

    query += `
    GROUP BY pp.membership_id
    ORDER BY completions DESC
    LIMIT ?
  `;
    queryParams.push(limit);

    return db.prepare(query).all(...queryParams) as LeaderboardEntry[];
}

export function getLeaderboardByRaid(params: {
    hoursBack: number;
    limit?: number;
    fullClearsOnly?: boolean;
}): Record<string, LeaderboardEntry[]> {
    const db = getDb();
    const { hoursBack, limit = 50, fullClearsOnly = true } = params;

    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    let query = `
    SELECT 
      pp.membership_id as membershipId,
      pp.membership_type as membershipType,
      pp.display_name as displayName,
      pp.bungie_global_display_name as bungieGlobalDisplayName,
      COUNT(DISTINCT pp.instance_id) as completions,
      p.raid_key as raidKey
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    JOIN (
      SELECT
        instance_id,
        MAX(time_played_seconds) as pgcrDurationSeconds
      FROM pgcr_players
      WHERE completed = 1
      GROUP BY instance_id
    ) d ON d.instance_id = p.instance_id
    WHERE (p.period + d.pgcrDurationSeconds) >= ?
      AND pp.completed = 1
      AND p.completed = 1
      AND p.raid_key IS NOT NULL
  `;

    const queryParams: SqlValue[] = [cutoffTimestamp];

    if (fullClearsOnly) {
        query += ` AND p.activity_was_started_from_beginning = 1`;
    }

    query += `
    GROUP BY p.raid_key, pp.membership_id
    ORDER BY p.raid_key, completions DESC
  `;

    const rows = db.prepare(query).all(...queryParams) as (LeaderboardEntry & { raidKey: string })[];

    // Group by raid and limit each
    const grouped: Record<string, LeaderboardEntry[]> = {};
    for (const row of rows) {
        if (!grouped[row.raidKey]) {
            grouped[row.raidKey] = [];
        }
        if (grouped[row.raidKey].length < limit) {
            grouped[row.raidKey].push(row);
        }
    }

    return grouped;
}

// =====================
// ACTIVE SESSION QUERIES
// =====================

export function upsertActiveSession(session: {
    membershipId: string;
    membershipType: number;
    displayName: string;
    activityHash: number;
    activityModeHash?: number | null;
    activityModeType?: number | null;
    raidKey: string | undefined;
    startedAt: string;
    partyMembersJson: string;
    playerCount: number;
}): void {
    const db = getDb();
    db.prepare(`
    INSERT INTO active_sessions 
    (membership_id, membership_type, display_name, activity_hash, activity_mode_hash, activity_mode_type, raid_key, 
     started_at, party_members_json, player_count, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(membership_id) DO UPDATE SET
      activity_hash = excluded.activity_hash,
      activity_mode_hash = excluded.activity_mode_hash,
      activity_mode_type = excluded.activity_mode_type,
      raid_key = excluded.raid_key,
      started_at = excluded.started_at,
      party_members_json = excluded.party_members_json,
      player_count = excluded.player_count,
      checked_at = unixepoch()
  `).run(
        session.membershipId,
        session.membershipType,
        session.displayName,
        session.activityHash,
        session.activityModeHash ?? null,
        session.activityModeType ?? null,
        session.raidKey || null,
        session.startedAt,
        session.partyMembersJson,
        session.playerCount
    );
}

export function getActiveSessions(raidKey?: string, limit: number = 50, onlyRaidMode: boolean = true): ActiveSessionDbRow[] {
    const db = getDb();

    // Only show sessions checked within the last 15 minutes
    const freshnessCutoff = Math.floor(Date.now() / 1000) - 900;

    let query = `
    SELECT 
      membership_id as membershipId,
      membership_type as membershipType,
      display_name as displayName,
      activity_hash as activityHash,
      activity_mode_hash as activityModeHash,
      activity_mode_type as activityModeType,
      raid_key as raidKey,
      started_at as startedAt,
      party_members_json as partyMembersJson,
      player_count as playerCount,
      checked_at as checkedAt
    FROM active_sessions
    WHERE checked_at >= ?
  `;

    const queryParams: SqlValue[] = [freshnessCutoff];

    if (onlyRaidMode) {
        query += ` AND (activity_mode_type = 4 OR raid_key IS NOT NULL)`;
    }

    if (raidKey) {
        query += ` AND raid_key = ?`;
        queryParams.push(raidKey);
    }

    query += ` ORDER BY started_at DESC LIMIT ?`;
    queryParams.push(limit);

    return db.prepare(query).all(...queryParams) as ActiveSessionDbRow[];
}

export function clearStaleActiveSessions(maxAgeSeconds: number = 600): void {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    db.prepare('DELETE FROM active_sessions WHERE checked_at < ?').run(cutoff);
}

export function deleteActiveSessionForPlayer(membershipId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM active_sessions WHERE membership_id = ?').run(membershipId);
}

export function deleteSessionsContainingPlayer(membershipId: string): void {
    const db = getDb();
    const likePattern = `%\"membershipId\":\"${membershipId}\"%`;
    db.prepare(`
    DELETE FROM active_sessions
    WHERE membership_id = ?
       OR party_members_json LIKE ?
  `).run(membershipId, likePattern);
}

// =====================
// CLEANUP QUERIES
// =====================

export function cleanupOldPGCRs(maxAgeHours: number = 6): { pgcrsDeleted: number; playersDeleted: number } {
    const db = getDb();
    const cutoff = Math.floor((Date.now() - maxAgeHours * 60 * 60 * 1000) / 1000);

    const pgcrResult = db.prepare(`
    DELETE FROM pgcr_players WHERE instance_id IN (
      SELECT instance_id FROM pgcrs WHERE period < ?
    )
  `).run(cutoff);

    const playerResult = db.prepare('DELETE FROM pgcrs WHERE period < ?').run(cutoff);

    return {
        pgcrsDeleted: playerResult.changes,
        playersDeleted: pgcrResult.changes,
    };
}

// =====================
// STATS / DEBUG QUERIES
// =====================

export function getDbStats(): {
    totalPlayers: number;
    totalPGCRs: number;
    totalPGCRPlayers: number;
    activeSessions: number;
    oldestPGCR: string | null;
    newestPGCR: string | null;
} {
    const db = getDb();

    const players = (db.prepare('SELECT COUNT(*) as c FROM players').get() as { c: number } | undefined)?.c ?? 0;
    const pgcrs = (db.prepare('SELECT COUNT(*) as c FROM pgcrs').get() as { c: number } | undefined)?.c ?? 0;
    const pgcrPlayers = (db.prepare('SELECT COUNT(*) as c FROM pgcr_players').get() as { c: number } | undefined)?.c ?? 0;
    const sessions = (db.prepare('SELECT COUNT(*) as c FROM active_sessions').get() as { c: number } | undefined)?.c ?? 0;

    const oldest = db.prepare('SELECT MIN(period) as p FROM pgcrs').get() as { p: number | null } | undefined;
    const newest = db.prepare('SELECT MAX(period) as p FROM pgcrs').get() as { p: number | null } | undefined;

    return {
        totalPlayers: players,
        totalPGCRs: pgcrs,
        totalPGCRPlayers: pgcrPlayers,
        activeSessions: sessions,
            oldestPGCR: oldest?.p ? new Date(oldest.p * 1000).toISOString() : null,
            newestPGCR: newest?.p ? new Date(newest.p * 1000).toISOString() : null,
    };
}

// =====================
// CRAWLER STATE QUERIES
// =====================

export function getCrawlerStatus(): {
    isRunning: boolean;
    lastHeartbeat: string | null;
    status: string;
    secondsSinceHeartbeat: number | null;
} {
    const db = getDb();

    const heartbeatRow = db.prepare(
        "SELECT value, updated_at FROM crawler_state WHERE key = 'heartbeat'"
    ).get() as { value: string; updated_at: number } | undefined;

    const statusRow = db.prepare(
        "SELECT value FROM crawler_state WHERE key = 'status'"
    ).get() as { value: string } | undefined;

    const now = Math.floor(Date.now() / 1000);

    if (!heartbeatRow) {
        return {
            isRunning: false,
            lastHeartbeat: null,
            status: 'never_started',
            secondsSinceHeartbeat: null,
        };
    }

    const secondsSinceHeartbeat = now - heartbeatRow.updated_at;

    // Consider the crawler "running" if we got a heartbeat within the last 3 minutes
    // This accounts for the crawl interval (90s) plus some buffer
    const isRunning = secondsSinceHeartbeat < 180;

    return {
        isRunning,
        lastHeartbeat: heartbeatRow.value,
        status: isRunning ? (statusRow?.value || 'running') : 'stale',
        secondsSinceHeartbeat,
    };
}
