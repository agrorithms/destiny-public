import {
    MIN_RAID_CURVE_RUNS,
    curveFromTally,
    estimateTotal,
    hourOfStep,
    newTally,
    raidCurveFromTally,
    shareAt,
    sumTallies,
    tallyRun,
    trainingWindow,
    type CompletenessCurve,
    type CurveTally,
} from './completeness-curve';
import { getDb } from './index';
import type { PlayerInfo } from '../bungie/types';
import { getAllRaidDefinitions, getHashesWithDifficulty } from '../bungie/manifest';
import type { Difficulty } from '../bungie/difficulty';

/**
 * Instance-level: the run reached the end, having been started from the beginning.
 * The glossary entry is CONTEXT.md's `Full Clear`; this is its SQL.
 *
 * Raw fragment, not a whole clause: it assumes `pgcrs` is aliased `p` (and its sibling
 * {@link COMPLETION} that `pgcr_players` is aliased `pp`), which is why every query here
 * uses those aliases. `raid_key IS NOT NULL` is deliberately NOT bundled in — "is this a
 * raid at all" is a different question, and bundling it would make these unusable in a
 * non-raid context. Call sites carry it themselves.
 */
export const FULL_CLEAR = 'p.completed = 1 AND p.activity_was_started_from_beginning = 1';

/**
 * Player-level: this player finished, inside a Full Clear. The extra conjunct is not
 * redundant — `pgcrs.completed` is written as "at least one player finished" (processPGCR),
 * so being present for a clear is not the same as having cleared it.
 *
 * This is a different population from {@link FULL_CLEAR} and the two must not be collapsed
 * onto one another: the instance-level scopes of `getRaidStats` count the present-but-
 * unfinished player, every player-facing and leaderboard query must not. See CONTEXT.md's
 * `Full Clear` and `Completion` entries, tests/db/full-clear-predicates.test.ts, and
 * ADR 0006's Consequences.
 */
export const COMPLETION = `pp.completed = 1 AND ${FULL_CLEAR}`;

const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 5, 6]);
type RunnableStatement = {
    run: (...params: unknown[]) => unknown;
};
type SqlValue = string | number | null;
export interface BungieDisplayNameParts {
    membershipId: string;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
}

let playerUpsertDbRef: ReturnType<typeof getDb> | null = null;
let playerUpsertStmt: RunnableStatement | null = null;
let bulkUpsertPlayersTx: ((players: PlayerInfo[]) => void) | null = null;

let pgcrInsertDbRef: ReturnType<typeof getDb> | null = null;
let insertPGCRStmt: RunnableStatement | null = null;
let insertPGCRPlayerStmt: RunnableStatement | null = null;
let bumpLastSeenStmt: RunnableStatement | null = null;
let insertFullPGCRTx: ((pgcrData: InsertFullPGCRData, players: InsertFullPGCRPlayer[]) => void) | null = null;

function isValidMembershipType(type: unknown): boolean {
    return VALID_MEMBERSHIP_TYPES.has(Number(type));
}

