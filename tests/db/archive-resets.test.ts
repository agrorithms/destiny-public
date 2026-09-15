import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb } from '@/lib/db/archive';
import { getNonClearRuns } from '@/lib/db/archive/queries';

/**
 * The Resets panel (#93), against the fixture Archive.
 *
 * The panel is about every Run that did not become a Pinned Full Clear, split into the
 * populations #81 names. Every way it can be wrong returns a plausible number: reading a
 * Reset as `is_full_clear = 0` sweeps the finished Runs the pinned rule rejects in with
 * the abandoned ones; dropping `completed = 0` from "cleared without him" counts the
 * clears themselves; a bucket that overlaps another counts a Run twice and still looks
 * like a count. So the assertions are specific counts and seconds, computed
 * independently from tests/fixtures/archive-seed.json, and the populations are checked
 * to add back up to the Runs in range — which is only true if none of them overlap and
 * none of the Runs fall through.
 *
 * Fixture figures (#85): 406 Runs, 346 Pinned Full Clears. The four non-clear
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
        outcomes.unpinnedClears +
        outcomes.checkpointRuns
    );
}

describe('the Runs that did not become clears, across the whole Archive', () => {
    it('splits the 60 non-clears into the four populations', () => {
        // 26 Resets (13,019 s, 21 of them over inside ten minutes), 6 cleared without
        // him (54,479 s), 20 finished Runs the pinned rule rejects, 8 Checkpoint Runs.
        // Production: 3,352 / 40 / 20 / 8.
        expect(getNonClearRuns()).toEqual({
            runs: 406,
            pinnedFullClears: 346,
            resets: 26,
            resetSeconds: 13019,
            quickResets: 21,
            clearedWithoutSubject: 6,
            clearedWithoutSubjectSeconds: 54479,
            unpinnedClears: 20,
            checkpointRuns: 8,
        });
    });

    it('accounts for every Run exactly once', () => {
        const outcomes = getNonClearRuns();

        expect(accountedFor(outcomes)).toBe(outcomes.runs);
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
            unpinnedClears: 0,
            checkpointRuns: 0,
        });
    });

    it('keeps a long Reset out of the restart count', () => {
        // April 2022: three Resets, one of them 4,045 seconds — a fireteam that gave up
        // over an hour in, which is the collapse the restart count must not absorb. The
        // same month holds 12 of the 20 finished Runs the pinned rule rejects: phase 0,
        // Bungie's own flag unset, after the pin.
        const april = resolveArchiveRangeFromParams({ from: '2022-04-01', to: '2022-04-30' });

        expect(getNonClearRuns(april)).toEqual({
            runs: 55,
            pinnedFullClears: 40,
            resets: 3,
            resetSeconds: 4324,
            quickResets: 2,
            clearedWithoutSubject: 0,
            clearedWithoutSubjectSeconds: 0,
            unpinnedClears: 12,
            checkpointRuns: 0,
        });
        expect(accountedFor(getNonClearRuns(april))).toBe(55);
    });

    it('finds the Checkpoint Runs and a clear without him in their own month', () => {
        // October 2020: 9 Runs. Five Checkpoint Runs — three unfinished, two he finished,
        // and neither kind is a clear or a Reset — and one 3,340-second Run the fireteam
        // cleared from the start after he had gone.
        const october2020 = resolveArchiveRangeFromParams({ from: '2020-10-01', to: '2020-10-31' });

        expect(getNonClearRuns(october2020)).toEqual({
            runs: 9,
            pinnedFullClears: 3,
            resets: 0,
            resetSeconds: 0,
            quickResets: 0,
            clearedWithoutSubject: 1,
            clearedWithoutSubjectSeconds: 3340,
            unpinnedClears: 0,
            checkpointRuns: 5,
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
            unpinnedClears: 0,
            checkpointRuns: 0,
        });
    });
});
