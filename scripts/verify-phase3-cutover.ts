/**
 * Denormalization Phase 3 — verification gate (run AFTER Deploy 1 indexes exist,
 * BEFORE the Deploy 2 reader cutover is merged).
 *
 *   npm run verify-phase3-cutover   # or: npx tsx scripts/verify-phase3-cutover.ts
 *
 * For every migrated reader site it runs the CURRENT CTE/duration form and the NEW
 * `ended_at` form SIDE-BY-SIDE on ONE read connection (no two-snapshot drift), diffs
 * the result sets, and:
 *   - tolerates + REPORTS the calibrated differences (it is a diff-and-review tool,
 *     not a hard equality assertion):
 *       * leaderboard / profile: ±seconds on durations, ±1 completion on window edges
 *         (old MAX was over completed=1 players; ended_at is over ALL players);
 *       * crawler (#8–#10): a deliberate BROADENING — instances where nobody completed
 *         were dropped by the old INNER JOIN to the completed=1 subquery, but have a
 *         non-null ended_at, so wipe-only appearances now count. Expect only-in-NEW rows.
 *   - runs EXPLAIN QUERY PLAN on each NEW query and flags any full table scan
 *     (i.e. the Deploy 1 indexes are not being used);
 *   - asserts no NEW (migrated) query string references `time_played_seconds`.
 *
 * Read-only: uses openMaintenanceDb but only SELECT/EXPLAIN. Safe to run anytime.
 */
import 'dotenv/config';
import type Database from 'better-sqlite3';
import { openMaintenanceDb, DB_PATH } from '../src/lib/db';

type Row = Record<string, unknown>;
type SqlParam = string | number;

interface Check {
    label: string;
    /** crawler sites broaden by design — only-in-NEW rows are expected, not flagged hard. */
    crawlerBroadening?: boolean;
    params: SqlParam[];
    oldSql: string;
    newSql: string;
    /** stable identity for a row (the diff key). */
    keyOf: (r: Row) => string;
    /** comparable value for a keyed row (JSON of the fields that should match). */
    valOf: (r: Row) => string;
    /** numeric fields to report as deltas when a keyed value changes. */
    numericFields?: string[];
}

const EXAMPLES = 8;

function log(m = ''): void {
    console.log(m);
}

function num(r: Row, k: string): number | null {
    const v = r[k];
    return typeof v === 'number' ? v : null;
}

// ── sample selection (so the parameterized profile queries return rows) ───────────

function pickSample(db: Database.Database, cutoff: number): { membershipId: string; raidKey: string } {
    const member = db
        .prepare(`
            SELECT pp.membership_id AS m
            FROM pgcr_players pp
            JOIN pgcrs p ON pp.instance_id = p.instance_id
            WHERE pp.completed = 1 AND p.completed = 1
              AND p.activity_was_started_from_beginning = 1
              AND p.raid_key IS NOT NULL AND p.ended_at >= ?
            GROUP BY pp.membership_id
            ORDER BY COUNT(DISTINCT pp.instance_id) DESC
            LIMIT 1
        `)
        .get(cutoff) as { m: string } | undefined;

    // Pick a raid that actually has full-clear completions in the window, so the
    // single-raid leaderboard check diffs real rows (not just EXPLAIN).
    const raid = db
        .prepare(`
            SELECT p.raid_key AS k FROM pgcrs p
            WHERE p.raid_key IS NOT NULL AND p.ended_at >= ?
              AND p.completed = 1 AND p.activity_was_started_from_beginning = 1
            GROUP BY p.raid_key ORDER BY COUNT(*) DESC LIMIT 1
        `)
        .get(cutoff) as { k: string } | undefined;

    if (!member || !raid) {
        throw new Error('Could not select a sample membership_id / raid_key — is the DB populated?');
    }
    return { membershipId: member.m, raidKey: raid.k };
}

// ── diff ──────────────────────────────────────────────────────────────────────

