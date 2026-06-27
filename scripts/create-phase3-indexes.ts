/**
 * Denormalization Phase 3 — Deploy 1: create the `ended_at` reader-cutover indexes.
 *
 * Behavior-neutral: nothing reads these indexes until the Deploy 2 reader cutover.
 * Run with ingestion (crawler/scanner/discover) stopped — `CREATE INDEX` takes a
 * write lock and is not instant on millions of rows. Wraps the run in the
 * `isVacuuming` gate so /api/discovery and ad-hoc discover bail during the lock;
 * the web tier stays up (WAL readers are unaffected; nothing reads these yet).
 *
 *   npm run create-phase3-indexes   # or: npx tsx scripts/create-phase3-indexes.ts
 *
 * Idempotent (IF NOT EXISTS) and safe to re-run. The same DDL also lives in
 * src/lib/db/schema.ts so fresh/dev DBs get the indexes automatically; this script
 * is the controlled build for the large prod DB.
 */
import 'dotenv/config';
import type Database from 'better-sqlite3';
import { openMaintenanceDb, DB_PATH } from '../src/lib/db';
import { setVacuumingActive } from '../src/lib/maintenance/state';

const INDEXES: { name: string; ddl: string }[] = [
    {
        name: 'idx_pgcrs_raid_ended',
        ddl: 'CREATE INDEX IF NOT EXISTS idx_pgcrs_raid_ended ON pgcrs(raid_key, ended_at)',
    },
    {
        name: 'idx_pgcrs_ended',
        ddl: 'CREATE INDEX IF NOT EXISTS idx_pgcrs_ended ON pgcrs(ended_at)',
    },
    {
        name: 'idx_pgcr_players_instance_completed_member',
        ddl: 'CREATE INDEX IF NOT EXISTS idx_pgcr_players_instance_completed_member ON pgcr_players(instance_id, completed, membership_id)',
    },
    {
        name: 'idx_pgcr_players_member_completed_instance',
        ddl: 'CREATE INDEX IF NOT EXISTS idx_pgcr_players_member_completed_instance ON pgcr_players(membership_id, completed, instance_id)',
    },
];

function log(message: string): void {
    console.log(`[create-phase3-indexes] ${message}`);
}

function fmt(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function preflight(db: Database.Database): void {
    const cols = db.prepare('PRAGMA table_info(pgcrs)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'ended_at')) {
        throw new Error('pgcrs.ended_at column not found — Phase 1 migration is not applied to this DB.');
    }
    const nullCount = (
        db.prepare('SELECT COUNT(*) AS n FROM pgcrs WHERE ended_at IS NULL').get() as { n: number }
    ).n;
    if (nullCount > 0) {
        log(`NOTE: ${nullCount.toLocaleString()} rows still have ended_at IS NULL (expected only degenerate rows post-backfill).`);
    }
}

function main(): void {
    log(`DB: ${DB_PATH}`);
    setVacuumingActive(true);
    const db = openMaintenanceDb();
    try {
        preflight(db);
        for (const { name, ddl } of INDEXES) {
            const t0 = Date.now();
            log(`creating ${name}…`);
            db.exec(ddl);
            log(`  ${name} done (${fmt(Date.now() - t0)})`);
        }
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
        log('All Phase 3 indexes present. Run `npm run verify-phase3-cutover` next (gate before Deploy 2).');
    } finally {
        db.close();
        setVacuumingActive(false);
    }
}

main();
