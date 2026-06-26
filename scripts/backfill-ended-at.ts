/**
 * Denormalization Phase 2 — backfill `pgcrs.ended_at` for historical (NULL) rows.
 *
 * One-time, resumable, batched data migration. Run with ingestion (crawler/scanner/
 * discover) stopped. Readers are still on the old CTE, so this changes no site behavior.
 *
 *   npm run backfill-ended-at            # or: npx tsx scripts/backfill-ended-at.ts
 *   npx tsx scripts/backfill-ended-at.ts --batch 25000 --start-rowid 4000000
 *
 * Formula: ended_at = period + MAX(time_played_seconds) over ALL players of the instance
 * (mirrors the Phase 1 writer's completion-orthogonal semantics; historical rows can only
 * use this floor tier since start_seconds / activityDurationSeconds were never persisted).
 *
 * Technique: aggregate once into a TEMP table, then a single rowid-cursor sweep of batched
 * `UPDATE … FROM`. The `ended_at IS NULL` guard makes every batch idempotent and the whole
 * run safe to re-run / resume. NOT loop-until-no-NULL — degenerate rows stay NULL forever.
 */
import 'dotenv/config';
import type Database from 'better-sqlite3';
import { openMaintenanceDb, DB_PATH } from '../src/lib/db';
import { initializeSchema } from '../src/lib/db/schema';

const DEFAULT_BATCH = 50_000;
const CHECKPOINT_EVERY_BATCHES = 20;

function arg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function log(message: string): void {
    console.log(`[backfill] ${message}`);
}

function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h${String(m).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`;
}

function count(db: Database.Database, sql: string): number {
    const row = db.prepare(sql).get() as { n: number } | undefined;
    return row ? row.n : 0;
}

function preflight(db: Database.Database): { nullCount: number } {
    const cols = db.prepare('PRAGMA table_info(pgcrs)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'ended_at')) {
        throw new Error('pgcrs.ended_at column not found — Phase 1 migration is not applied to this DB.');
    }

    const recentPopulated = count(
        db,
        `SELECT COUNT(*) AS n FROM (SELECT ended_at FROM pgcrs ORDER BY rowid DESC LIMIT 200) WHERE ended_at IS NOT NULL`,
    );
    if (recentPopulated === 0) {
        log('WARNING: no recent rows have ended_at populated — is the Phase 1 writer deployed? Continuing.');
    }

    const total = count(db, `SELECT COUNT(*) AS n FROM pgcrs`);
    const nullCount = count(db, `SELECT COUNT(*) AS n FROM pgcrs WHERE ended_at IS NULL`);
    log(`DB: ${DB_PATH}`);
    log(`pgcrs total rows: ${total.toLocaleString()}`);
    log(`rows needing backfill (ended_at IS NULL): ${nullCount.toLocaleString()}`);
    return { nullCount };
}

function buildTempTable(db: Database.Database): void {
    const t0 = Date.now();
    log('Step 1/3: aggregating MAX(time_played_seconds) per instance over all players…');
    db.exec(`
        CREATE TEMP TABLE run_dur AS
          SELECT instance_id, MAX(time_played_seconds) AS max_dur
          FROM pgcr_players
          WHERE time_played_seconds > 0
          GROUP BY instance_id;
    `);
    log('Step 2/3: indexing temp table…');
    db.exec(`CREATE INDEX temp.idx_run_dur ON run_dur(instance_id);`);
    const tempRows = count(db, `SELECT COUNT(*) AS n FROM run_dur`);
    log(`  temp run_dur ready: ${tempRows.toLocaleString()} instances (${fmtDuration(Date.now() - t0)})`);
}

function sweep(db: Database.Database, batchSize: number, startRowid: number | undefined): void {
    const minRow = (db.prepare(`SELECT MIN(rowid) AS n FROM pgcrs`).get() as { n: number | null }).n;
    const maxRow = (db.prepare(`SELECT MAX(rowid) AS n FROM pgcrs`).get() as { n: number | null }).n;
    if (minRow == null || maxRow == null) {
        log('pgcrs is empty — nothing to do.');
        return;
    }

    const update = db.prepare(`
        UPDATE pgcrs
        SET ended_at = pgcrs.period + d.max_dur
        FROM run_dur d
        WHERE d.instance_id = pgcrs.instance_id
          AND pgcrs.rowid > ?
          AND pgcrs.rowid <= ?
          AND pgcrs.ended_at IS NULL
    `);

    let cursor = startRowid != null ? startRowid : minRow - 1;
    log(`Step 3/3: rowid sweep ${(cursor + 1).toLocaleString()}..${maxRow.toLocaleString()} (batch ${batchSize.toLocaleString()})`);

    const t0 = Date.now();
    const sweepStart = cursor;
    let updated = 0;
    let batches = 0;

    while (cursor < maxRow) {
        const lo = cursor;
        const hi = Math.min(cursor + batchSize, maxRow);
        const result = update.run(lo, hi);
        updated += result.changes;
        cursor = hi;
        batches += 1;

        if (batches % CHECKPOINT_EVERY_BATCHES === 0) {
            db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
            const done = cursor - sweepStart;
            const span = maxRow - sweepStart;
            const pct = span > 0 ? (done / span) * 100 : 100;
            const elapsed = Date.now() - t0;
            const eta = pct > 0 ? (elapsed / pct) * (100 - pct) : 0;
            log(
                `  ${pct.toFixed(1)}% | rowid ${cursor.toLocaleString()}/${maxRow.toLocaleString()} | ` +
                `updated ${updated.toLocaleString()} | elapsed ${fmtDuration(elapsed)} | ETA ${fmtDuration(eta)}`,
            );
        }
    }

    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    log(`Sweep complete: updated ${updated.toLocaleString()} rows in ${batches} batches (${fmtDuration(Date.now() - t0)})`);
}

function main(): void {
    const batchSize = parsePositiveInt(arg('--batch') ?? process.env.BACKFILL_BATCH_SIZE, DEFAULT_BATCH);
    const startRowidArg = arg('--start-rowid');
    const startRowid = startRowidArg != null ? parseInt(startRowidArg, 10) : undefined;

    const db = openMaintenanceDb();
    try {
        initializeSchema(db); // idempotent; ensures the Phase 1 ended_at migration is applied

        const { nullCount } = preflight(db);
        if (nullCount === 0) {
            log('No rows need backfilling. Done.');
            return;
        }

        buildTempTable(db);
        sweep(db, batchSize, startRowid);

        const remaining = count(db, `SELECT COUNT(*) AS n FROM pgcrs WHERE ended_at IS NULL`);
        log(`Final ended_at IS NULL count: ${remaining.toLocaleString()} (expected: only degenerate rows with no positive time_played_seconds)`);
        log('Backfill finished. Run `npm run db-cleanup` to VACUUM/ANALYZE.');
    } finally {
        db.close();
    }
}

main();