function runDiff(db: Database.Database, c: Check): boolean {
    const oldRows = db.prepare(c.oldSql).all(...c.params) as Row[];
    const newRows = db.prepare(c.newSql).all(...c.params) as Row[];

    const oldMap = new Map<string, Row>();
    const newMap = new Map<string, Row>();
    for (const r of oldRows) oldMap.set(c.keyOf(r), r);
    for (const r of newRows) newMap.set(c.keyOf(r), r);

    const onlyOld: string[] = [];
    const onlyNew: string[] = [];
    const changed: { key: string; old: Row; neu: Row }[] = [];

    for (const [k, r] of oldMap) {
        const n = newMap.get(k);
        if (!n) onlyOld.push(k);
        else if (c.valOf(r) !== c.valOf(n)) changed.push({ key: k, old: r, neu: n });
    }
    for (const k of newMap.keys()) {
        if (!oldMap.has(k)) onlyNew.push(k);
    }

    const clean = onlyOld.length === 0 && onlyNew.length === 0 && changed.length === 0;
    log(`▸ ${c.label}`);
    log(`    rows: old=${oldRows.length}  new=${newRows.length}`);

    if (clean) {
        log('    ✓ identical');
    } else {
        log(`    onlyOld=${onlyOld.length}  onlyNew=${onlyNew.length}  changed=${changed.length}`);
        if (onlyOld.length) log(`      only-in-OLD (e.g.): ${onlyOld.slice(0, EXAMPLES).join(', ')}`);
        if (onlyNew.length) {
            const tag = c.crawlerBroadening ? ' [expected broadening]' : '';
            log(`      only-in-NEW${tag} (e.g.): ${onlyNew.slice(0, EXAMPLES).join(', ')}`);
        }
        for (const ch of changed.slice(0, EXAMPLES)) {
            const deltas = (c.numericFields ?? [])
                .map((f) => {
                    const o = num(ch.old, f);
                    const n = num(ch.neu, f);
                    return o != null && n != null ? `${f}: ${o}→${n} (Δ${n - o})` : `${f}: ${ch.old[f]}→${ch.neu[f]}`;
                })
                .join('  ');
            log(`      changed ${ch.key}: ${deltas}`);
        }
        log('    ⓘ review the above against the calibrated diff (expected: all-players vs completed=1).');
    }
    return clean;
}

// ── EXPLAIN QUERY PLAN index-usage check on the NEW query ────────────────────────

