/**
 * One-off cleanup for corrupted future-dated `pgcrs.ended_at` (and the denormalized
 * `players.last_seen_at` it poisoned).
 *
 * Background: `ended_at = period + activityDurationSeconds`. A few PGCRs (notably
 * farm/checkpoint "megalobby" instances with absurd Bungie durations) ended up with `ended_at`
 * days in the future. Since `last_seen_at = MAX(ended_at)` and active-session candidate ranking
 * is `ORDER BY last_seen_at DESC`, those rows captured the whole candidate pool and starved
 * active-session discovery. The ingest guard (FUTURE_ENDED_SKEW_SECONDS in queries.ts) stops new
 * occurrences; this script repairs the existing data.
 *
 * Steps:
 *   1. NULL out `pgcrs.ended_at` for rows dated beyond now + skew  (malformed → Tier-3 NULL).
 *   2. NULL out `players.last_seen_at` dated beyond now + skew      (reset before re-backfill —
 *      the backfill only recomputes players that still have a non-NULL ended_at PGCR, so a player
 *      whose ONLY PGCR was the nulled megalobby must be reset here or they'd keep the stale value).
 *   3. (separate command) re-run the backfill to recompute clean values:
 *        npx tsx scripts/backfill-last-seen.ts
 *
 * Run with ingestion (crawler/scanner/discover) stopped — these UPDATEs take a write lock.
 * Safe to re-run. Use --dry-run to preview affected counts without writing.
 *
 *   npx tsx scripts/clean-future-ended.ts --dry-run
 *   npx tsx scripts/clean-future-ended.ts
 */
import 'dotenv/config';
import type Database from 'better-sqlite3';
import { openMaintenanceDb, DB_PATH } from '../src/lib/db';
import { initializeSchema } from '../src/lib/db/schema';
import { FUTURE_ENDED_SKEW_SECONDS } from '../src/lib/db/queries';

function log(message: string): void {
    console.log(`[clean-future-ended] ${message}`);
}

function count(db: Database.Database, sql: string, ...params: number[]): number {
    const row = db.prepare(sql).get(...params) as { n: number } | undefined;
    return row ? row.n : 0;
}

function main(): void {
    const dryRun = process.argv.includes('--dry-run');
    const threshold = Math.floor(Date.now() / 1000) + FUTURE_ENDED_SKEW_SECONDS;

    const db = openMaintenanceDb();
    try {
        initializeSchema(db); // idempotent
        log(`DB: ${DB_PATH}`);
        log(`Threshold: ended_at/last_seen_at > ${threshold} (now + ${FUTURE_ENDED_SKEW_SECONDS}s) is treated as corrupt.`);

        const pgcrHits = count(db, `SELECT COUNT(*) AS n FROM pgcrs WHERE ended_at > ?`, threshold);
        const playerHits = count(db, `SELECT COUNT(*) AS n FROM players WHERE last_seen_at > ?`, threshold);
        log(`pgcrs with future ended_at: ${pgcrHits.toLocaleString()}`);
        log(`players with future last_seen_at: ${playerHits.toLocaleString()}`);

        if (dryRun) {
            log('--dry-run: no changes written.');
            return;
        }

        const tx = db.transaction(() => {
            const a = db.prepare(`UPDATE pgcrs SET ended_at = NULL WHERE ended_at > ?`).run(threshold);
            const b = db.prepare(`UPDATE players SET last_seen_at = NULL WHERE last_seen_at > ?`).run(threshold);
            return { pgcrs: a.changes, players: b.changes };
        });
        const result = tx();
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();

        log(`Step 1: nulled ended_at on ${result.pgcrs.toLocaleString()} pgcrs.`);
        log(`Step 2: reset last_seen_at on ${result.players.toLocaleString()} players.`);
        log('Step 3: now recompute clean last_seen_at values:');
        log('  npx tsx scripts/backfill-last-seen.ts');
    } finally {
        db.close();
    }
}

main();
