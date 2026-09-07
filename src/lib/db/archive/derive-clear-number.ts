import type Database from 'better-sqlite3';
import { PINNED_FULL_CLEAR } from './predicates';

/**
 * Clear Number: the ordinal of each Pinned Full Clear by `period` ascending, 1 to
 * 10,000, NULL for every Run that is not one.
 *
 * **One derivation, two callers.** `scripts/build-gos10k-serving-db.ts` runs it over the
 * serving copy; `scripts/extract-archive-fixture.ts` runs it over the sampled rows on
 * their way into the committed test seed. That is the whole reason this is a module
 * rather than SQL in the build script: if the fixture ranked Runs its own way, every
 * Clear Number test would be testing a re-implementation and would stay green while
 * production ranked over the wrong predicate. See ADR 0008.
 *
 * Why stored at all rather than a `ROW_NUMBER()` in each query: the UI's range filter
 * speaks in Clear Numbers, so every panel inherits this ranking. An ordinal eight call
 * sites re-derive is an ordinal eight call sites can re-derive *differently*, over a
 * predicate this codebase has already got wrong twice. ADR 0008 has the rest.
 *
 * Writes, so it is only ever called against a build artifact in progress — never against
 * `data/gos-10k.db` in place, which the app opens `readonly`, and never against the
 * master, which nothing writes to.
 */

export const CLEAR_NUMBER_INDEX = 'idx_gos_10k_runs_clear_number';

/**
 * What the manifest records and `getArchiveDb()` re-checks at open. Row counts cannot
 * catch a bad derivation: ranked over the disjunctive rule instead of the pinned one,
 * `clear_number` has the right number of rows, the right number of non-NULLs, and a
 * maximum of 10,020.
 */
export interface ArchiveInvariants {
    /** `MAX(clear_number)` — 10,000 on the real dataset. */
    maxClearNumber: number;
    /** Runs carrying one — equal to the maximum, because the ordinals are contiguous. */
    runsWithClearNumber: number;
}

function hasClearNumberColumn(db: Database.Database): boolean {
    const columns = db.prepare('PRAGMA table_info(gos_10k_runs)').all() as Array<{ name: string }>;
    return columns.some((column) => column.name === 'clear_number');
}

/**
 * Derives `clear_number` onto `gos_10k_runs`, indexes it, and returns the invariants
 * the manifest should carry.
 *
 * Idempotent: re-running clears the column first, so a rebuild over a file that already
 * carries the derivation cannot leave a stale ordinal on a Run that stopped qualifying.
 */
export function deriveClearNumbers(db: Database.Database): ArchiveInvariants {
    const derive = db.transaction(() => {
        if (!hasClearNumberColumn(db)) {
            db.exec('ALTER TABLE gos_10k_runs ADD COLUMN clear_number INTEGER');
        }

        db.exec('UPDATE gos_10k_runs SET clear_number = NULL');

        // `instance_id` breaks period ties, so the same input always produces the same
        // ranking — a fixture whose ordinals shuffled between extractions would make
        // every assertion below it a coin toss.
        db.exec(`
            WITH ranked AS (
                SELECT
                    r.instance_id AS instance_id,
                    ROW_NUMBER() OVER (ORDER BY r.period ASC, r.instance_id ASC) AS clear_number
                FROM gos_10k_runs r
                WHERE ${PINNED_FULL_CLEAR}
            )
            UPDATE gos_10k_runs
            SET clear_number = (
                SELECT ranked.clear_number FROM ranked
                WHERE ranked.instance_id = gos_10k_runs.instance_id
            )
            WHERE instance_id IN (SELECT instance_id FROM ranked)
        `);

        // A Clear Number range must be a range scan, not a re-ranking of 13,420 Runs.
        db.exec(`CREATE INDEX IF NOT EXISTS ${CLEAR_NUMBER_INDEX} ON gos_10k_runs(clear_number)`);
    });

    derive();

    return readArchiveInvariants(db);
}

/**
 * Reads the invariants off a database that already carries the derivation.
 *
 * Also the structural check the build script has no other way to make: the ordinals are
 * contiguous from 1, so the maximum and the count are the same number. They disagree
 * only if the ranking skipped or duplicated a row, which no correct derivation does and
 * which no row count would reveal.
 */
export function readArchiveInvariants(db: Database.Database): ArchiveInvariants {
    const row = db.prepare(`
        SELECT
            COALESCE(MAX(clear_number), 0) AS maxClearNumber,
            COUNT(clear_number) AS runsWithClearNumber
        FROM gos_10k_runs
    `).get() as ArchiveInvariants;

    if (row.maxClearNumber !== row.runsWithClearNumber) {
        throw new Error(
            `clear_number is not contiguous: maximum ${row.maxClearNumber} over ` +
            `${row.runsWithClearNumber} Runs carrying one. The ranking skipped or duplicated ` +
            `a Run; refusing to report invariants that would then be asserted at open.`
        );
    }

    return row;
}
