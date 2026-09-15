import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb, getArchiveDb } from '@/lib/db/archive';
import {
    CHECKPOINT_RUN,
    CLEARED_WITHOUT_SUBJECT,
    getNonClearRuns,
    PINNED_FULL_CLEAR,
    RESET,
    STARTED_FROM_BEGINNING_PINNED,
} from '@/lib/db/archive/queries';

/**
 * The Resets panel (#93), against the fixture Archive.
 *
 * The panel is about every Run that did not become a Pinned Full Clear, split into the
 * populations #81 names. Every way it can be wrong returns a plausible number: reading a
 * Reset as `is_full_clear = 0` sweeps the finished Checkpoint Runs in with the abandoned
 * ones; dropping `completed = 0` from "cleared without him" counts the clears themselves;
 * reading "started from the beginning" differently from the 10,000 puts Runs other
 * players finished among the Resets; a bucket that overlaps another counts a Run twice
 * and still looks like a count. So the assertions are specific counts and seconds,
 * computed independently from tests/fixtures/archive-seed.json, and the populations are
 * checked to add back up to the Runs in range — which is only true if none of them
 * overlap and none of the Runs fall through.
 *
 * Fixture figures (#85): 406 Runs, 346 Pinned Full Clears. The three non-clear
 * populations are pinned by tests/db/archive-fixture-shape.test.ts, which is what fails
 * first if a re-extraction moves them.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

/** The populations, summed. Equal to `runs` only if they partition the range. */
function accountedFor(outcomes: ReturnType<typeof getNonClearRuns>): number {
    return (
        outcomes.pinnedFullClears +
        outcomes.resets +
        outcomes.clearedWithoutSubject +
        outcomes.checkpointRuns
    );
}

describe('the Runs that did not become clears, across the whole Archive', () => {
    it('splits the 60 non-clears into three populations', () => {
        // 21 Resets (5,651 s, 19 of them over inside ten minutes), 6 cleared without him
        // (54,479 s), 33 Checkpoint Runs — 23 he finished, 2 others finished without him.
        // Production: 2,897 / 40 / 483 (23 and 11).
        expect(getNonClearRuns()).toEqual({
            runs: 406,
            pinnedFullClears: 346,
            resets: 21,
            resetSeconds: 5651,
            quickResets: 19,
            clearedWithoutSubject: 6,
            clearedWithoutSubjectSeconds: 54479,
            checkpointRuns: 33,
            checkpointRunsFinished: 23,
            checkpointRunsClearedWithoutSubject: 2,
        });
    });

    it('accounts for every Run exactly once', () => {
        const outcomes = getNonClearRuns();

        expect(accountedFor(outcomes)).toBe(outcomes.runs);
    });

    it('puts every Run in exactly one population, not merely the right total', () => {
        // The sum above passes if one population double-counts a Run that another drops.
        // Per Run, the four predicates are 0/1 each and must add to exactly 1.
        const populations = [PINNED_FULL_CLEAR, RESET, CLEARED_WITHOUT_SUBJECT, CHECKPOINT_RUN];
        const misplaced = getArchiveDb().prepare(`
            SELECT r.instance_id FROM gos_10k_runs r
            WHERE ${populations.map((p) => `(${p})`).join(' + ')} IS NOT 1
        `).all();

        expect(misplaced).toEqual([]);
    });

    it('reads "started from the beginning" exactly as the stored full-clear flag does', () => {
        // The partition leans on is_full_clear meaning "the pinned start reading, and
        // somebody finished". If the stored column and STARTED_FROM_BEGINNING_PINNED ever
        // disagree, a Run someone finished can land among the Resets — the fault the
        // disjunctive reading had in 9 production Runs. Checked on every fixture Run.
        const disagreeing = getArchiveDb().prepare(`
            SELECT r.instance_id FROM gos_10k_runs r
            WHERE r.is_full_clear IS NOT (${STARTED_FROM_BEGINNING_PINNED} AND EXISTS (
                SELECT 1 FROM gos_10k_pgcr_players p
                WHERE p.instance_id = r.instance_id AND p.completed = 1
            ))
        `).all();

        expect(disagreeing).toEqual([]);
    });
});

