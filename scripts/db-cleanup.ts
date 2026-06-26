/**
 * Standalone full DB cleanup: quick_check → wal_checkpoint(TRUNCATE) → VACUUM → ANALYZE.
 *
 * Reusable on its own; intended to run after the Phase 2 backfill to compact the pages
 * dirtied by populating millions of previously-NULL `ended_at` rows.
 *
 *   npm run db-cleanup            # or: npx tsx scripts/db-cleanup.ts
 *
 * Run with ingestion stopped. VACUUM holds an exclusive lock and needs ≈ DB-size free disk.
 * Wraps the run in the existing `isVacuuming` gate so /api/discovery and ad-hoc discover bail
 * during the lock; the web tier otherwise stays up (WAL readers are unaffected).
 *
 * Mirrors the proven sequence in src/lib/bungie/maintenance.ts (validateQuickCheck /
 * runSqlMaintenanceOnce), run through better-sqlite3 so it uses the app's exact SQLite engine.
 */
import 'dotenv/config';
import type Database from 'better-sqlite3';
import { openMaintenanceDb, DB_PATH } from '../src/lib/db';
import { setVacuumingActive } from '../src/lib/maintenance/state';

function log(message: string): void {
    console.log(`[db-cleanup] ${message}`);
}

function fmt(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function step(name: string, fn: () => void): void {
    const t0 = Date.now();
    log(`${name}…`);
    fn();
    log(`  ${name} done (${fmt(Date.now() - t0)})`);
}

function quickCheck(db: Database.Database): void {
    const rows = db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
    const failed = rows.some((row) => Object.values(row)[0] !== 'ok');
    if (failed) {
        throw new Error(`PRAGMA quick_check failed: ${JSON.stringify(rows)}`);
    }
}

function main(): void {
    log(`DB: ${DB_PATH}`);
    setVacuumingActive(true);
    const db = openMaintenanceDb();
    try {
        step('quick_check', () => quickCheck(db));
        step('wal_checkpoint(TRUNCATE)', () => {
            db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
        });
        step('VACUUM', () => db.exec('VACUUM;'));
        step('ANALYZE', () => db.exec('ANALYZE;'));
        log('Cleanup complete.');
    } finally {
        db.close();
        setVacuumingActive(false);
    }
}

main();
