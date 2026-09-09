import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import {
    ARCHIVE_DB_PATH,
    closeArchiveDb,
    getArchiveDb,
    isArchiveUnavailableError,
    verifyArchiveInvariants,
    verifyArchiveRowCounts,
} from '@/lib/db/archive';

/**
 * The Archive is a build artifact deployed by hand: two scp steps that no CI check
 * enforces (ADR 0007). These are the two failures that would otherwise be silent — a
 * file that is not there, and a file that is the wrong one — and the row-count check is
 * what stands in for the build-time failure that dynamic rendering gave up.
 *
 * verifyArchiveRowCounts() and verifyArchiveInvariants() are exercised directly rather
 * than through getArchiveDb(), which skips both for the fixture: the fixture is a nine-run
 * sample and cannot satisfy production figures by construction.
 *
 * The invariant check is the one that catches a third failure the row counts cannot see —
 * a derived column ranked over the wrong rule, which has the right row count and a
 * plausible wrong maximum (ADR 0008).
 */

// `beforeEach`, not the `beforeAll` tests/README.md prescribes for Archive tests:
// specs below delete and overwrite the fixture file to exercise the failure paths,
// so there is nothing left for a later test to reuse. Read-only Archive tests should
// still use `beforeAll`.
beforeEach(() => {
    closeArchiveDb();
    buildFixtureArchive();
});

afterEach(() => {
    closeArchiveDb();
});

/** A second handle on the fixture, for the verifiers that are tested directly. */
function openFixture(): Database.Database {
    return new Database(ARCHIVE_DB_PATH, { readonly: true, fileMustExist: true });
}

describe('the Archive connection', () => {
    it('opens the throwaway fixture, not the real database', () => {
        expect(ARCHIVE_DB_PATH).toBe(process.env.DFF_TEST_GOS10K_DB_SENTINEL);
        expect(getArchiveDb().name).toBe(ARCHIVE_DB_PATH);
    });

    it('refuses to write, because the data is frozen', () => {
        expect(() => getArchiveDb().exec('DELETE FROM gos_10k_runs')).toThrow(/readonly/i);
    });

    it('says the file is missing rather than creating an empty one', () => {
        // The disaster scenario is not an error, it is a page that renders "0 runs"
        // off a database SQLite helpfully created. fileMustExist plus this check make
        // a forgotten scp loud.
        closeArchiveDb();
        fs.rmSync(ARCHIVE_DB_PATH);

        expect(() => getArchiveDb()).toThrow(/No Archive database/);
        expect(fs.existsSync(ARCHIVE_DB_PATH)).toBe(false);
    });
});

describe('the manifest row-count check', () => {
    it('passes when the file matches what was built', () => {
        const db = openFixture();
        expect(() =>
            verifyArchiveRowCounts(db, { gos_10k_runs: 9 }, ARCHIVE_DB_PATH)
        ).not.toThrow();
        db.close();
    });

    it('names the table and both counts when a stale copy is short', () => {
        // What a truncated or pre-2026-09-03 scp actually looks like: every query still
        // works, every number is plausible, and the total is wrong.
        const db = openFixture();
        try {
            verifyArchiveRowCounts(db, { gos_10k_runs: 13420 }, ARCHIVE_DB_PATH);
            expect.unreachable('expected the mismatch to throw');
        } catch (error) {
            expect(isArchiveUnavailableError(error)).toBe(true);
            expect((error as Error).message).toContain('gos_10k_runs: expected 13420, found 9');
            expect((error as Error).message).toContain('npm run build-gos10k');
        }
        db.close();
    });

    it('reports a missing table rather than throwing a SQL error', () => {
        const db = openFixture();
        expect(() => verifyArchiveRowCounts(db, { gos_10k_nonexistent: 1 }, ARCHIVE_DB_PATH))
            .toThrow(/gos_10k_nonexistent: table is missing/);
        db.close();
    });
});

describe('the manifest invariant assertions', () => {
    it('passes when the derived column matches what was built', () => {
        // Four of the fixture's nine runs are Pinned Full Clears, ranked 1..4.
        const db = openFixture();
        expect(() =>
            verifyArchiveInvariants(db, { maxClearNumber: 4, runsWithClearNumber: 4 }, ARCHIVE_DB_PATH)
        ).not.toThrow();
        db.close();
    });

    it('names both figures when the ranking used the wrong full-clear rule', () => {
        // What that failure looks like in production: 10,020 ordinals over 10,020 Runs, and
        // every row count in the manifest still correct. On the fixture the same mistake is
        // 5 and 5 against an expected 4 and 4.
        const db = openFixture();
        try {
            verifyArchiveInvariants(
                db,
                { maxClearNumber: 5, runsWithClearNumber: 5 },
                ARCHIVE_DB_PATH
            );
            expect.unreachable('expected the mismatch to throw');
        } catch (error) {
            expect(isArchiveUnavailableError(error)).toBe(true);
            expect((error as Error).message).toContain('maxClearNumber: expected 5, found 4');
            expect((error as Error).message).toContain('runsWithClearNumber: expected 5, found 4');
            expect((error as Error).message).toContain('npm run build-gos10k');
        }
        db.close();
    });

    it('reports a file with no derived column rather than throwing a SQL error', () => {
        // A serving copy built before the derivation existed: every row count matches, and
        // it is the manifest\'s own figures that are unanswerable.
        closeArchiveDb();
        const writable = new Database(ARCHIVE_DB_PATH);
        writable.exec('DROP INDEX idx_gos_10k_runs_clear_number');
        writable.exec('ALTER TABLE gos_10k_runs DROP COLUMN clear_number');
        writable.close();

        const db = openFixture();
        try {
            verifyArchiveInvariants(db, { maxClearNumber: 4, runsWithClearNumber: 4 }, ARCHIVE_DB_PATH);
            expect.unreachable('expected the missing column to throw');
        } catch (error) {
            expect(isArchiveUnavailableError(error)).toBe(true);
            expect((error as Error).message).toContain('usable clear_number');
            expect((error as Error).message).toContain('npm run build-gos10k');
        }
        db.close();
    });
});
