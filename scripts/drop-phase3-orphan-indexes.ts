/**
 * Denormalization Phase 3 — Deploy 2 TAIL STEP: drop the indexes orphaned by the
 * reader cutover. Run only AFTER Deploy 2 is confirmed healthy in prod.
 *
 *   npm run drop-phase3-orphan-indexes   # or: npx tsx scripts/drop-phase3-orphan-indexes.ts
 *
 * Drops:
 *   - idx_pgcrs_raid_period         — superseded by idx_pgcrs_raid_ended; no query
 *                                     filters/sorts (raid_key, period) after the cutover.
 *   - idx_pgcr_players_completed    — single low-cardinality boolean; the planner won't
 *                                     use it; pure write overhead.
 *
 * KEEPS idx_pgcrs_period (still serves cleanupOldPGCRs `period < ?` and MIN/MAX(period)).
 *
 * DROP INDEX is fast (metadata only, frees pages lazily) and behavior-neutral here since
 * both indexes are confirmed unused. Light enough to run without pausing ingestion, but
 * the setVacuumingActive gate is used for consistency with the other maintenance scripts.
 */
import 'dotenv/config';
import { openMaintenanceDb, DB_PATH } from '../src/lib/db';
import { setVacuumingActive } from '../src/lib/maintenance/state';

const DROP = ['idx_pgcrs_raid_period', 'idx_pgcr_players_completed'];

function log(m: string): void {
    console.log(`[drop-phase3-orphan-indexes] ${m}`);
}

function main(): void {
    log(`DB: ${DB_PATH}`);
    setVacuumingActive(true);
    const db = openMaintenanceDb();
    try {
        const before = (db.prepare(
            `SELECT name FROM sqlite_master WHERE type='index' AND name IN (${DROP.map(() => '?').join(',')})`,
        ).all(...DROP) as { name: string }[]).map((r) => r.name);
        log(`present before: ${before.length ? before.join(', ') : '(none)'}`);

        for (const name of DROP) {
            db.exec(`DROP INDEX IF EXISTS ${name}`);
            log(`  dropped ${name}`);
        }
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
        log('Done. (idx_pgcrs_period retained by design.)');
    } finally {
        db.close();
        setVacuumingActive(false);
    }
}

main();
