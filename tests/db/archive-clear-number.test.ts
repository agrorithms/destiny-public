import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { ARCHIVE_DB_PATH, closeArchiveDb, getArchiveDb } from '@/lib/db/archive';
import {
    assertContiguousClearNumbers,
    CLEAR_NUMBER_INDEX,
    deriveClearNumbers,
    readArchiveInvariants,
} from '@/lib/db/archive/derive-clear-number';

/**
 * Clear Number is the ranking every Phase 1 panel inherits, so the failure worth catching
 * is not "the column is missing" — it is a column ranked over a *plausible wrong*
 * predicate. Ranked over the disjunctive rule the real Archive gets 10,020 ordinals
 * instead of 10,000; ranked with the "and he finished it" conjunct dropped it gets 10,040.
 * Both have the right row count, both look healthy, and both put every downstream panel
 * a few hundred Runs out.
 *
 * The fixture is 406 real Runs carrying exactly those two traps: 14537310174 (after the
 * pin, flag 0, phase 0 — the disjunctive rule counts it, the pinned rule does not) and
 * 8249673559 (is_full_clear = 1, completed = 0 — the fireteam cleared it without him).
 * 346 of the 406 are Pinned Full Clears, so the correct derivation ranks 1..346; ranked
 * over the disjunctive rule it would rank 1..366, because the fixture carries all 20 of
 * the post-pin phase-0 Runs the two rules disagree about. See `targets` and `cohorts` in
 * tests/fixtures/archive-seed.json.
 *
 * The ordinals here are 1..346 over the sample rather than a real place among the 10,000:
 * the fixture is extracted, then run through the production derivation by
 * scripts/extract-archive-fixture.ts. It is the rule that is under test, not the numbers.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton.
    closeArchiveDb();
    buildFixtureArchive();
});

afterAll(() => {
    closeArchiveDb();
});

function rankedRuns(): Array<{ instanceId: string; period: number; clearNumber: number | null }> {
    return getArchiveDb().prepare(`
        SELECT instance_id AS instanceId, period, clear_number AS clearNumber
        FROM gos_10k_runs
        ORDER BY period ASC
    `).all() as Array<{ instanceId: string; period: number; clearNumber: number | null }>;
}

describe('the derived Clear Number', () => {
    it('numbers the Pinned Full Clears from 1 by period ascending', () => {
        const ranked = rankedRuns().filter((run) => run.clearNumber !== null);

        expect(ranked.map((run) => run.clearNumber))
            .toEqual(Array.from({ length: 346 }, (_, index) => index + 1));
        // Ascending by period is the definition, not an incidental ordering: the range
        // filter reads a Clear Number range as a date range on the strength of it.
        expect(ranked.map((run) => run.period)).toEqual([...ranked.map((run) => run.period)].sort((a, b) => a - b));
    });

    it('leaves the run the fireteam cleared without him unranked', () => {
        // 8249673559: is_full_clear = 1, completed = 0. Ranking over the stored column
        // alone gives this run an ordinal and pushes every later one up by 40 on the real
        // data — the harder of the two mistakes to notice.
        const withoutHim = rankedRuns().find((run) => run.instanceId === '8249673559');

        expect(withoutHim?.clearNumber).toBeNull();
    });

    it('leaves the flag-0 / phase-0 run after the pin unranked', () => {
        // 14537310174 is the 10,000-vs-10,020 difference in miniature. A derivation ranked
        // over the disjunctive rule counts it, and then MAX(clear_number) is 366 here and
        // 10,020 in production, with the right row count either way.
        const disjunctiveOnly = rankedRuns().find((run) => run.instanceId === '14537310174');

        expect(disjunctiveOnly?.clearNumber).toBeNull();
        expect(readArchiveInvariants(getArchiveDb())).toEqual({
            maxClearNumber: 346,
            runsWithClearNumber: 346,
        });
    });

    it('is indexed, so a Clear Number range is a range scan', () => {
        // Without the index a range filter re-reads every Run to answer "which thousand is
        // this", on a page whose every panel asks.
        const plan = getArchiveDb().prepare(`
            EXPLAIN QUERY PLAN
            SELECT instance_id FROM gos_10k_runs WHERE clear_number BETWEEN 2 AND 3
        `).all() as Array<{ detail: string }>;

        expect(plan.map((step) => step.detail).join(' ')).toContain(CLEAR_NUMBER_INDEX);
    });
});

describe('re-deriving over a database that already carries the column', () => {
    // The build script runs over a fresh vacuum today, but a rebuild against a file that
    // already has the column must not leave an ordinal on a Run that stopped qualifying —
    // a stale clear_number is indistinguishable from a real one.
    let db: Database.Database;

    beforeEach(() => {
        closeArchiveDb();
        buildFixtureArchive();
        db = new Database(ARCHIVE_DB_PATH);
    });

    // In the `it` body a failed assertion would leak the handle, and the next rebuild
    // deletes the file underneath it.
    afterEach(() => {
        db.close();
    });

    it('reproduces the ordinals the committed fixture already carries', () => {
        // The assertions above this describe read a seed whose clear_numbers were written
        // by scripts/extract-archive-fixture.ts, which needs the master and so cannot run
        // in CI. On their own they would keep passing against a broken derivation until
        // someone re-extracted. This runs the derivation live and demands the same answer.
        const before = db.prepare(
            'SELECT instance_id AS id, clear_number AS n FROM gos_10k_runs ORDER BY instance_id'
        ).all();

        deriveClearNumbers(db);

        expect(db.prepare(
            'SELECT instance_id AS id, clear_number AS n FROM gos_10k_runs ORDER BY instance_id'
        ).all()).toEqual(before);
    });

    it('clears an ordinal off a Run that is not a Pinned Full Clear', () => {
        // 9999, not a plausible ordinal: the fixture already uses 1..346, so a smaller
        // number would be indistinguishable from a real one if the reset ever stopped
        // happening.
        db.prepare('UPDATE gos_10k_runs SET clear_number = 9999 WHERE instance_id = ?')
            .run('8249673559');

        const invariants = deriveClearNumbers(db);

        expect(invariants).toEqual({ maxClearNumber: 346, runsWithClearNumber: 346 });
        expect(
            db.prepare('SELECT clear_number AS n FROM gos_10k_runs WHERE instance_id = ?')
                .get('8249673559')
        ).toEqual({ n: null });
    });

    it('refuses to report invariants when the ordinals are not contiguous', () => {
        // Not a mistake this derivation makes — it is the assertion that would catch one,
        // so that a build cannot write a manifest asserting a ranking that skipped a Run.
        // The reader stays a reader: it reports 9999 over 346, and the assertion is what
        // decides that is unusable.
        deriveClearNumbers(db);
        db.prepare('UPDATE gos_10k_runs SET clear_number = 9999 WHERE clear_number = 346').run();

        const invariants = readArchiveInvariants(db);

        expect(invariants).toEqual({ maxClearNumber: 9999, runsWithClearNumber: 346 });
        expect(() => assertContiguousClearNumbers(invariants)).toThrow(/not contiguous/);
    });
});