function explainUsesIndexes(db: Database.Database, c: Check): void {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${c.newSql}`).all(...c.params) as { detail: string }[];
    const fullScans = plan
        .map((p) => p.detail)
        .filter((d) => /\bSCAN\b/.test(d) && /\b(pgcrs|pgcr_players)\b/.test(d) && !/USING\s+(COVERING\s+)?INDEX/.test(d));
    log(`    EXPLAIN: ${fullScans.length === 0 ? '✓ no full scans on pgcrs/pgcr_players' : '⚠ FULL SCAN detected'}`);
    for (const d of plan) log(`        ${d.detail}`);
    if (fullScans.length) for (const d of fullScans) log(`      ⚠ ${d}`);
}

// ── checks (old form copied verbatim; new form = the planned migration) ──────────

function buildChecks(sample: { membershipId: string; raidKey: string }, cutoff: number): Check[] {
    const M = sample.membershipId;
    const R = sample.raidKey;
    const BIG = 1_000_000; // neutralize LIMIT so it doesn't mask set differences

    const lbOldDur = `WITH run_durations AS (
        SELECT instance_id, MAX(time_played_seconds) as pgcrDurationSeconds
        FROM pgcr_players WHERE completed = 1 GROUP BY instance_id)`;

    return [
        // 1 + 2 (snapshot uses identical all-raids SQL) — leaderboard all-raids
        {
            label: 'runLeaderboardRows / buildLeaderboardSnapshot (all raids, full clears)',
            params: [cutoff, BIG],
            keyOf: (r) => String(r.membershipId),
            valOf: (r) => String(r.completions),
            numericFields: ['completions'],
            oldSql: `${lbOldDur}
              SELECT pp.membership_id as membershipId, COUNT(DISTINCT pp.instance_id) as completions
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              JOIN run_durations d ON d.instance_id = p.instance_id
              WHERE (p.period + d.pgcrDurationSeconds) >= ?
                AND pp.completed = 1 AND p.completed = 1
                AND p.activity_was_started_from_beginning = 1
              GROUP BY pp.membership_id HAVING completions > 0
              ORDER BY completions DESC LIMIT ?`,
            newSql: `SELECT pp.membership_id as membershipId, COUNT(DISTINCT pp.instance_id) as completions
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              WHERE p.ended_at >= ?
                AND pp.completed = 1 AND p.completed = 1
                AND p.activity_was_started_from_beginning = 1
              GROUP BY pp.membership_id HAVING completions > 0
              ORDER BY completions DESC LIMIT ?`,
        },
        // leaderboard single-raid (exercises idx_pgcrs_raid_ended)
        {
            label: `runLeaderboardRows (single raid = ${R})`,
            params: [cutoff, R, BIG],
            keyOf: (r) => String(r.membershipId),
            valOf: (r) => String(r.completions),
            numericFields: ['completions'],
            oldSql: `${lbOldDur}
              SELECT pp.membership_id as membershipId, COUNT(DISTINCT pp.instance_id) as completions
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              JOIN run_durations d ON d.instance_id = p.instance_id
              WHERE (p.period + d.pgcrDurationSeconds) >= ?
                AND pp.completed = 1 AND p.completed = 1
                AND p.raid_key IN (?)
                AND p.activity_was_started_from_beginning = 1
              GROUP BY pp.membership_id HAVING completions > 0
              ORDER BY completions DESC LIMIT ?`,
            newSql: `SELECT pp.membership_id as membershipId, COUNT(DISTINCT pp.instance_id) as completions
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              WHERE p.ended_at >= ?
                AND pp.completed = 1 AND p.completed = 1
                AND p.raid_key IN (?)
                AND p.activity_was_started_from_beginning = 1
              GROUP BY pp.membership_id HAVING completions > 0
              ORDER BY completions DESC LIMIT ?`,
        },
        // 5 getPlayerRaidCompletionSummary
        {
            label: 'getPlayerRaidCompletionSummary',
            params: [M, cutoff],
            keyOf: (r) => String(r.raidKey),
            valOf: (r) => `${r.completions}|${r.avgCompletionSeconds}`,
            numericFields: ['completions', 'avgCompletionSeconds'],
            oldSql: `${lbOldDur}
              SELECT p.raid_key as raidKey, COUNT(DISTINCT pp.instance_id) as completions,
                CAST(ROUND(AVG(d.pgcrDurationSeconds)) AS INTEGER) as avgCompletionSeconds
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              JOIN run_durations d ON d.instance_id = p.instance_id
              WHERE pp.membership_id = ? AND (p.period + d.pgcrDurationSeconds) >= ?
                AND pp.completed = 1 AND p.completed = 1 AND p.raid_key IS NOT NULL
                AND p.activity_was_started_from_beginning = 1
              GROUP BY p.raid_key ORDER BY completions DESC, p.raid_key ASC`,
            newSql: `SELECT p.raid_key as raidKey, COUNT(DISTINCT pp.instance_id) as completions,
                CAST(ROUND(AVG(p.ended_at - p.period)) AS INTEGER) as avgCompletionSeconds
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              WHERE pp.membership_id = ? AND p.ended_at >= ?
                AND pp.completed = 1 AND p.completed = 1 AND p.raid_key IS NOT NULL
                AND p.activity_was_started_from_beginning = 1
              GROUP BY p.raid_key ORDER BY completions DESC, p.raid_key ASC`,
        },
        // 6 getPlayerRecentCompletions
        {
            label: 'getPlayerRecentCompletions',
            params: [M, cutoff, BIG],
            keyOf: (r) => String(r.instanceId),
            valOf: (r) => String(r.timePlayedSeconds),
            numericFields: ['timePlayedSeconds'],
            oldSql: `${lbOldDur}
              SELECT p.instance_id as instanceId, d.pgcrDurationSeconds as timePlayedSeconds
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              JOIN run_durations d ON d.instance_id = p.instance_id
              WHERE pp.membership_id = ? AND (p.period + d.pgcrDurationSeconds) >= ?
                AND pp.completed = 1 AND p.completed = 1 AND p.raid_key IS NOT NULL
                AND p.activity_was_started_from_beginning = 1
              ORDER BY (p.period + d.pgcrDurationSeconds) DESC LIMIT ?`,
            newSql: `SELECT p.instance_id as instanceId, (p.ended_at - p.period) as timePlayedSeconds
              FROM pgcr_players pp
              JOIN pgcrs p ON pp.instance_id = p.instance_id
              WHERE pp.membership_id = ? AND p.ended_at >= ?
                AND pp.completed = 1 AND p.completed = 1 AND p.raid_key IS NOT NULL
                AND p.activity_was_started_from_beginning = 1
              ORDER BY p.ended_at DESC LIMIT ?`,
        },
        // 7 getPlayerRaidTeammateSummary
        {
            label: 'getPlayerRaidTeammateSummary',
            params: [M, cutoff, M],
            keyOf: (r) => `${r.raidKey}|${r.teammateMembershipId}`,
            valOf: (r) => `${r.completions}|${r.avgCompletionSeconds}`,
            numericFields: ['completions', 'avgCompletionSeconds'],
            oldSql: `${lbOldDur},
              player_runs AS (
                SELECT p.instance_id, p.raid_key
                FROM pgcr_players self
                JOIN pgcrs p ON self.instance_id = p.instance_id
                JOIN run_durations d ON d.instance_id = p.instance_id
                WHERE self.membership_id = ? AND (p.period + d.pgcrDurationSeconds) >= ?
                  AND self.completed = 1 AND p.completed = 1 AND p.raid_key IS NOT NULL
                  AND p.activity_was_started_from_beginning = 1)
              SELECT pr.raid_key as raidKey, mate.membership_id as teammateMembershipId,
                COUNT(DISTINCT pr.instance_id) as completions,
                CAST(ROUND(AVG(d.pgcrDurationSeconds)) AS INTEGER) as avgCompletionSeconds
              FROM player_runs pr
              JOIN pgcr_players mate ON mate.instance_id = pr.instance_id
              JOIN run_durations d ON d.instance_id = pr.instance_id
              WHERE mate.membership_id <> ? AND mate.completed = 1
              GROUP BY pr.raid_key, mate.membership_id, mate.membership_type`,
            newSql: `WITH player_runs AS (
                SELECT p.instance_id, p.raid_key, (p.ended_at - p.period) AS durationSeconds
                FROM pgcr_players self
                JOIN pgcrs p ON self.instance_id = p.instance_id
                WHERE self.membership_id = ? AND p.ended_at >= ?
                  AND self.completed = 1 AND p.completed = 1 AND p.raid_key IS NOT NULL
                  AND p.activity_was_started_from_beginning = 1)
              SELECT pr.raid_key as raidKey, mate.membership_id as teammateMembershipId,
                COUNT(DISTINCT pr.instance_id) as completions,
                CAST(ROUND(AVG(pr.durationSeconds)) AS INTEGER) as avgCompletionSeconds
              FROM player_runs pr
              JOIN pgcr_players mate ON mate.instance_id = pr.instance_id
              WHERE mate.membership_id <> ? AND mate.completed = 1
              GROUP BY pr.raid_key, mate.membership_id, mate.membership_type`,
        },
        // 8 getPlayersForSessionPolling (recent_players CTE)
        {
            label: 'getPlayersForSessionPolling (recent_players)',
            crawlerBroadening: true,
            params: [cutoff, BIG],
            keyOf: (r) => String(r.membershipId),
            valOf: (r) => String(r.lastSeenPeriod),
            numericFields: ['lastSeenPeriod'],
            oldSql: `SELECT pp.membership_id as membershipId, MAX(pg.period + d.pgcrDurationSeconds) as lastSeenPeriod
              FROM pgcr_players pp
              INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
              INNER JOIN (SELECT instance_id, MAX(time_played_seconds) as pgcrDurationSeconds
                          FROM pgcr_players WHERE completed = 1 GROUP BY instance_id) d
                ON d.instance_id = pg.instance_id
              WHERE (pg.period + d.pgcrDurationSeconds) >= ?
              GROUP BY pp.membership_id ORDER BY lastSeenPeriod DESC LIMIT ?`,
            newSql: `SELECT pp.membership_id as membershipId, MAX(pg.ended_at) as lastSeenPeriod
              FROM pgcr_players pp
              INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
              WHERE pg.ended_at >= ?
              GROUP BY pp.membership_id ORDER BY lastSeenPeriod DESC LIMIT ?`,
        },
        // 9 getPlayersInRecentBucket (recent CTE)
        {
            label: 'getPlayersInRecentBucket (recent)',
            crawlerBroadening: true,
            params: [cutoff],
            keyOf: (r) => String(r.membershipId),
            valOf: () => '1',
            oldSql: `SELECT pp.membership_id AS membershipId
              FROM pgcr_players pp
              INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
              INNER JOIN (SELECT instance_id, MAX(time_played_seconds) AS dur
                          FROM pgcr_players WHERE completed = 1 GROUP BY instance_id) d
                ON d.instance_id = pg.instance_id
              WHERE (pg.period + d.dur) >= ?
              GROUP BY pp.membership_id`,
            newSql: `SELECT pp.membership_id AS membershipId
              FROM pgcr_players pp
              INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
              WHERE pg.ended_at >= ?
              GROUP BY pp.membership_id`,
        },
        // 10 getPlayersInColdBucket (all_recent CTE — bounded for tractable verification)
        {
            label: 'getPlayersInColdBucket (all_recent, bounded)',
            crawlerBroadening: true,
            params: [cutoff],
            keyOf: (r) => String(r.membershipId),
            valOf: (r) => String(r.lastSeenPeriod),
            numericFields: ['lastSeenPeriod'],
            oldSql: `SELECT pp.membership_id AS membershipId, MAX(pg.period + d.dur) AS lastSeenPeriod
              FROM pgcr_players pp
              INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
              INNER JOIN (SELECT instance_id, MAX(time_played_seconds) AS dur
                          FROM pgcr_players WHERE completed = 1 GROUP BY instance_id) d
                ON d.instance_id = pg.instance_id
              WHERE pg.period >= ?
              GROUP BY pp.membership_id`,
            newSql: `SELECT pp.membership_id AS membershipId, MAX(pg.ended_at) AS lastSeenPeriod
              FROM pgcr_players pp
              INNER JOIN pgcrs pg ON pp.instance_id = pg.instance_id
              WHERE pg.ended_at >= ?
              GROUP BY pp.membership_id`,
        },
    ];
}

function main(): void {
    log(`[verify-phase3] DB: ${DB_PATH}`);
    const db = openMaintenanceDb();
    try {
        const cutoff = Math.floor((Date.now() - 720 * 60 * 60 * 1000) / 1000); // 30d window for the diff
        const sample = pickSample(db, cutoff);
        log(`[verify-phase3] sample membership_id=${sample.membershipId} raid_key=${sample.raidKey} cutoff=${cutoff}\n`);

        const checks = buildChecks(sample, cutoff);

        // Assert no migrated (new) query reads time_played_seconds.
        const leaks = checks.filter((c) => /time_played_seconds/.test(c.newSql));
        log(`time_played_seconds leak check: ${leaks.length === 0 ? '✓ none in migrated SQL' : `⚠ ${leaks.map((c) => c.label).join(', ')}`}\n`);

        let allClean = true;
        for (const c of checks) {
            const clean = runDiff(db, c);
            explainUsesIndexes(db, c);
            log();
            if (!clean && !c.crawlerBroadening) allClean = false;
        }

        log('────────────────────────────────────────');
        log(allClean
            ? 'No unexpected diffs on leaderboard/profile sites. Review crawler broadening + EXPLAIN above, then proceed to Deploy 2.'
            : 'Leaderboard/profile diffs present — review against the calibrated tolerance before Deploy 2.');
    } finally {
        db.close();
    }
}

main();
