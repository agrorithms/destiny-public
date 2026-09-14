import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb } from '@/lib/db/archive';
import { PRESENCE_LATE_JOIN_SECONDS, getSubjectPresence } from '@/lib/db/archive/queries';

/**
 * The presence strip (#89), against the fixture Archive.
 *
 * The strip answers "how many of the 10,000 did he join at the very end", and every way
 * it can be wrong returns a plausible number. Summing his `time_played_seconds` per row
 * double-counts the Runs where he brought two characters at once — clear 20 below, where
 * that sum is longer than the Run itself. Averaging per-clear ratios instead of dividing
 * the totals gives ~99% rather than ~91%, which is a different claim about the same data.
 * Dropping the Pinned Full Clear filter widens the denominator to every Run. None of
 * those throw, so the assertions are specific seconds and counts, computed independently
 * from tests/fixtures/archive-seed.json.
 *
 * The figures come from the widened fixture (#85): 406 Runs, 346 Pinned Full Clears.
 * tests/db/archive-fixture-shape.test.ts is what fails first if a re-extraction moves
 * any of them.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

function clear(clearNumber: number) {
    return resolveArchiveRangeFromParams({
        clearFrom: String(clearNumber),
        clearTo: String(clearNumber),
    });
}

describe('his presence across the whole Archive', () => {
    it('totals his time against the clears\' duration', () => {
        // 494,153 of 539,209 seconds — 91.6%, the fixture's reading of #81's "roughly
        // 91% of the average clear" (production: 91.55%).
        expect(getSubjectPresence()).toEqual({
            clears: 346,
            presentSeconds: 494153,
            durationSeconds: 539209,
            lateJoins: 1,
        });
    });

    it('states the late-join threshold as five minutes', () => {
        // The number the panel names in its copy, and the one #81's "5 clears under five
        // minutes" reference figure was counted against.
        expect(PRESENCE_LATE_JOIN_SECONDS).toBe(300);
    });
});

describe('what counts as his time in a Run', () => {
    it('counts a late join by his time in the Run, not by the Run\'s length', () => {
        // Clear 31 is the fixture's one late join: a 4,368-second Run he entered for the
        // last 278 seconds of.
        expect(getSubjectPresence(clear(31))).toEqual({
            clears: 1,
            presentSeconds: 278,
            durationSeconds: 4368,
            lateJoins: 1,
        });
    });

    it('collapses two overlapping characters into one interval', () => {
        // Clear 20: he is in it on two characters, [3, 3029] and [597, 2233], in a
        // 3,029-second Run. Summing time played gives 4,662 — more time than the Run
        // lasted. The envelope is 3,026.
        const presence = getSubjectPresence(clear(20));

        expect(presence).toMatchObject({ presentSeconds: 3026, durationSeconds: 3029 });
    });

    it('measures entry to exit when his two characters leave a gap', () => {
        // Clear 52: two characters whose intervals do not overlap, so the envelope (1,125)
        // is longer than their summed time played (1,059). Entry to exit is the same
        // definition the Helper board's Time Alongside collapses him to; a second
        // definition of "his interval" on one page is how two panels disagree.
        expect(getSubjectPresence(clear(52))).toMatchObject({ presentSeconds: 1125 });
    });

    it('never reports more presence than the clears lasted', () => {
        const presence = getSubjectPresence();

        expect(presence.presentSeconds).toBeLessThanOrEqual(presence.durationSeconds);
    });
});

describe('obeying the active range', () => {
    it('counts only the clears inside the range', () => {
        // February 2022: 44 Runs, 41 Pinned Full Clears (pinned by
        // tests/db/archive-range.test.ts). The three Runs that are not clears contribute
        // nothing to either total.
        const february = resolveArchiveRangeFromParams({ from: '2022-02-01', to: '2022-02-28' });

        expect(getSubjectPresence(february)).toEqual({
            clears: 41,
            presentSeconds: 45232,
            durationSeconds: 49136,
            lateJoins: 0,
        });
    });

    it('agrees with the Helper board about clear 102', () => {
        // tests/db/archive-helper-board.test.ts pins his interval in this Run at 1,504
        // seconds of 6,488, because every Helper still there at the end overlaps him by
        // exactly that. The two panels read one interval.
        expect(getSubjectPresence(clear(102))).toEqual({
            clears: 1,
            presentSeconds: 1504,
            durationSeconds: 6488,
            lateJoins: 0,
        });
    });

    it('reports zeroes, not nulls, for a range holding Runs but no clears', () => {
        // November 2020 holds one Run and no Pinned Full Clear. It resolves rather than
        // degrading, so the panel has to render an empty state over this — the query's
        // job is to say "nothing" in numbers a division can be guarded on.
        const november2020 = resolveArchiveRangeFromParams({ from: '2020-11-01', to: '2020-11-30' });

        expect(getSubjectPresence(november2020)).toEqual({
            clears: 0,
            presentSeconds: 0,
            durationSeconds: 0,
            lateJoins: 0,
        });
    });
});