export function formatBungieDisplayName(player: BungieDisplayNameParts): string {
    if (player.bungieGlobalDisplayName && player.bungieGlobalDisplayNameCode !== null) {
        return `${player.bungieGlobalDisplayName}#${String(player.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }

    return player.bungieGlobalDisplayName || player.displayName || player.membershipId;
}

export function hasCompleteBungieDisplayName(player: Pick<BungieDisplayNameParts, 'bungieGlobalDisplayName' | 'bungieGlobalDisplayNameCode'>): boolean {
    return Boolean(player.bungieGlobalDisplayName) && player.bungieGlobalDisplayNameCode !== null;
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
                    p.bungieGlobalDisplayNameCode ?? null
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
        player.bungieGlobalDisplayNameCode ?? null
    );
}

export function bulkUpsertPlayers(players: PlayerInfo[]): void {
    const { bulkTx } = getPlayerUpsertResources();
    bulkTx(players);
}

/**
 * Untrusted (browser-supplied) identity write, used by the client-write endpoints
 * (players/identity, active-session-update). Inserts unknown players, but only fills
 * fields the DB doesn't already know — it never overwrites an existing display name,
 * so a forged request can't rename a player already on the leaderboard.
 * Name and code are written as a pair (gated on the name being NULL) so a mismatched
 * Name#Code can't be assembled from two writes. The crawler's trusted
 * upsertPlayer/bulkUpsertPlayers remain the authoritative, overwriting writers.
 */
export function upsertPlayerFillOnly(player: PlayerInfo): void {
    // Callers feed this client-supplied data (e.g. profileResponse.userInfo), so the
    // membership-type check lives here rather than trusting every route to pre-validate.
    if (!isValidMembershipType(player.membershipType)) return;
    const db = getDb();
    db.prepare(`
    INSERT INTO players (membership_id, membership_type, display_name, bungie_global_display_name, bungie_global_display_name_code)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(membership_id) DO UPDATE SET
      display_name = COALESCE(display_name, excluded.display_name),
      bungie_global_display_name = CASE
        WHEN bungie_global_display_name IS NULL THEN excluded.bungie_global_display_name
        ELSE bungie_global_display_name
      END,
      bungie_global_display_name_code = CASE
        WHEN bungie_global_display_name IS NULL THEN excluded.bungie_global_display_name_code
        ELSE bungie_global_display_name_code
      END
  `).run(
        player.membershipId,
        player.membershipType,
        player.displayName ?? null,
        player.bungieGlobalDisplayName || null,
        player.bungieGlobalDisplayNameCode ?? null
    );
}

/** Return the subset of the given membershipIds that already exist in the players table. */
export function getExistingPlayerIds(membershipIds: string[]): Set<string> {
    const found = new Set<string>();
    const ids = [...new Set(membershipIds.filter(Boolean))];
    if (ids.length === 0) return found;

    const db = getDb();
    const CHUNK = 500; // stay well under SQLite's bound-parameter limit
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = db.prepare(
            `SELECT membership_id FROM players WHERE membership_id IN (${placeholders})`
        ).all(...chunk) as { membership_id: string }[];
        for (const row of rows) found.add(row.membership_id);
    }
    return found;
}

/**
 * Get players most likely to be online for active session polling.
 * Prioritizes:
 *   1. Players who were recently seen in a PGCR (active raiders, last 6h)
 *   2. Fallback fill: next-most-recently-seen players beyond the 6h window,
 *      with never-seen (NULL last_seen_at) players last
 */
export function getPlayersForSessionPolling(limit: number = 200): PlayerInfo[] {
    const db = getDb();
    const recentWindowSeconds = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);

    // Strategy: players seen in a PGCR within the last 6 hours that aren't currently in
    // session-poll backoff. Reads the denormalized players.last_seen_at and gates on
    // next_session_eligible_at (offline backoff, maintained by recordSessionCheck) so we
    // don't re-poll the same offline players every cycle. Ordered by last_seen_at DESC,
    // served index-ordered + early-terminating by idx_players_session_poll — no join to
    // active_sessions and no post-join COALESCE sort.
    const recentlyActive = db.prepare(`
    SELECT
      membership_id as membershipId,
      membership_type as membershipType,
      display_name as displayName,
      bungie_global_display_name as bungieGlobalDisplayName
    FROM players
    WHERE is_active = 1
      AND last_seen_at >= ?
      AND last_seen_at <= unixepoch()
      AND (next_session_eligible_at IS NULL OR next_session_eligible_at <= unixepoch())
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(
        recentWindowSeconds,
        limit
    ) as PlayerInfo[];

    if (recentlyActive.length >= limit) {
        return recentlyActive;
    }

    // If we don't have enough recently active players (quiet hours, fresh DB),
    // continue down the same recency ranking past the 6h window: players seen
    // 8h/12h/yesterday ago are the next-most-likely to be online, and never-seen
    // players (NULL last_seen_at) sort last under DESC, preserving bootstrap fill.
    // Same backoff gate; served index-ordered + early-terminating by
    // idx_players_session_poll (no temp B-tree sort over the full table).
    const existingIds = new Set(recentlyActive.map((p) => p.membershipId));
    const remaining = limit - recentlyActive.length;

    const fallback = db.prepare(`
    SELECT
      membership_id as membershipId,
      membership_type as membershipType,
      display_name as displayName,
      bungie_global_display_name as bungieGlobalDisplayName
    FROM players
    WHERE is_active = 1
      AND (next_session_eligible_at IS NULL OR next_session_eligible_at <= unixepoch())
    ORDER BY last_seen_at DESC
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

/**
 * Result of a single crawl attempt, used to schedule the next one.
 *  - success:   clean full traversal → advance the coverage watermark.
 *  - transient: API/network error or empty result → short exponential backoff,
 *               auto-deactivate after MAX_CONSECUTIVE_FAILURES.
 *  - privacy:   private profile/history → long fixed backoff, never deactivated.
 *  - not_found: deleted/unknown account (error 217/1601) → deactivate immediately.
 */
export type CrawlOutcome = 'success' | 'transient' | 'privacy' | 'not_found';

const FAIL_BACKOFF_BASE_SEC = Math.max(
    1,
    parseInt(process.env.CRAWLER_FAIL_BACKOFF_BASE_SEC || '300', 10)
);
const FAIL_BACKOFF_CAP_SEC = Math.max(
    FAIL_BACKOFF_BASE_SEC,
    parseInt(process.env.CRAWLER_FAIL_BACKOFF_CAP_SEC || '21600', 10)
);
const PRIVACY_BACKOFF_SEC = Math.max(
    1,
    parseInt(process.env.CRAWLER_PRIVACY_BACKOFF_SEC || '86400', 10)
);
const MAX_CONSECUTIVE_FAILURES = Math.max(
    1,
    parseInt(process.env.CRAWLER_MAX_CONSECUTIVE_FAILURES || '8', 10)
);

// Active-session poll backoff for players found offline/private. Far shorter caps than the
// crawl backoff above: a returning raider must be re-detected by the candidate poll quickly.
const SESSION_OFFLINE_BACKOFF_BASE_SEC = Math.max(
    1,
    parseInt(process.env.SESSION_OFFLINE_BACKOFF_BASE_SEC || '120', 10)
);
const SESSION_OFFLINE_BACKOFF_CAP_SEC = Math.max(
    SESSION_OFFLINE_BACKOFF_BASE_SEC,
    parseInt(process.env.SESSION_OFFLINE_BACKOFF_CAP_SEC || '960', 10)
);
const SESSION_PRIVACY_BACKOFF_SEC = Math.max(
    1,
    parseInt(process.env.SESSION_PRIVACY_BACKOFF_SEC || '21600', 10)
);

/**
 * Record the outcome of an active-session poll for a player. Maintains the denormalized
 * scheduling state read by getPlayersForSessionPolling so offline players back off instead
 * of being re-polled every cycle. Mirrors recordCrawlOutcome's structure.
 *  - online:  clear backoff; player is live (their active_sessions row is written separately).
 *  - offline: exponential backoff, base*1 on the first miss, capped.
 *  - privacy: long fixed backoff — a private profile never surfaces a session.
 */
export type SessionCheckOutcome = 'online' | 'offline' | 'privacy';

export function recordSessionCheck(membershipId: string, outcome: SessionCheckOutcome): void {
    const db = getDb();
    switch (outcome) {
        case 'online':
            db.prepare(`
        UPDATE players SET
          last_session_check_at = unixepoch(),
          consecutive_offline_checks = 0,
          next_session_eligible_at = NULL
        WHERE membership_id = ?
      `).run(membershipId);
            return;
        case 'offline':
            // Backoff uses the pre-increment count (SQLite evaluates all RHS against the old
            // row), so the first miss waits base*1. Shift clamped at 20 to avoid overflow.
            db.prepare(`
        UPDATE players SET
          last_session_check_at = unixepoch(),
          consecutive_offline_checks = consecutive_offline_checks + 1,
          next_session_eligible_at = unixepoch() + MIN(?, ? * (1 << MIN(consecutive_offline_checks, 20)))
        WHERE membership_id = ?
      `).run(SESSION_OFFLINE_BACKOFF_CAP_SEC, SESSION_OFFLINE_BACKOFF_BASE_SEC, membershipId);
            return;
        case 'privacy':
            db.prepare(`
        UPDATE players SET
          last_session_check_at = unixepoch(),
          next_session_eligible_at = unixepoch() + ?
        WHERE membership_id = ?
      `).run(SESSION_PRIVACY_BACKOFF_SEC, membershipId);
            return;
    }
}

/**
 * Record a crawl attempt's outcome. `last_attempt_at` advances on every outcome
 * (scheduling clock); `last_crawled_at` (coverage watermark, read by the
 * per-player ended_at stop condition) advances only on success.
 */
export function recordCrawlOutcome(membershipId: string, outcome: CrawlOutcome): void {
    const db = getDb();
    switch (outcome) {
        case 'success':
            db.prepare(`
        UPDATE players SET
          last_crawled_at = unixepoch(),
          last_attempt_at = unixepoch(),
          consecutive_failures = 0,
          next_eligible_at = NULL
        WHERE membership_id = ?
      `).run(membershipId);
            return;
        case 'transient':
            // Backoff uses the pre-increment failure count (SQLite evaluates all
            // RHS expressions against the old row), so the first failure waits
            // base*1. Shift clamped at 20 to avoid overflow; capped overall.
            db.prepare(`
        UPDATE players SET
          last_attempt_at = unixepoch(),
          consecutive_failures = consecutive_failures + 1,
          next_eligible_at = unixepoch() + MIN(?, ? * (1 << MIN(consecutive_failures, 20))),
          is_active = CASE WHEN consecutive_failures + 1 >= ? THEN 0 ELSE is_active END
        WHERE membership_id = ?
      `).run(FAIL_BACKOFF_CAP_SEC, FAIL_BACKOFF_BASE_SEC, MAX_CONSECUTIVE_FAILURES, membershipId);
            return;
        case 'privacy':
            db.prepare(`
        UPDATE players SET
          last_attempt_at = unixepoch(),
          next_eligible_at = unixepoch() + ?
        WHERE membership_id = ?
      `).run(PRIVACY_BACKOFF_SEC, membershipId);
            return;
        case 'not_found':
            db.prepare(`
        UPDATE players SET
          is_active = 0,
          last_attempt_at = unixepoch()
        WHERE membership_id = ?
      `).run(membershipId);
            return;
    }
}

export function getPlayerCount(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number } | undefined;
    return row?.count ?? 0;
}

// =====================
// CHARACTER ID CACHE
// =====================

export interface CachedCharacterIds {
    ids: string[];
    updatedAt: number;
}

export function getCachedCharacterIds(membershipId: string): CachedCharacterIds | null {
    const db = getDb();
    const row = db.prepare(`
    SELECT character_ids, character_ids_updated_at
    FROM players
    WHERE membership_id = ?
  `).get(membershipId) as { character_ids: string | null; character_ids_updated_at: number | null } | undefined;

    if (!row || !row.character_ids) return null;

    try {
        const ids = JSON.parse(row.character_ids) as string[];
        if (!Array.isArray(ids) || ids.length === 0) return null;
        return { ids, updatedAt: row.character_ids_updated_at ?? 0 };
    } catch {
        return null;
    }
}

export function updateCharacterIds(membershipId: string, ids: string[]): void {
    const db = getDb();
    db.prepare(`
    UPDATE players
    SET character_ids = ?, character_ids_updated_at = unixepoch()
    WHERE membership_id = ?
  `).run(JSON.stringify(ids), membershipId);
}

// =====================
// CRAWL QUEUE
// =====================

export interface CrawlQueueRow {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
}

/** Bulk-enqueue players for next crawl cycle. Re-enqueue upgrades priority if higher. */
export function enqueueCrawl(
    players: { membershipId: string; membershipType: number; displayName?: string | null }[],
    source: string,
    priority: number = 0
): void {
    if (players.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO crawl_queue (membership_id, membership_type, display_name, source, priority, enqueued_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(membership_id) DO UPDATE SET
      source = excluded.source,
      priority = MAX(priority, excluded.priority),
      enqueued_at = excluded.enqueued_at
  `);
    const tx = db.transaction((rows: typeof players) => {
        for (const p of rows) {
            stmt.run(p.membershipId, p.membershipType, p.displayName ?? null, source, priority);
        }
    });
    tx(players);
}

/**
 * Drain up to `limit` rows from the crawl queue, highest priority + oldest first.
 * Players currently backing off (players.next_eligible_at in the future — crawl-failure or
 * privacy backoff) are dropped instead of drained: repeated profile views of e.g. a private
 * player must not bypass the backoff. The organic bucket crawl retries them once eligible.
 */
export function drainCrawlQueue(limit: number): CrawlQueueRow[] {
    const db = getDb();
    db.prepare(`
    DELETE FROM crawl_queue
    WHERE EXISTS (
      SELECT 1 FROM players p
      WHERE p.membership_id = crawl_queue.membership_id
        AND p.next_eligible_at IS NOT NULL AND p.next_eligible_at > unixepoch()
    )
  `).run();
    return db.prepare(`
    SELECT membership_id AS membershipId, membership_type AS membershipType, display_name AS displayName
    FROM crawl_queue
    ORDER BY priority DESC, enqueued_at ASC
    LIMIT ?
  `).all(limit) as CrawlQueueRow[];
}

/** True when the player's crawl backoff (failure or privacy) has not yet expired. */
export function isPlayerCrawlBackingOff(membershipId: string): boolean {
    const db = getDb();
    const row = db.prepare(`
    SELECT 1 FROM players
    WHERE membership_id = ? AND next_eligible_at IS NOT NULL AND next_eligible_at > unixepoch()
  `).get(membershipId);
    return row !== undefined;
}

/** Delete processed queue rows (after crawl attempt, success or failure). */
export function deleteCrawlQueueRows(membershipIds: string[]): void {
    if (membershipIds.length === 0) return;
    const db = getDb();
    db.prepare(`
    DELETE FROM crawl_queue WHERE membership_id IN (SELECT value FROM json_each(?))
  `).run(JSON.stringify(membershipIds));
}

/**
 * Resolve membershipType + displayName for a list of membershipIds from the players table.
 * Returns a map of membershipId → { membershipType, displayName }.
 */
export function resolveMembershipTypes(
    membershipIds: string[]
): Map<string, { membershipType: number; displayName: string | null }> {
    const result = new Map<string, { membershipType: number; displayName: string | null }>();
    if (membershipIds.length === 0) return result;
    const db = getDb();
    const rows = db.prepare(`
    SELECT membership_id, membership_type, display_name
    FROM players
    WHERE membership_id IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(membershipIds)) as { membership_id: string; membership_type: number; display_name: string | null }[];
    for (const row of rows) {
        result.set(row.membership_id, { membershipType: row.membership_type, displayName: row.display_name });
    }
    return result;
}

// =====================
// TIERED CRAWL SELECTION
// =====================

/**
 * Select players for the hot or warm bucket.
 * hot:  minSeenUnix = now-hotHours, maxSeenUnix = null
 * warm: minSeenUnix = now-warmHours, maxSeenUnix = now-hotHours
 */
export function getPlayersInRecentBucket(
    minSeenUnix: number,
    maxSeenUnix: number | null,
    limit: number,
    excludeIds: string[]
): PlayerInfo[] {
    if (limit <= 0) return [];
    const db = getDb();
    const excludeJson = JSON.stringify(excludeIds);
    const maxFilter = maxSeenUnix !== null ? 'AND p.last_seen_at < ?' : '';
    const params: (number | string)[] = [minSeenUnix];
    if (maxSeenUnix !== null) params.push(maxSeenUnix);
    params.push(excludeJson, limit);

    // Reads the denormalized players.last_seen_at (maintained in insertFullPGCR,
    // backfilled by scripts/backfill-last-seen.ts) instead of aggregating the
    // pgcr_players ⋈ pgcrs join every cycle. Ordered by last_attempt_at (the
    // scheduling clock, bumped on every attempt) so backing-off players don't
    // get re-picked instantly; next_eligible_at gates players still in backoff.
    // Served by idx_players_last_seen_attempt.
    return db.prepare(`
    SELECT p.membership_id AS membershipId,
           p.membership_type AS membershipType,
           p.display_name AS displayName,
           p.bungie_global_display_name AS bungieGlobalDisplayName,
           p.last_crawled_at AS lastCrawledAt
    FROM players p
    WHERE p.is_active = 1
      AND p.last_seen_at >= ?
      ${maxFilter}
      AND (p.next_eligible_at IS NULL OR p.next_eligible_at <= unixepoch())
      AND p.membership_id NOT IN (SELECT value FROM json_each(?))
    ORDER BY p.last_attempt_at ASC
    LIMIT ?
  `).all(...params) as PlayerInfo[];
}

/**
 * Select players for the cold bucket: seen before warmCutoff OR never seen in any PGCR.
 */
export function getPlayersInColdBucket(
    warmCutoffUnix: number,
    limit: number,
    excludeIds: string[]
): PlayerInfo[] {
    if (limit <= 0) return [];
    const db = getDb();
    const excludeJson = JSON.stringify(excludeIds);
    // Cold = seen before warmCutoff OR never seen (NULL last_seen_at). Ordered by
    // priority then staleness (last_attempt_at); next_eligible_at gates players
    // still in backoff. Served by idx_players_priority (the planner scans in
    // priority order and stops at LIMIT once enough cold players are found).
    return db.prepare(`
    SELECT p.membership_id AS membershipId,
           p.membership_type AS membershipType,
           p.display_name AS displayName,
           p.bungie_global_display_name AS bungieGlobalDisplayName,
           p.last_crawled_at AS lastCrawledAt
    FROM players p
    WHERE p.is_active = 1
      AND (p.last_seen_at IS NULL OR p.last_seen_at < ?)
      AND (p.next_eligible_at IS NULL OR p.next_eligible_at <= unixepoch())
      AND p.membership_id NOT IN (SELECT value FROM json_each(?))
    ORDER BY p.priority DESC, p.last_attempt_at ASC
    LIMIT ?
  `).all(warmCutoffUnix, excludeJson, limit) as PlayerInfo[];
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

    const columns = `
        membership_id as membershipId,
        membership_type as membershipType,
        display_name as displayName,
        bungie_global_display_name as bungieGlobalDisplayName,
        bungie_global_display_name_code as bungieGlobalDisplayNameCode
    `;

    const seen = new Set<string>();
    const results: PlayerSearchResult[] = [];

    function addRows(rows: PlayerSearchResult[]) {
        for (const row of rows) {
            if (!seen.has(row.membershipId)) {
                seen.add(row.membershipId);
                results.push(row);
            }
        }
    }

    // --- Tier 0/2/3: exact matches, no LIMIT needed ---
    const exactParams: string[] = [nameOnly, nameOnly];
    let exactQuery = `
        SELECT ${columns}
        FROM players
        WHERE LOWER(COALESCE(bungie_global_display_name, display_name, '')) = ?
           OR LOWER(display_name) = ?
    `;
    if (normalized.includes('#')) {
        exactQuery += ` OR (bungie_global_display_name_code IS NOT NULL
            AND LOWER(bungie_global_display_name || '#' || printf('%04d', bungie_global_display_name_code)) = ?)`;
        exactParams.push(normalized);
    }
    addRows(db.prepare(exactQuery).all(...exactParams) as PlayerSearchResult[]);

    // --- Tier 1/4: starts-with, small LIMIT ---
    const startsWithParams: (string | number)[] = [`${nameOnly}%`, `${nameOnly}%`, 20];
    let startsWithQuery = `
        SELECT ${columns}
        FROM players
        WHERE LOWER(COALESCE(bungie_global_display_name, display_name, '')) LIKE ?
           OR LOWER(display_name) LIKE ?
    `;
    if (normalized.includes('#')) {
        startsWithQuery += ` AND (bungie_global_display_name_code IS NOT NULL
            AND LOWER(bungie_global_display_name || '#' || printf('%04d', bungie_global_display_name_code)) LIKE ?)`;
        startsWithParams.splice(2, 0, `${normalized}%`);
        startsWithParams[startsWithParams.length - 1] = 20; // keep LIMIT last
    }
    startsWithQuery += ` LIMIT ?`;
    addRows(db.prepare(startsWithQuery).all(...startsWithParams) as PlayerSearchResult[]);

    // --- Tier 5: contains, existing broad search to fill remaining slots ---
    if (results.length < limit) {
        const containsRows = db.prepare(`
            SELECT ${columns}
            FROM players
            WHERE LOWER(COALESCE(bungie_global_display_name, display_name, '')) LIKE ?
               OR (bungie_global_display_name_code IS NOT NULL
                   AND LOWER(bungie_global_display_name || '#' || printf('%04d', bungie_global_display_name_code)) LIKE ?)
            ORDER BY discovered_at DESC
            LIMIT 100
        `).all(`%${nameOnly}%`, `%${normalized}%`) as PlayerSearchResult[];
        addRows(containsRows);
    }

    // --- JS ranking (unchanged logic) ---
    const withRank = results.map((row) => {
        const bungieBaseName = (row.bungieGlobalDisplayName || '').toLowerCase();
        const platformName = (row.displayName || '').toLowerCase();
        const baseName = bungieBaseName || platformName;
        const fullName = row.bungieGlobalDisplayName && row.bungieGlobalDisplayNameCode !== null
            ? `${row.bungieGlobalDisplayName}#${String(row.bungieGlobalDisplayNameCode).padStart(4, '0')}`.toLowerCase()
            : '';

        let rank = 5;
        if (fullName && fullName === normalized) rank = 0;
        else if (normalized.includes('#') && fullName && fullName.startsWith(normalized)) rank = 1;
        else if (bungieBaseName && bungieBaseName === nameOnly) rank = 2;
        else if (platformName && platformName === nameOnly) rank = 3;
        else if (baseName.startsWith(nameOnly)) rank = 4;
        else if (baseName.includes(nameOnly)) rank = 5;

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

export interface PlayerRaidPerformanceStats {
    raidKey: string;
    completions: number;
    avgCompletionSeconds: number | null;
    fastestClearSeconds: number | null;
    dnfRate: number;
    kills: number;
    deaths: number;
    assists: number;
    kda: number;
}

export function getPlayerRaidCompletionSummary(
    membershipId: string,
    hoursBack: number
): PlayerRaidCompletionSummary[] {
    const db = getDb();
    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    return db.prepare(`
    SELECT
      p.raid_key as raidKey,
      COUNT(DISTINCT pp.instance_id) as completions,
      CAST(ROUND(AVG(p.ended_at - p.period)) AS INTEGER) as avgCompletionSeconds
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    WHERE pp.membership_id = ?
      AND p.ended_at >= ?
      AND p.raid_key IS NOT NULL
      AND ${COMPLETION}
    GROUP BY p.raid_key
    ORDER BY completions DESC, p.raid_key ASC
  `).all(membershipId, cutoffTimestamp) as PlayerRaidCompletionSummary[];
}

/**
 * CONTEXT.md's `Clear Time`: the run's duration, instance start to instance end, so every
 * player in it is credited the same time. Raw fragment over `pgcrs` aliased `p`, like
 * {@link FULL_CLEAR}; it says nothing about who counts, so a caller pairs it with
 * {@link COMPLETION} itself. Shared with the Fastest Clears board (leaderboard-cache.ts)
 * so the profile and the board can't drift on what a Clear Time is.
 */
export const CLEAR_TIME = 'p.ended_at - p.period';

/** How long a Completion took, NULL for every other row — the shape both aggregates below need. */
const CLEARED_DURATION = `CASE WHEN ${COMPLETION} THEN ${CLEAR_TIME} END`;

export function getPlayerRaidPerformanceStats(
    membershipId: string,
    hoursBack: number
): PlayerRaidPerformanceStats[] {
    const db = getDb();
    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    return db.prepare(`
    SELECT
      p.raid_key as raidKey,
      COUNT(DISTINCT CASE
        WHEN ${COMPLETION}
        THEN pp.instance_id END) as completions,
      CAST(ROUND(AVG(${CLEARED_DURATION})) AS INTEGER) as avgCompletionSeconds,
      MIN(${CLEARED_DURATION}) as fastestClearSeconds,
      ROUND(CAST(SUM(CASE WHEN pp.completed = 0 THEN 1 ELSE 0 END) AS REAL)
        / COUNT(*), 4) as dnfRate,
      SUM(pp.kills) as kills,
      SUM(pp.deaths) as deaths,
      SUM(pp.assists) as assists,
      ROUND(CAST(SUM(pp.kills) + SUM(pp.assists) AS REAL)
        / MAX(SUM(pp.deaths), 1), 2) as kda
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    WHERE pp.membership_id = ?
      AND p.ended_at >= ?
      AND p.raid_key IS NOT NULL
    GROUP BY p.raid_key
    HAVING completions > 0
    ORDER BY completions DESC, p.raid_key ASC
  `).all(membershipId, cutoffTimestamp) as PlayerRaidPerformanceStats[];
}

export interface RaidFilters {
    difficulty?: Difficulty;
    exactPlayers?: number;
    maxPlayers?: number;
}

export function buildRaidFilterClause(filters?: RaidFilters): { clause: string; params: (string | number)[] } {
    let clause = '';
    const params: (string | number)[] = [];

    // Difficulty is a property of the activity hash (#41), never of `difficulty_tier`, which
    // records Feats. Normal is every hash tagged neither Master nor Epic, a hash in no raid
    // definition included, so All = Normal + Master + Epic holds over every stored run.
    if (filters?.difficulty) {
        const [operator, tagged] = filters.difficulty === 'normal'
            ? ['NOT IN', [...getHashesWithDifficulty('master'), ...getHashesWithDifficulty('epic')]]
            : ['IN', getHashesWithDifficulty(filters.difficulty)];
        clause += ` AND p.activity_hash ${operator} (${tagged.map(() => '?').join(', ')})`;
        params.push(...tagged);
    }

    if (filters?.exactPlayers != null) {
        clause += ` AND p.unique_player_count = ?`;
        params.push(filters.exactPlayers);
    } else if (filters?.maxPlayers != null) {
        clause += ` AND p.unique_player_count IS NOT NULL AND p.unique_player_count <= ?`;
        params.push(filters.maxPlayers);
    }

    return { clause, params };
}

export interface RaidKdaQuartiles {
    p25: number;
    p50: number;
    p75: number;
}

/**
 * Every metric that depends on which instances count. Reported twice per raid — once under
 * each scope — so a client can toggle without a refetch and can never be unsure which
 * population produced a number. See docs/adr/0006-population-kda-quartiles-and-dual-scope.md.
 */
export interface RaidScopeStats {
    /** Nearest-rank p25/p50/p75 of per-Player-Run KDA. Null iff sampleSize is 0. */
    kda: RaidKdaQuartiles | null;
    /** (SUM(kills) + SUM(assists)) / SUM(deaths) over the same population. Null iff sampleSize is 0. */
    aggregateKda: number | null;
    /** Player-Runs in this scope — not instances. See instanceCount for those. */
    sampleSize: number;
    classDistribution: Record<string, number>;
}

/**
 * The instance-level predicate that defines each scope's population. Adding a scope here is
 * the only edit a new scope needs outside the response assembly, which stops compiling until
 * the new key is supplied. All Attempts is every in-window instance, so its predicate is empty.
 */
const RAID_SCOPE_PREDICATES = {
    fullClear: FULL_CLEAR,
    allAttempts: '',
} as const;

export type RaidScope = keyof typeof RAID_SCOPE_PREDICATES;

export type RaidStatsRow = {
    raidKey: string;
    /** Full-clear-only by definition, which is why it sits outside the scope toggle. */
    fastestClearSeconds: number | null;
    /** All-instances by definition — degenerate (always 0) under a full-clear scope. */
    dnfRate: number;
    /** Raid instances in window — the denominator of dnfRate. A different unit from sampleSize. */
    instanceCount: number;
} & Record<RaidScope, RaidScopeStats>;

/** A scope with no Player-Runs at all. A factory, so callers never share one mutable row. */
function emptyScopeStats(): RaidScopeStats {
    return { kda: null, aggregateKda: null, sampleSize: 0, classDistribution: {} };
}

/** The window and filters every scope query runs against; identical across scopes. */
interface ScopeQueryContext {
    cutoff: number;
    filterClause: string;
    filterParams: (string | number)[];
}

interface ScopeRow {
    raidKey: string;
    sampleSize: number;
    aggregateKda: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    classDistribution: string;
}

/**
 * Every scope-sensitive metric for one scope, in one pass over that scope's Player-Runs.
 *
 * The `runs` CTE is the single definition of the scope's population — quartiles, aggregate and
 * class counts all derive from it, which is what makes the class counts sum to sampleSize by
 * construction rather than by two WHERE clauses staying in sync. MATERIALIZED keeps SQLite from
 * re-running the pgcrs join once per reference.
 *
 * Quartiles are nearest rank: rank ceil(n * P / 100) of the KDA-ordered rows, expressed with
 * SQLite integer division as (n * P + 99) / 100. The MAX(..., 1) is what makes n = 1 work.
 * Nearest rank means every published percentile is a KDA some player actually achieved, and no
 * minimum-sample threshold is needed — an interpolating method would have needed one.
 */
function queryScope(
    { cutoff, filterClause, filterParams }: ScopeQueryContext,
    scope: RaidScope
): Map<string, RaidScopeStats> {
    const db = getDb();
    const predicate = RAID_SCOPE_PREDICATES[scope];
    const scopeClause = predicate ? ` AND ${predicate}` : '';

    const rows = db.prepare(`
    WITH runs AS MATERIALIZED (
      SELECT
        p.raid_key as raidKey,
        pp.kills as kills,
        pp.deaths as deaths,
        pp.assists as assists,
        pp.character_class as characterClass,
        -- Per-row zero-death guard: one flawless Player-Run would otherwise divide by zero.
        -- Deliberately NOT the same guard as the aggregate's below.
        CAST(pp.kills + pp.assists AS REAL) / MAX(pp.deaths, 1) as kda
      FROM pgcr_players pp
      JOIN pgcrs p ON pp.instance_id = p.instance_id
      WHERE p.ended_at >= ?
        AND p.raid_key IS NOT NULL
        ${scopeClause}
        ${filterClause}
    ),
    ranked AS (
      SELECT raidKey, kda, ROW_NUMBER() OVER (PARTITION BY raidKey ORDER BY kda) as rn
      FROM runs
    ),
    totals AS (
      SELECT
        raidKey,
        COUNT(*) as n,
        -- Population-level zero-death guard: fires only if EVERY Player-Run in this raid and
        -- scope had zero deaths. Collapsing it into the per-row guard changes both statistics.
        ROUND(CAST(SUM(kills) + SUM(assists) AS REAL) / MAX(SUM(deaths), 1), 2) as aggregateKda,
        MAX((COUNT(*) * 25 + 99) / 100, 1) as r25,
        MAX((COUNT(*) * 50 + 99) / 100, 1) as r50,
        MAX((COUNT(*) * 75 + 99) / 100, 1) as r75
      FROM runs
      GROUP BY raidKey
    ),
    classes AS (
      -- 'Unknown' is a real stored class, not a null placeholder — it stays its own key.
      SELECT raidKey, json_group_object(characterClass, n) as classDistribution
      FROM (SELECT raidKey, characterClass, COUNT(*) as n FROM runs GROUP BY raidKey, characterClass)
      GROUP BY raidKey
    )
    SELECT
      t.raidKey as raidKey,
      t.n as sampleSize,
      t.aggregateKda as aggregateKda,
      ROUND(MAX(CASE WHEN r.rn = t.r25 THEN r.kda END), 2) as p25,
      ROUND(MAX(CASE WHEN r.rn = t.r50 THEN r.kda END), 2) as p50,
      ROUND(MAX(CASE WHEN r.rn = t.r75 THEN r.kda END), 2) as p75,
      c.classDistribution as classDistribution
    FROM totals t
    -- Only the three ranked rows the percentiles name reach the GROUP BY.
    JOIN ranked r ON r.raidKey = t.raidKey AND r.rn IN (t.r25, t.r50, t.r75)
    JOIN classes c ON c.raidKey = t.raidKey
    GROUP BY t.raidKey
  `).all(cutoff, ...filterParams) as ScopeRow[];

    const byRaid = new Map<string, RaidScopeStats>();
    for (const row of rows) {
        // A raid only reaches this loop if it has Player-Runs in the scope, so the percentiles
        // are non-null. Falling back rather than asserting keeps a broken invariant from
        // publishing a null typed as a number.
        const kda = row.p25 !== null && row.p50 !== null && row.p75 !== null
            ? { p25: row.p25, p50: row.p50, p75: row.p75 }
            : null;
        byRaid.set(row.raidKey, {
            kda,
            aggregateKda: row.aggregateKda,
            sampleSize: row.sampleSize,
            classDistribution: JSON.parse(row.classDistribution) as Record<string, number>,
        });
    }
    return byRaid;
}

export function getRaidStats(
    hoursBack: number,
    filters?: RaidFilters
): RaidStatsRow[] {
    const db = getDb();
    const cutoff = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    const { clause: filterClause, params: filterParams } = buildRaidFilterClause(filters);

    // The row set is driven by this query, not by the scope CTEs: a raid with instances but no
    // Player-Runs in a scope must still appear, with sampleSize 0 and kda null.
    const scalarRows = db.prepare(`
    SELECT
      p.raid_key as raidKey,
      COUNT(*) as instanceCount,
      MIN(CASE
        WHEN ${FULL_CLEAR}
        THEN p.ended_at - p.period END) as fastestClearSeconds,
      ROUND(CAST(SUM(CASE WHEN p.completed = 0 THEN 1 ELSE 0 END) AS REAL)
        / COUNT(*), 4) as dnfRate
    FROM pgcrs p
    WHERE p.ended_at >= ?
      AND p.raid_key IS NOT NULL
      ${filterClause}
    GROUP BY p.raid_key
  `).all(cutoff, ...filterParams) as {
        raidKey: string;
        instanceCount: number;
        fastestClearSeconds: number | null;
        dnfRate: number;
    }[];

    const scopeContext: ScopeQueryContext = { cutoff, filterClause, filterParams };
    const fullClear = queryScope(scopeContext, 'fullClear');
    const allAttempts = queryScope(scopeContext, 'allAttempts');

    return scalarRows.map(row => ({
        raidKey: row.raidKey,
        fastestClearSeconds: row.fastestClearSeconds,
        dnfRate: row.dnfRate,
        instanceCount: row.instanceCount,
        // A raid can have instances in-window but no Player-Runs in a scope; that — and only
        // that — is when a scope reports sampleSize 0 and kda null.
        fullClear: fullClear.get(row.raidKey) ?? emptyScopeStats(),
        allAttempts: allAttempts.get(row.raidKey) ?? emptyScopeStats(),
    }));
}

/**
 * Count of distinct full raid clears in the last `hoursBack` hours. "Full clear" matches the
 * leaderboard definition (see runLeaderboardRows in src/lib/cache/leaderboard-cache.ts):
 * a completed pgcr started from the beginning. Since pgcrs is keyed by instance_id, COUNT(*)
 * is a distinct-instance count — a clear is counted once, never multiplied by fireteam size.
 */
export function getFullClearCount(hoursBack: number): number {
    const db = getDb();
    const cutoffTimestamp = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

    const row = db.prepare(`
    SELECT COUNT(*) as n
    FROM pgcrs p
    WHERE p.ended_at >= ?
      AND p.raid_key IS NOT NULL
      AND ${FULL_CLEAR}
  `).get(cutoffTimestamp) as { n: number };

    return row.n;
}

export interface PlayerRecentCompletion {
    instanceId: string;
    raidKey: string | null;
    period: number;
    activityHash: number;
    endedAt: number;
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
    SELECT
      p.instance_id as instanceId,
      p.raid_key as raidKey,
      p.period as period,
      p.activity_hash as activityHash,
      p.ended_at as endedAt,
      (p.ended_at - p.period) as timePlayedSeconds
    FROM pgcr_players pp
    JOIN pgcrs p ON pp.instance_id = p.instance_id
    WHERE pp.membership_id = ?
      AND p.ended_at >= ?
      AND p.raid_key IS NOT NULL
      AND ${COMPLETION}
    ORDER BY p.ended_at DESC
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
    WITH player_runs AS (
      SELECT
        p.instance_id,
        p.raid_key,
        (p.ended_at - p.period) as durationSeconds
      FROM pgcr_players pp
      JOIN pgcrs p ON pp.instance_id = p.instance_id
      WHERE pp.membership_id = ?
        AND p.ended_at >= ?
        AND p.raid_key IS NOT NULL
        AND ${COMPLETION}
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
      CAST(ROUND(AVG(pr.durationSeconds)) AS INTEGER) as avgCompletionSeconds
    FROM player_runs pr
    JOIN pgcr_players mate ON mate.instance_id = pr.instance_id
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

export function getActiveSessionContainingPlayer(membershipId: string, maxAgeSeconds: number = 900): ActiveSessionDbRow | null {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    const stringMembershipPattern = `%\"membershipId\":\"${membershipId}\"%`;
    const numericMembershipPattern = `%\"membershipId\":${membershipId}%`;

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
    WHERE checked_at >= ?
      AND (
        membership_id = ?
        OR party_members_json LIKE ?
        OR party_members_json LIKE ?
      )
    ORDER BY checked_at DESC, started_at DESC
    LIMIT 1
  `).get(
        cutoff,
        membershipId,
        stringMembershipPattern,
        numericMembershipPattern
    ) as ActiveSessionDbRow | undefined;

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
    /** Bungie activity-level duration (seconds); Tier 1 input for ended_at. */
    activityDurationSeconds?: number | null;
    difficultyTier?: number;
    uniquePlayerCount?: number;
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
    /** Per-player join offset from activity start (seconds); Tier 2 input. */
    startSeconds?: number | null;
}

// A PGCR is only ingested after the activity has ended, so a computed `ended_at` in the future
// is malformed — it comes from absurd Bungie `activityDurationSeconds` (e.g. multi-day "durations"
// reported for farm/checkpoint megalobby instances). Such values poison `players.last_seen_at`
// (which feeds active-session candidate ranking and the crawl tier buckets) and completion-time
// stats. The skew buffer keeps legitimately just-finished raids (a few seconds/minutes ahead of
// the ingest clock) while dropping clearly-future corruption.
export const FUTURE_ENDED_SKEW_SECONDS = 3600;

/**
 * Tiered activity duration (seconds) used to derive `pgcrs.ended_at = period + duration`.
 *   Tier 1 — Bungie's activity-level `activityDurationSeconds` (authoritative).
 *   Tier 2 — MAX over ALL players of (startSeconds + timePlayedSeconds). Considers every
 *            player (not just completed ones); correctly counts late joiners; collapses to
 *            MAX(timePlayedSeconds) when startSeconds is absent.
 *   Tier 3 — null (no usable duration; an empty/malformed PGCR). ended_at stays NULL.
 */
export function computeActivityDurationSeconds(
    activityDurationSeconds: number | null | undefined,
    players: { startSeconds?: number | null; timePlayedSeconds: number }[],
): number | null {
    if (typeof activityDurationSeconds === 'number' && activityDurationSeconds > 0) {
        return activityDurationSeconds;
    }

    let best = 0;
    for (const player of players) {
        const start = typeof player.startSeconds === 'number' ? player.startSeconds : 0;
        const t = typeof player.timePlayedSeconds === 'number' ? player.timePlayedSeconds : 0;
        if (t > 0) {
            best = Math.max(best, start + t);
        }
    }

    return best > 0 ? best : null;
}

function getInsertFullPGCRTransaction(): (pgcrData: InsertFullPGCRData, players: InsertFullPGCRPlayer[]) => void {
    const db = getDb();

    if (!insertPGCRStmt || !insertPGCRPlayerStmt || !insertFullPGCRTx || pgcrInsertDbRef !== db) {
        pgcrInsertDbRef = db;
        insertPGCRStmt = db.prepare(`
    INSERT OR IGNORE INTO pgcrs
    (instance_id, activity_hash, raid_key, period, starting_phase_index,
     activity_was_started_from_beginning, completed, player_count, source, ended_at,
     difficulty_tier, unique_player_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO NOTHING
  `) as unknown as RunnableStatement;

        insertPGCRPlayerStmt = db.prepare(`
    INSERT OR IGNORE INTO pgcr_players
    (instance_id, membership_id, membership_type, display_name,
     bungie_global_display_name, character_class, light_level,
     completed, kills, deaths, assists, time_played_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as unknown as RunnableStatement;

        // Denormalized last_seen_at maintenance: advance to this run's ended_at
        // when newer. No-op for players not yet in the players table (they get
        // their value once crawled/upserted, defaulting to cold until then).
        bumpLastSeenStmt = db.prepare(`
    UPDATE players SET last_seen_at = MAX(COALESCE(last_seen_at, 0), ?)
    WHERE membership_id = ?
  `) as unknown as RunnableStatement;

        const pgcrStmt = insertPGCRStmt;
        const playerStmt = insertPGCRPlayerStmt;
        const lastSeenStmt = bumpLastSeenStmt;
        if (!pgcrStmt || !playerStmt || !lastSeenStmt) {
            throw new Error('Failed to initialize PGCR statements');
        }
        insertFullPGCRTx = db.transaction((pgcrData: InsertFullPGCRData, players: InsertFullPGCRPlayer[]) => {
            const duration = computeActivityDurationSeconds(pgcrData.activityDurationSeconds, players);
            let endedAt = duration != null ? pgcrData.period + duration : null;
            // Drop future-dated (corrupt) ended_at to NULL so it never pollutes last_seen_at,
            // completion-time, or the crawl buckets. The bump below already skips NULL.
            if (endedAt != null && endedAt > Math.floor(Date.now() / 1000) + FUTURE_ENDED_SKEW_SECONDS) {
                endedAt = null;
            }

            pgcrStmt.run(
                pgcrData.instanceId,
                pgcrData.activityHash,
                pgcrData.raidKey || null,
                pgcrData.period,
                pgcrData.startingPhaseIndex,
                pgcrData.activityWasStartedFromBeginning ? 1 : 0,
                pgcrData.completed ? 1 : 0,
                pgcrData.playerCount,
                pgcrData.source || 'unknown',
                endedAt,
                pgcrData.difficultyTier ?? null,
                pgcrData.uniquePlayerCount ?? null
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

                if (endedAt != null) {
                    lastSeenStmt.run(endedAt, player.membershipId);
                }
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

// How many raw per-player rows an active-session read may scan. This is NOT the display limit:
// `active_sessions` is keyed by membership_id, so one fireteam yields up to 6 rows, and the
// user-facing cap is denominated in *fireteams* after dedupe (see active-session/dedupe.ts).
// Sized at ~2x the ceiling the crawler can produce: at CRAWLER_SESSION_POLLING_LIMIT rows per
// cycle over the 900s freshness window, at most ~1500 rows can be fresh at once.
export const ACTIVE_SESSION_ROW_SCAN_LIMIT = Math.max(
    1,
    parseInt(process.env.ACTIVE_SESSION_ROW_SCAN_LIMIT || '3000', 10)
);

export function getActiveSessions(
    raidKey?: string,
    rowScanLimit: number = ACTIVE_SESSION_ROW_SCAN_LIMIT,
    onlyRaidMode: boolean = true
): ActiveSessionDbRow[] {
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

    // Ordered by checked_at (indexed by idx_active_sessions_checked_at), NOT started_at. Callers
    // dedupe into fireteams and apply their own display sort, so this ordering only decides which
    // rows survive if `rowScanLimit` is ever hit — and then we want to shed the *stalest* rows,
    // which are closest to ageing out anyway. Ordering by started_at here is what caused
    // long-running raids to be silently dropped; see docs/adr/0001.
    query += ` ORDER BY checked_at DESC LIMIT ?`;
    queryParams.push(rowScanLimit);

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
// RAID ACTIVITY QUERIES
// =====================

/**
 * How old a moment must be before its Raids in Progress are counted (CONTEXT.md). A raid
 * still running has no PGCR yet, so a newer moment would read low; on prod a moment two
 * hours old is ~93% complete. A step is counted once its *end* is this old.
 */
export const COUNTED_AGE_SECONDS = 7200; // two hours

/**
 * How old a step's end must be before the Provisional estimate shows it (#196). Nothing is
 * reported for a newer step: at that age too little of it has been reported to scale up (on
 * prod the median error is 5% at 15 minutes and grows steeply below).
 */
export const PROVISIONAL_MIN_AGE_SECONDS = 900; // fifteen minutes

/**
 * How long after the oldest stored PGCR began a step may start (#195). Cleanup deletes PGCRs
 * by *start* (`period`), so a moment just after the oldest one kept is under-counted by every
 * run that started before it and was still going. On the 2026-10-23 prod backup the runs in
 * progress at a moment that had started more than 6 hours earlier were 1.5% of the count on
 * average and 4.0% at worst (2 h: 7.7% / 12.9%; 24 h: 0.75% / 2.7%). The tail is runs lasting
 * days, so no margin makes it exact, and past 6 hours each extra hour buys little.
 */
export const DATA_START_MARGIN_SECONDS = 21600; // six hours

/** One step of the Raids in Progress series: `[start, end)` in unix seconds. */
export interface RaidsInProgressPoint {
    start: number;
    end: number;
    /** Raid instances in progress across every raid, averaged over the step. */
    total: number;
    /**
     * True when `total` is an estimate (CONTEXT.md, Provisional) rather than a count: the
     * step's end is under {@link COUNTED_AGE_SECONDS} old. The points run in order, counted
     * ones first.
     */
    provisional: boolean;
    /**
     * Raids in Progress per raid (#198), averaged over the step, for exactly the keys the
     * series was asked for ({@link RaidsInProgressOptions.raidKeys}), zero where a raid ran
     * nothing. Absent when no keys were asked for. On a Provisional step (#199) these are
     * estimates, and only for the raids that have one: a raid with too few runs in the
     * training week to learn a curve from ({@link RaidsInProgressOptions.minRaidRuns}) is
     * left out, and so is a raid from the first step its own curve gives no share for on.
     */
    raids?: Record<string, number>;
}

export interface RaidsInProgressSeries {
    /** The window's left edge, unix seconds: `now - rangeSeconds`. */
    from: number;
    /** The window's right edge: `now`. */
    to: number;
    stepSeconds: number;
    /**
     * Where counted data starts: the start of the first step returned, on the step grid.
     * Normally the window's first whole step. When the stored PGCRs don't reach back that
     * far — prod keeps them for 720 hours, the 30-day window exactly — it is the first step
     * starting {@link DATA_START_MARGIN_SECONDS} after the oldest one, so no step is drawn
     * that cleanup has already emptied. The chart shades from `from` to here. Never past
     * `countedUntil`.
     */
    countedFrom: number;
    /**
     * Where counted data ends: the end of the last counted step, on the step grid. That is
     * the last step boundary at or before `now - COUNTED_AGE_SECONDS`, so between two and
     * three hours before `now` at 1-hour steps. The Provisional steps (#196) start here, and
     * the chart's dashed line starts from the last counted point, so they meet the line
     * rather than sit at `now - COUNTED_AGE_SECONDS` and leave a gap with neither.
     */
    countedUntil: number;
    /**
     * Where the line ends: the end of the last Provisional step returned, on the step grid
     * and at least {@link PROVISIONAL_MIN_AGE_SECONDS} before `to` — the grid floor of that
     * age, unless the curve has no share for an earlier step: the estimate stops at the
     * first step it can't make. `countedUntil` when no step is Provisional (no history to
     * learn a curve from, no share for the first step, or no step between the counted
     * boundary and the cutoff). The chart's too-recent shade starts here.
     */
    provisionalUntil: number;
    points: RaidsInProgressPoint[];
    /**
     * The up to 3 raids with the most raid time over the counted steps, most first; ties in
     * `RAID_DEFINITIONS` order. A raid with none is not listed, so fewer than 3 is possible.
     * Returned whatever {@link RaidsInProgressOptions.raidKeys} asked for.
     */
    topRaids: string[];
}

export interface RaidsInProgressOptions {
    rangeSeconds: number;
    stepSeconds: number;
    /** Unix seconds. Passed in, never read from the clock here, so a test can pin it. */
    now: number;
    /** Raids to return per-raid values for (#198). Omitted, no point carries any. */
    raidKeys?: readonly string[];
    /**
     * How many runs a raid needs in the training week before it gets its own Provisional
     * estimate (#199). Defaults to {@link MIN_RAID_CURVE_RUNS}.
     */
    minRaidRuns?: number;
}

/**
 * Raids in Progress across every raid, one point per step (CONTEXT.md, #194).
 *
 * **Every raid instance counts** (All Attempts): Fresh Runs and Checkpoint Runs, finished
 * or not. A PGCR counts when it has a raid key, the same "is this a raid at all" test every
 * other raid query here makes, and an `ended_at` — a PGCR with no usable duration has no
 * interval to place. Session Snapshots are not read: they don't measure activity.
 *
 * **Each point is the step's average**, not a sample at one instant: the raid time that
 * overlaps the step, over the step's length. A run covering half a step adds 0.5.
 *
 * **Steps sit on the step grid** — whole multiples of `stepSeconds` since the epoch, so a
 * 1-hour step is a UTC clock hour — from the first boundary at or after `now -
 * rangeSeconds`. A step is counted once its end is {@link COUNTED_AGE_SECONDS} old; newer
 * steps are Provisional down to {@link PROVISIONAL_MIN_AGE_SECONDS} old (below), and the
 * ones younger still are absent rather than low. A maintenance window is a true zero.
 *
 * **The window doesn't start before the data** (#195). Steps start no earlier than
 * {@link DATA_START_MARGIN_SECONDS} after the oldest stored PGCR began, because cleanup
 * has deleted the runs that started before it and some of them were still going then. The
 * bound is read from the data rather than from `CRAWLER_CLEANUP_MAX_AGE_HOURS`: the web
 * process doesn't see the crawler's env, and on prod the data reaches further back than
 * that setting says (ADR 0009). Steps before it are absent, like the ones too new to estimate.
 *
 * **Steps too recent to count are estimated, not left out** (#196, ADR 0009). Each step
 * ending between {@link COUNTED_AGE_SECONDS} and {@link PROVISIONAL_MIN_AGE_SECONDS} ago is
 * returned with `provisional: true`: the raid time of runs already ended, over the share a
 * step's raid time is usually known at that age, for its hour of the day
 * ({@link getCompletenessCurve}). Younger steps are absent. The estimate stops at the first
 * step whose hour has no share to divide by, so it is one unbroken run. With no history to
 * learn from there is no curve and no estimate. A run that has not ended by `now` is not
 * read, in either case: the estimate is of what the counted version will say, from what
 * has ended.
 *
 * **Per raid, from the same sweep** (#198). Each run is also added to its raid's own overlap
 * arrays, so the per-raid values of a counted step add up to its total and the cost is the
 * same pass plus a few small arrays. `raidKeys` picks which raids' values the points carry
 * (zero for one that never ran); {@link RaidsInProgressSeries.topRaids} is ranked over the
 * counted steps, whichever were asked for.
 *
 * **Per-raid estimates** (#199). A Provisional step's `raids` holds, for each raid asked for
 * with a curve of its own, that raid's partial count over the share *its* runs report by then
 * ({@link getCompletenessCurves}), so a raid whose runs are short is not scaled by a long
 * one's curve. A raid needs {@link RaidsInProgressOptions.minRaidRuns} runs in the training
 * week to have one; below that it is counted and not estimated. Like the total's, a raid's
 * estimate ends at the first step it can't make.
 *
 * **One sweep, not one query per step.** The PGCRs overlapping the window are read in a
 * single pass through the covering `idx_pgcrs_ended_period_raid` (`ended_at > first step
 * start`), and each adds its overlap in O(1): the partial first and last steps it touches
 * directly, and the whole steps between them through a running difference array. So the
 * cost is rows + steps, never rows × steps — a run lasting days adds two array writes, not
 * one per hour it spans. The curve is a second pass, over its own training week.
 */
export function getRaidsInProgress(options: RaidsInProgressOptions): RaidsInProgressSeries {
    const { rangeSeconds, stepSeconds, now } = options;
    const from = now - rangeSeconds;
    const db = getDb();
    const countedUntil = Math.floor((now - COUNTED_AGE_SECONDS) / stepSeconds) * stepSeconds;
    const cutoff = Math.floor((now - PROVISIONAL_MIN_AGE_SECONDS) / stepSeconds) * stepSeconds;
    // Every PGCR, raid or not: cleanup deletes them all by age. Through idx_pgcrs_period.
    // An empty table reads as the epoch, which no window reaches back to.
    const { oldest } = db.prepare('SELECT COALESCE(MIN(period), 0) AS oldest FROM pgcrs').get() as { oldest: number };
    const firstStart = Math.min(
        countedUntil,
        Math.ceil(Math.max(from, oldest + DATA_START_MARGIN_SECONDS) / stepSeconds) * stepSeconds
    );
    const countedSteps = (countedUntil - firstStart) / stepSeconds;
    const steps = (cutoff - firstStart) / stepSeconds;
    const curves = getCompletenessCurves({ now, stepSeconds, raidKeys: options.raidKeys, minRaidRuns: options.minRaidRuns });

    // Seconds of raid time inside each step from runs that only partly cover it, and the
    // change in "runs covering the whole step" at each step, summed into a running count.
    // One slot past the last step in each, for a run ending exactly at the cutoff: its
    // last piece lands there, and is zero seconds long. The total has one pair, and each raid
    // its own (#198), filled by the same pass.
    const total = newOverlap(steps);
    const perRaid = new Map<string, Overlap>();

    for (const [period, endedAt, raidKey] of endedRaidRuns({ endedAfter: firstStart, now, startedBefore: cutoff })) {
        const start = Math.max(period, firstStart);
        const end = Math.min(endedAt, cutoff);
        let raid = perRaid.get(raidKey);
        if (raid === undefined) {
            raid = newOverlap(steps);
            perRaid.set(raidKey, raid);
        }
        addOverlap(total, firstStart, stepSeconds, start, end);
        addOverlap(raid, firstStart, stepSeconds, start, end);
    }

    const requested = options.raidKeys;
    const raidTime = new Map<string, number>();
    const wholeRunsOf = new Map<string, number>();
    // The raids still being estimated, by curve: one that can't make a step's estimate leaves,
    // so its estimate, like the total's, is one unbroken run.
    const estimating = new Map(curves.raids);
    const points: RaidsInProgressPoint[] = [];
    let wholeRuns = 0;
    for (let index = 0; index < steps; index++) {
        wholeRuns += total.wholeStepsDelta[index];
        const start = firstStart + index * stepSeconds;
        const end = start + stepSeconds;
        const observed = wholeRuns + total.partialSeconds[index] / stepSeconds;
        const byRaid: Record<string, number> = {};
        for (const [key, raid] of perRaid) {
            const whole = (wholeRunsOf.get(key) ?? 0) + raid.wholeStepsDelta[index];
            wholeRunsOf.set(key, whole);
            byRaid[key] = whole + raid.partialSeconds[index] / stepSeconds;
        }
        if (index < countedSteps) {
            for (const [key, value] of Object.entries(byRaid)) raidTime.set(key, (raidTime.get(key) ?? 0) + value);
            const point: RaidsInProgressPoint = { start, end, total: observed, provisional: false };
            if (requested !== undefined) {
                point.raids = Object.fromEntries(requested.map((key) => [key, byRaid[key] ?? 0]));
            }
            points.push(point);
            continue;
        }
        // The estimate stops at the first step it can't make, so it is one unbroken run
        // and `provisionalUntil` is where it ends: shares are per hour of the day, and a
        // later step with a share would otherwise be drawn joined across the gap.
        const hour = hourOfStep(start, stepSeconds);
        const estimate = curves.total === null ? null : estimateTotal(observed, shareAt(curves.total, hour, now - end));
        if (estimate === null) break;
        const point: RaidsInProgressPoint = { start, end, total: estimate, provisional: true };
        if (requested !== undefined) {
            point.raids = {};
            for (const key of requested) {
                const curve = estimating.get(key);
                if (curve === undefined) continue;
                const raidEstimate = estimateTotal(byRaid[key] ?? 0, shareAt(curve, hour, now - end));
                if (raidEstimate === null) estimating.delete(key);
                else point.raids[key] = raidEstimate;
            }
        }
        points.push(point);
    }

    const lastPoint = points.at(-1);
    const provisionalUntil = lastPoint?.provisional ? lastPoint.end : countedUntil;
    return { from, to: now, stepSeconds, countedFrom: firstStart, countedUntil, provisionalUntil, points, topRaids: topRaids(raidTime) };
}

/** The seconds of raid time a set of runs puts in each step, built by {@link addOverlap}. */
interface Overlap {
    partialSeconds: Float64Array;
    wholeStepsDelta: Float64Array;
}

function newOverlap(steps: number): Overlap {
    return { partialSeconds: new Float64Array(steps + 1), wholeStepsDelta: new Float64Array(steps + 1) };
}

/**
 * Adds one run, clipped to `[start, end]` inside the window, to an {@link Overlap}: its piece
 * of its first step, its piece of its last, and +1 for every whole step between them. A run
 * inside a single step takes the same path: its two pieces then overlap and add up to one
 * step more than the run, and the -1 at `last` (which is `first`) takes that step back.
 */
function addOverlap(overlap: Overlap, firstStart: number, stepSeconds: number, start: number, end: number): void {
    const first = Math.floor((start - firstStart) / stepSeconds);
    const last = Math.floor((end - firstStart) / stepSeconds);
    overlap.partialSeconds[first] += firstStart + (first + 1) * stepSeconds - start;
    overlap.partialSeconds[last] += end - (firstStart + last * stepSeconds);
    overlap.wholeStepsDelta[first + 1] += 1;
    overlap.wholeStepsDelta[last] -= 1;
}

/** How many raids {@link RaidsInProgressSeries.topRaids} lists. */
const TOP_RAID_COUNT = 3;

/**
 * The raids with the most raid time (#198), most first, at most {@link TOP_RAID_COUNT}, none
 * with no time at all. Ties go in `RAID_DEFINITIONS` order, so which raid is listed does not
 * depend on the order the PGCRs happen to have been stored in; a key no definition names
 * comes after those that do.
 */
function topRaids(raidTime: ReadonlyMap<string, number>): string[] {
    const listed = Object.keys(getAllRaidDefinitions());
    const place = (key: string) => {
        const index = listed.indexOf(key);
        return index === -1 ? listed.length : index;
    };
    return [...raidTime]
        .filter(([, time]) => time > 0)
        .sort(([keyA, a], [keyB, b]) => b - a || place(keyA) - place(keyB) || keyA.localeCompare(keyB))
        .slice(0, TOP_RAID_COUNT)
        .map(([key]) => key);
}

/**
 * The completeness curve for a range's step size, learned from the Tracker's PGCRs (#196):
 * for each hour of the day, how much of a step's raid time is known a given age after the
 * step ends (./completeness-curve.ts). Null when the training week holds no raid at all.
 *
 * **Reads the week of whole steps ending between 8 days and 24 hours before `now`**, so
 * every run that overlapped them has long since ended, and nothing newer teaches it
 * how incomplete a recent step is. Raids only, by `ended_at` (the covering
 * `idx_pgcrs_ended_period_raid`, no table lookups) and never `fetched_at`: the curve is
 * about how long raids last, and the scanner's lag is not. A run that has not ended by
 * `now` is not a report yet, as in {@link getRaidsInProgress}.
 *
 * A second pass over the same index as the sweep: about 230 ms on the prod backup, once
 * per cache refresh of a range. The same pass learns the per-raid curves (#199).
 */
export function getCompletenessCurve(options: { now: number; stepSeconds: number }): CompletenessCurve | null {
    return getCompletenessCurves(options).total;
}

/** The completeness curves a range's estimates scale by (#199): the total's, and each asked-for raid's own. */
export interface CompletenessCurves {
    total: CompletenessCurve | null;
    /** Only raids asked for that had enough runs in the training week; the others have no entry. */
    raids: Map<string, CompletenessCurve>;
}

/**
 * The curves for a range's step size, learned in the one pass over the training week (#199).
 * Each run is tallied into its own raid's tally, so a raid's curve is learned from that raid's
 * runs alone, and the total's curve is the sum of every raid's tally — what tallying all of
 * them together would give, at the cost of the pass that was already being made. A raid in
 * `raidKeys` gets a curve of its own only if it has at least `minRaidRuns` runs in the week
 * (default {@link MIN_RAID_CURVE_RUNS}); asked for none, none is built.
 */
export function getCompletenessCurves(options: {
    now: number;
    stepSeconds: number;
    raidKeys?: readonly string[];
    minRaidRuns?: number;
}): CompletenessCurves {
    const { now, stepSeconds, minRaidRuns = MIN_RAID_CURVE_RUNS } = options;
    const asked = new Set(options.raidKeys);
    const window = trainingWindow(now, stepSeconds);
    const tallies = new Map<string, CurveTally>();
    for (const [period, endedAt, raidKey] of endedRaidRuns({ endedAfter: window.from, now, startedBefore: window.until })) {
        let tally = tallies.get(raidKey);
        if (tally === undefined) {
            tally = newTally();
            tallies.set(raidKey, tally);
        }
        tallyRun(tally, window, stepSeconds, period, endedAt);
    }
    const raids = new Map<string, CompletenessCurve>();
    for (const [key, tally] of tallies) {
        const curve = asked.has(key) ? raidCurveFromTally(tally, minRaidRuns) : null;
        if (curve !== null) raids.set(key, curve);
    }
    return { total: curveFromTally(sumTallies([...tallies.values()])), raids };
}

/**
 * `[period, ended_at]` of every raid that ended after `endedAfter` and by `now`, and started
 * before `startedBefore` (all unix seconds, named so no two can be swapped): the runs Raid
 * Activity counts ({@link getRaidsInProgress}) and the ones its completeness curve learns
 * from ({@link getCompletenessCurve}), read one way for both so the estimate scales up the
 * same population it was learned from. Raids only, through the covering
 * `idx_pgcrs_ended_period_raid`. A run that has not ended by `now` is not a report yet.
 */
function endedRaidRuns(bounds: { endedAfter: number; now: number; startedBefore: number }): IterableIterator<[number, number, string]> {
    const { endedAfter, now, startedBefore } = bounds;
    return getDb().prepare(`
    SELECT p.period, p.ended_at, p.raid_key
    FROM pgcrs p
    WHERE p.ended_at > ?
      AND p.ended_at <= ?
      AND p.period < ?
      AND p.raid_key IS NOT NULL
  `).raw().iterate(endedAfter, now, startedBefore) as IterableIterator<[number, number, string]>;
}

// =====================
// SESSION SNAPSHOT QUERIES
// =====================

export interface SessionSnapshotInput {
    totalFireteams: number;
    totalPlayers: number;
    raidBreakdown: Record<string, { fireteams: number; players: number }>;
}

export interface SessionHistoryPoint {
    timestamp: number;
    totalFireteams: number;
    totalPlayers: number;
    raidBreakdown: Record<string, { fireteams: number; players: number }>;
}

export function getSessionHistory(hoursBack: number, stepdownHours: number): SessionHistoryPoint[] {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - hoursBack * 3600;

    const rows = db.prepare(`
        SELECT timestamp, total_fireteams, total_players, raid_breakdown_json
        FROM session_snapshots
        WHERE timestamp >= ?
        ORDER BY timestamp ASC
    `).all(cutoff) as { timestamp: number; total_fireteams: number; total_players: number; raid_breakdown_json: string }[];

    if (hoursBack <= stepdownHours) {
        return rows.map(row => ({
            timestamp: row.timestamp,
            totalFireteams: row.total_fireteams,
            totalPlayers: row.total_players,
            raidBreakdown: JSON.parse(row.raid_breakdown_json) as Record<string, { fireteams: number; players: number }>,
        }));
    }

    const buckets = new Map<number, typeof rows>();
    for (const row of rows) {
        const bucketKey = Math.floor(row.timestamp / 3600) * 3600;
        const bucket = buckets.get(bucketKey) ?? [];
        bucket.push(row);
        buckets.set(bucketKey, bucket);
    }

    const result: SessionHistoryPoint[] = [];
    for (const [bucketTimestamp, bucketRows] of buckets) {
        const n = bucketRows.length;
        const avgFireteams = Math.round(
            bucketRows.reduce((s, r) => s + r.total_fireteams, 0) / n
        );
        const avgPlayers = Math.round(
            bucketRows.reduce((s, r) => s + r.total_players, 0) / n
        );

        const raidSums = new Map<string, { fireteams: number; players: number }>();
        for (const row of bucketRows) {
            const breakdown = JSON.parse(row.raid_breakdown_json) as Record<string, { fireteams: number; players: number }>;
            for (const [raidKey, vals] of Object.entries(breakdown)) {
                const existing = raidSums.get(raidKey) ?? { fireteams: 0, players: 0 };
                existing.fireteams += vals.fireteams;
                existing.players += vals.players;
                raidSums.set(raidKey, existing);
            }
        }

        const avgBreakdown: Record<string, { fireteams: number; players: number }> = {};
        for (const [raidKey, sums] of raidSums) {
            avgBreakdown[raidKey] = {
                fireteams: Math.round(sums.fireteams / n),
                players: Math.round(sums.players / n),
            };
        }

        result.push({
            timestamp: bucketTimestamp,
            totalFireteams: avgFireteams,
            totalPlayers: avgPlayers,
            raidBreakdown: avgBreakdown,
        });
    }

    return result;
}

export function recordSessionSnapshot(input: SessionSnapshotInput): void {
    const db = getDb();
    db.prepare(`
    INSERT INTO session_snapshots (timestamp, total_fireteams, total_players, raid_breakdown_json)
    VALUES (unixepoch(), ?, ?, ?)
  `).run(
        input.totalFireteams,
        input.totalPlayers,
        JSON.stringify(input.raidBreakdown)
    );
}

// =====================
// CLEANUP QUERIES
// =====================

/**
 * Delete one bounded batch of expired PGCRs (and their pgcr_players rows) in a single
 * short transaction. A whole-backlog DELETE holds the write lock for its full duration
 * and blocks this process's event loop (better-sqlite3 is synchronous), so the caller
 * loops batches with a yield in between instead.
 */
export function deleteExpiredPGCRBatch(cutoffEpoch: number, batchSize: number): {
    pgcrsDeleted: number;
    playersDeleted: number;
    done: boolean;
} {
    const db = getDb();

    const rows = db.prepare(
        'SELECT instance_id FROM pgcrs WHERE period < ? LIMIT ?'
    ).all(cutoffEpoch, batchSize) as { instance_id: string }[];

    if (rows.length === 0) {
        return { pgcrsDeleted: 0, playersDeleted: 0, done: true };
    }

    const ids = rows.map((r) => r.instance_id);
    const placeholders = ids.map(() => '?').join(',');

    const tx = db.transaction((instanceIds: string[]) => {
        const playerResult = db.prepare(
            `DELETE FROM pgcr_players WHERE instance_id IN (${placeholders})`
        ).run(...instanceIds);
        const pgcrResult = db.prepare(
            `DELETE FROM pgcrs WHERE instance_id IN (${placeholders})`
        ).run(...instanceIds);
        return { pgcrsDeleted: pgcrResult.changes, playersDeleted: playerResult.changes };
    });

    const result = tx(ids);
    return { ...result, done: rows.length < batchSize };
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

/**
 * Cheap subset of getDbStats for recurring logs (post-cleanup): active_sessions is a
 * small table and MIN/MAX(period) are served by idx_pgcrs_period. Skips the three
 * unfiltered COUNT(*) scans, which synchronously block the event loop for seconds.
 */
export function getDbStatsLite(): {
    activeSessions: number;
    oldestPGCR: string | null;
    newestPGCR: string | null;
} {
    const db = getDb();

    const sessions = (db.prepare('SELECT COUNT(*) as c FROM active_sessions').get() as { c: number } | undefined)?.c ?? 0;
    const oldest = db.prepare('SELECT MIN(period) as p FROM pgcrs').get() as { p: number | null } | undefined;
    const newest = db.prepare('SELECT MAX(period) as p FROM pgcrs').get() as { p: number | null } | undefined;

    return {
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
    // Active-session loop liveness, tracked separately from the crawl-loop heartbeat above.
    // The crawl heartbeat stays fresh even when the session loop is dead/stalled, so this is
    // the only signal that reveals a session-loop stall. null until the first poll completes.
    secondsSinceSessionHeartbeat: number | null;
    sessionWatchdogTrips: number;
} {
    const db = getDb();

    const heartbeatRow = db.prepare(
        "SELECT value, updated_at FROM crawler_state WHERE key = 'heartbeat'"
    ).get() as { value: string; updated_at: number } | undefined;

    const statusRow = db.prepare(
        "SELECT value FROM crawler_state WHERE key = 'status'"
    ).get() as { value: string } | undefined;

    const sessionHeartbeatRow = db.prepare(
        "SELECT updated_at FROM crawler_state WHERE key = 'session_heartbeat'"
    ).get() as { updated_at: number } | undefined;

    const watchdogTripsRow = db.prepare(
        "SELECT value FROM crawler_state WHERE key = 'session_watchdog_trips'"
    ).get() as { value: string } | undefined;

    const now = Math.floor(Date.now() / 1000);

    const secondsSinceSessionHeartbeat = sessionHeartbeatRow
        ? now - sessionHeartbeatRow.updated_at
        : null;
    const sessionWatchdogTrips = watchdogTripsRow
        ? (parseInt(watchdogTripsRow.value, 10) || 0)
        : 0;

    if (!heartbeatRow) {
        return {
            isRunning: false,
            lastHeartbeat: null,
            status: 'never_started',
            secondsSinceHeartbeat: null,
            secondsSinceSessionHeartbeat,
            sessionWatchdogTrips,
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
        secondsSinceSessionHeartbeat,
        sessionWatchdogTrips,
    };
}