describe('obeying the active range', () => {
    it('counts only the Runs inside the range', () => {
        // February 2022: 44 Runs, 41 Pinned Full Clears (pinned by
        // tests/db/archive-range.test.ts). The other three are Resets of 218, 165 and
        // 208 seconds — all restarts.
        const february = resolveArchiveRangeFromParams({ from: '2022-02-01', to: '2022-02-28' });

        expect(getNonClearRuns(february)).toEqual({
            runs: 44,
            pinnedFullClears: 41,
            resets: 3,
            resetSeconds: 591,
            quickResets: 3,
            clearedWithoutSubject: 0,
            clearedWithoutSubjectSeconds: 0,
            checkpointRuns: 0,
            checkpointRunsFinished: 0,
            checkpointRunsClearedWithoutSubject: 0,
        });
    });

    it('keeps a long Reset out of the restart count', () => {
        // January 2022: three Resets, one of them 1,215 seconds — a fireteam that gave up
        // twenty minutes in, which the restart count must not absorb.
        const january = resolveArchiveRangeFromParams({ from: '2022-01-01', to: '2022-01-31' });

        expect(getNonClearRuns(january)).toEqual({
            runs: 44,
            pinnedFullClears: 41,
            resets: 3,
            resetSeconds: 1431,
            quickResets: 2,
            clearedWithoutSubject: 0,
            clearedWithoutSubjectSeconds: 0,
            checkpointRuns: 0,
            checkpointRunsFinished: 0,
            checkpointRunsClearedWithoutSubject: 0,
        });
    });

    it('counts post-pin Runs Bungie does not mark as started from the beginning as Checkpoint Runs', () => {
        // April 2022, after the pin: every Run carries phase 0, so only Bungie's flag says
        // where it began. 14 have it unset — 12 he finished, 2 nobody did — and all 14 are
        // Checkpoint Runs, including a 4,045-second one the disjunctive reading called a
        // Reset. One 97-second Reset is left.
        const april = resolveArchiveRangeFromParams({ from: '2022-04-01', to: '2022-04-30' });

        expect(getNonClearRuns(april)).toEqual({
            runs: 55,
            pinnedFullClears: 40,
            resets: 1,
            resetSeconds: 97,
            quickResets: 1,
            clearedWithoutSubject: 0,
            clearedWithoutSubjectSeconds: 0,
            checkpointRuns: 14,
            checkpointRunsFinished: 12,
            checkpointRunsClearedWithoutSubject: 0,
        });
        expect(accountedFor(getNonClearRuns(april))).toBe(55);
    });

    it('finds the Checkpoint Runs and a clear without him in their own month', () => {
        // October 2020: 9 Runs. Five Checkpoint Runs by phase index — two he finished, one
        // his fireteam finished without him, two nobody did — and one 3,340-second Run the
        // fireteam cleared from the start after he had gone.
        const october2020 = resolveArchiveRangeFromParams({ from: '2020-10-01', to: '2020-10-31' });

        expect(getNonClearRuns(october2020)).toEqual({
            runs: 9,
            pinnedFullClears: 3,
            resets: 0,
            resetSeconds: 0,
            quickResets: 0,
            clearedWithoutSubject: 1,
            clearedWithoutSubjectSeconds: 3340,
            checkpointRuns: 5,
            checkpointRunsFinished: 2,
            checkpointRunsClearedWithoutSubject: 1,
        });
        expect(accountedFor(getNonClearRuns(october2020))).toBe(9);
    });

    it('reports zeroes, not nulls, for a range that is one clear', () => {
        // Clear 102 alone: a Clear Number range resolves to that Run's own instant, so the
        // window holds one Run and it is a clear. The panel renders its empty state over
        // this; the query's job is to say "none" in numbers.
        const clear102 = resolveArchiveRangeFromParams({ clearFrom: '102', clearTo: '102' });

        expect(getNonClearRuns(clear102)).toEqual({
            runs: 1,
            pinnedFullClears: 1,
            resets: 0,
            resetSeconds: 0,
            quickResets: 0,
            clearedWithoutSubject: 0,
            clearedWithoutSubjectSeconds: 0,
            checkpointRuns: 0,
            checkpointRunsFinished: 0,
            checkpointRunsClearedWithoutSubject: 0,
        });
    });
});
