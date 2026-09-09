import type Database from 'better-sqlite3';

/**
 * Replays a captured Archive schema and its rows into a SQLite handle.
 *
 * Two callers, at the two ends of one round trip: `scripts/extract-archive-fixture.ts`
 * replays the sampled rows into an in-memory database to derive over them, and
 * ./archive-seed.ts replays the committed result into the throwaway fixture file. They
 * have to agree on how a row becomes SQL — a change to identifier quoting, or the first
 * BLOB or JSON column, or a column one side omits — and when they were two copies, the
 * fixture the tests build could quietly stop matching the fixture the extractor derived
 * over.
 *
 * Lives in tests/helpers/ and therefore, per CLAUDE.md: no import from `vitest`
 * (Playwright loads this directory too) and relative imports only. A `tsx` script under
 * scripts/ is now a third consumer, which those same two constraints already allow.
 */

/** What better-sqlite3 will bind. The rows come from SQLite and go back to it. */
export type ArchiveCell = string | number | bigint | Buffer | null;
export type ArchiveRow = Record<string, ArchiveCell>;

export function replayArchiveRows(
    db: Database.Database,
    schema: string[],
    tables: Record<string, ArchiveRow[]>
): void {
    // The schema is the master's own DDL, captured at extract time, so neither copy of
    // the fixture can drift from the database the queries run against in production.
    for (const statement of schema) {
        db.exec(statement);
    }

    for (const [table, rows] of Object.entries(tables)) {
        if (rows.length === 0) continue;

        const columns = Object.keys(rows[0]);
        const insert = db.prepare(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        );
        const insertAll = db.transaction((batch: ArchiveRow[]) => {
            for (const row of batch) {
                insert.run(columns.map((column) => row[column]));
            }
        });
        insertAll(rows);
    }
}
