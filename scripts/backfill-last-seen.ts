/**
 * Backfill `players.last_seen_at` — the denormalized max `pgcrs.ended_at` across
 * every PGCR a player appears in. Replaces the per-cycle pgcr_players ⋈ pgcrs
 * aggregation in the tiered crawl bucket selection (and active-session polling).
 *
 * One-time, resumable, batched. Run with ingestion (crawler/scanner/discover)
 * stopped — the sweep takes a write lock. Safe to re-run / resume; the value is
 * recomputed identically each pass and the guard skips rows already correct.
 *
 *   npm run backfill-last-seen           # or: npx tsx scripts/backfill-last-seen.ts
 *   npx tsx scripts/backfill-last-seen.ts --batch 50000 --start-rowid 200000
 *
 * Players with no completed PGCRs are left NULL (→ cold bucket), matching the
 * pre-denorm "never seen → cold" behavior. The same column migration lives in
 * src/lib/db/schema.ts so fresh/dev DBs get it automatically; ongoing values are
 * maintained by insertFullPGCR. This script is the controlled historical fill.
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
    console.log(`[backfill-last-seen] ${message}`);
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

function preflight(db: Database.Database): void {
    const cols = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'last_seen_at')) {
        throw new Error('players.last_seen_at column not found — schema migration is not applied to this DB.');
    }
    const total = count(db, `SELECT COUNT(*) AS n FROM players`);
    const populated = count(db, `SELECT COUNT(*) AS n FROM players WHERE last_seen_at IS NOT NULL`);
    log(`DB: ${DB_PATH}`);
    log(`players total rows: ${total.toLocaleString()}`);
    log(`already populated (last_seen_at IS NOT NULL): ${populated.toLocaleString()}`);
}

function buildTempTable(db: Database.Database): void {
    const t0 = Date.now();
    log('Step 1/3: aggregating MAX(pgcrs.ended_at) per player over all PGCRs…');
    db.exec(`
        CREATE TEMP TABLE player_last_seen AS
          SELECT pp.membership_id AS membership_id, MAX(pg.ended_at) AS last_seen
          FROM pgcr_players pp
          INNER JOIN pgcrs pg ON pg.instance_id = pp.instance_id
          WHERE pg.ended_at IS NOT NULL
          GROUP BY pp.membership_id;
    `);
    log('Step 2/3: indexing temp table…');
    db.exec(`CREATE INDEX temp.idx_player_last_seen ON player_last_seen(membership_id);`);
    const tempRows = count(db, `SELECT COUNT(*) AS n FROM player_last_seen`);
    log(`  temp player_last_seen ready: ${tempRows.toLocaleString()} players (${fmtDuration(Date.now() - t0)})`);
}

function sweep(db: Database.Database, batchSize: number, startRowid: number | undefined): void {
    const minRow = (db.prepare(`SELECT MIN(rowid) AS n FROM players`).get() as { n: number | null }).n;
    const maxRow = (db.prepare(`SELECT MAX(rowid) AS n FROM players`).get() as { n: number | null }).n;
    if (minRow == null || maxRow == null) {
        log('players is empty — nothing to do.');
        return;
    }

    // Guard makes each batch idempotent: only writes rows whose value differs.
    const update = db.prepare(`
        UPDATE players
        SET last_seen_at = s.last_seen
        FROM player_last_seen s
        WHERE s.membership_id = players.membership_id
          AND players.rowid > ?
          AND players.rowid <= ?
          AND (players.last_seen_at IS NULL OR players.last_seen_at <> s.last_seen)
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
        initializeSchema(db); // idempotent; ensures the last_seen_at migration + index exist

        preflight(db);
        buildTempTable(db);
        sweep(db, batchSize, startRowid);

        const populated = count(db, `SELECT COUNT(*) AS n FROM players WHERE last_seen_at IS NOT NULL`);
        const stillNull = count(db, `SELECT COUNT(*) AS n FROM players WHERE last_seen_at IS NULL`);
        log(`Final: ${populated.toLocaleString()} populated, ${stillNull.toLocaleString()} NULL (players with no completed PGCR → cold bucket).`);
        log('Backfill finished. Run `npm run db-cleanup` to VACUUM/ANALYZE.');
    } finally {
        db.close();
    }
}

main();
