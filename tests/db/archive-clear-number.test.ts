import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { ARCHIVE_DB_PATH, closeArchiveDb, getArchiveDb } from '@/lib/db/archive';
import {
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
 * The fixture is nine real runs carrying exactly those two traps: 14537310174 (after the
 * pin, flag 0, phase 0 — the disjunctive rule counts it, the pinned rule does not) and
 * 8249673559 (is_full_clear = 1, completed = 0 — the fireteam cleared it without him).
 * Four of the nine are Pinned Full Clears, so the correct derivation ranks 1..4 and the
 * two wrong ones rank 1..5. See `targets` in tests/fixtures/archive-seed.json.
 *
 * The ordinals here are 1..4 over the sample rather than a real place among the 10,000:
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

        expect(ranked.map((run) => run.clearNumber)).toEqual([1, 2, 3, 4]);
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
        // over the disjunctive rule counts it, and then MAX(clear_number) is 5 here and
        // 10,020 in production, with the right row count either way.
        const disjunctiveOnly = rankedRuns().find((run) => run.instanceId === '14537310174');

        expect(disjunctiveOnly?.clearNumber).toBeNull();
        expect(readArchiveInvariants(getArchiveDb())).toEqual({
            maxClearNumber: 4,
            runsWithClearNumber: 4,
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

    it('clears an ordinal off a Run that is not a Pinned Full Clear', () => {
        db.prepare('UPDATE gos_10k_runs SET clear_number = 99 WHERE instance_id = ?')
            .run('8249673559');

        const invariants = deriveClearNumbers(db);

        expect(invariants).toEqual({ maxClearNumber: 4, runsWithClearNumber: 4 });
        expect(
            db.prepare('SELECT clear_number AS n FROM gos_10k_runs WHERE instance_id = ?')
                .get('8249673559')
        ).toEqual({ n: null });
        db.close();
    });

    it('refuses to report invariants when the ordinals are not contiguous', () => {
        // Not a mistake this derivation makes — it is the assertion that would catch one,
        // and the build script reports it rather than writing a manifest asserting it.
        deriveClearNumbers(db);
        db.prepare('UPDATE gos_10k_runs SET clear_number = 99 WHERE clear_number = 4').run();

        expect(() => readArchiveInvariants(db)).toThrow(/not contiguous/);
        db.close();
    });
});
