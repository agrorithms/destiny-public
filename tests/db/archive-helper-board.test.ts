import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive, readArchiveSeed } from '../helpers/archive-seed';
import { resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb } from '@/lib/db/archive';
import {
    HELPER_BOARD_ROWS,
    SUBJECT_MEMBERSHIP_ID,
    getArchiveHelperCount,
    getArchiveOverview,
    getHelperBoard,
} from '@/lib/db/archive/queries';

/**
 * The Helper board (#90), against the fixture Archive.
 *
 * The board answers "who actually carried this history", and its two time columns are
 * the part that can be wrong without looking wrong. An overlap that forgets to
 * intersect with the subject's own interval returns each Helper's whole time in the
 * Run — larger, plausible, and indistinguishable from the other column. An overlap
 * summed per *character row* rather than per Helper double-counts the four Runs where
 * the subject brought two characters, and can return more overlap than the Helper spent
 * in the Run at all. A count taken over player rows inflates a three-character Helper's
 * clears (hazard 1). None of those throw, so the assertions below are specific Helpers,
 * specific counts and specific durations, computed independently from
 * tests/fixtures/archive-seed.json.
 *
 * The figures come from the widened fixture (#85): 406 Runs, 346 Pinned Full Clears,
 * 2020-07-04 to 2026-02-23. tests/db/archive-fixture-shape.test.ts is what fails first
 * if a re-extraction moves any of them.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

/**
 * Clear 102 (instance 10014833110), on its own.
 *
 * The single most useful Run in the fixture for this board: the subject joined it at
 * 4,984 seconds and played 1,504 of them, so every Helper still in the Run at the end
 * overlaps him by *exactly* his own 1,504 seconds while having been there for over an
 * hour and a half. One Helper — pharaloover#4706 — left at 3,897, before he arrived,
 * and overlaps him by nothing. And KaRNaGxFuRy#5001 is the fixture's multi-character
 * hazard row, present on two characters in this one Run.
 *
 * Isolating it by Clear Number rather than by date is deliberate: 2022-01-28 carries a
 * second clear, so the date form would select two Runs and the arithmetic would stop
 * being hand-checkable.
 */
function clear102() {
    return resolveArchiveRangeFromParams({ clearFrom: '102', clearTo: '102' });
}

describe('ranking Helpers by presence', () => {
    it('ranks by clears present and stops at the row limit', () => {
        const { helpers: board, population } = getHelperBoard();

        expect(board).toHaveLength(HELPER_BOARD_ROWS);
        // The population is counted before the LIMIT, so a page of rows still reports
        // the whole board — the "25 of 382" copy and the show-all link read it.
        expect(population).toBe(382);
        expect(board.slice(0, 4).map((helper) => ({
            displayName: helper.displayName,
            runs: helper.runs,
            clears: helper.clears,
        }))).toEqual([
            { displayName: 'Wolf#6888', runs: 107, clears: 98 },
            { displayName: 'Antarctica#6606', runs: 90, clears: 81 },
            { displayName: 'Eternal#1918', runs: 76, clears: 73 },
            { displayName: 'Maddix#3234', runs: 69, clears: 67 },
        ]);
    });

    it('reports Runs present and clears present as different numbers', () => {
        // The whole reason the board carries two count columns: presence is not success.
        // A board reading `runs` off the clears population would render these equal on
        // every row, which is a wrong number that looks like a tidy one.
        const [wolf] = getHelperBoard(1).helpers;

        expect(wolf.runs).toBe(107);
        expect(wolf.clears).toBe(98);
    });

    it('shows every Helper who was present for a clear when the limit is lifted', () => {
        const { helpers: everyone, population } = getHelperBoard(null);

        // 382 of the fixture's 552 Helpers were present for at least one Pinned Full
        // Clear. The other 170 appear only in Runs that were not clears, and the board's
        // population is the clears — see getHelperBoard.
        expect(everyone).toHaveLength(382);
        expect(population).toBe(382);
        expect(everyone.every((helper) => helper.clears >= 1)).toBe(true);
    });

    it('excludes the subject from his own board', () => {
        const everyone = getHelperBoard(null).helpers;

        expect(everyone.some((helper) => helper.membershipId === SUBJECT_MEMBERSHIP_ID)).toBe(false);
    });

    it('never renders a name with a missing code as Name#null', () => {
        // 7085305400 carries a player whose bungie_global_display_name_code is NULL.
        for (const helper of getHelperBoard(null).helpers) {
            expect(helper.displayName).not.toContain('#null');
            expect(helper.displayName).not.toContain('undefined');
            expect(helper.displayName.length).toBeGreaterThan(0);
        }
    });
});

describe('counting distinct instances rather than player rows', () => {
    it('counts a Helper once per Run however many characters they brought', () => {
        // Clear 102 is one Run. KaRNaGxFuRy#5001 is in it on two characters, so a count
        // over player rows gives them two clears out of a population of one.
        const board = getHelperBoard(null, clear102()).helpers;
        const karnag = board.find((helper) => helper.displayName === 'KaRNaGxFuRy#5001');

        expect(karnag).toMatchObject({ runs: 1, clears: 1 });
        expect(board.every((helper) => helper.clears === 1)).toBe(true);
    });

    it('keeps every Helper total below the fixture\'s own player-row count', () => {
        const board = getHelperBoard(null).helpers;
        const totalRuns = board.reduce((sum, helper) => sum + helper.runs, 0);
        const playerRows = readArchiveSeed().tables.gos_10k_pgcr_players.length;

        expect(totalRuns).toBeLessThan(playerRows);
        for (const helper of board) {
            expect(helper.runs).toBeLessThanOrEqual(getArchiveOverview().runs);
            expect(helper.clears).toBeLessThanOrEqual(helper.runs);
        }
    });
});

describe('the two time columns', () => {
    it('measures overlap against the subject\'s own interval in the same Run', () => {
        // He was in clear 102 from 4,984 to 6,488 — 1,504 seconds of a 6,488-second Run.
        // MESRINE#4991 was there from 2 to 6,488: an hour and 48 minutes in the Run, of
        // which 1,504 seconds were alongside him. An overlap query that forgets to
        // intersect returns 6,486 here and looks entirely reasonable.
        const board = getHelperBoard(null, clear102()).helpers;
        const mesrine = board.find((helper) => helper.displayName === 'MESRINE#4991');

        expect(mesrine).toMatchObject({ secondsInRun: 6486, secondsWithSubject: 1504 });
    });

    it('reports no overlap for a Helper who left before he arrived', () => {
        // pharaloover#4706 entered at 2 and played 3,895 seconds, leaving at 3,897 —
        // 1,087 seconds before the subject entered at 4,984. The two intervals do not
        // touch, and an overlap computed as `MIN(ends) - MAX(starts)` without the
        // zero floor returns -1,087, which sums into another Helper's total as a
        // *reduction*.
        const board = getHelperBoard(null, clear102()).helpers;
        const pharaloover = board.find((helper) => helper.displayName === 'pharaloover#4706');

        expect(pharaloover).toMatchObject({ secondsInRun: 3895, secondsWithSubject: 0 });
    });

    it('collapses a Helper\'s multiple characters into one interval', () => {
        // KaRNaGxFuRy#5001 played [0, 662] on one character and [697, 6488] on another.
        // The Run is 6,488 seconds and their interval spans all of it. Summing the two
        // rows' time played gives 6,453 — close enough to look right, and wrong.
        const board = getHelperBoard(null, clear102()).helpers;
        const karnag = board.find((helper) => helper.displayName === 'KaRNaGxFuRy#5001');

        expect(karnag).toMatchObject({ secondsInRun: 6488, secondsWithSubject: 1504 });
    });

    it('never reports more time alongside him than time in the Run', () => {
        // The subject himself brought two characters to four Runs, two of them clears,
        // and in one of those his two intervals overlap each other. An overlap summed
        // per (Helper row, subject row) pair counts that stretch twice and can exceed
        // the Helper's whole time in the Run — the failure is not hypothetical, it is
        // what the first draft of this query did to Wolf#6888.
        for (const helper of getHelperBoard(null).helpers) {
            expect(helper.secondsWithSubject).toBeLessThanOrEqual(helper.secondsInRun);
        }
    });

    it('agrees closely with total time in Run across the top of the board', () => {
        // #81's reason for offering the toggle at all: the two measures very nearly
        // agree, so switching demonstrates the agreement rather than revealing a
        // discrepancy. Pinned as specific totals, because "nearly agree" is exactly the
        // shape a wrong overlap query also has.
        const board = getHelperBoard(3).helpers;

        expect(board.map((helper) => ({
            displayName: helper.displayName,
            secondsWithSubject: helper.secondsWithSubject,
            secondsInRun: helper.secondsInRun,
        }))).toEqual([
            { displayName: 'Wolf#6888', secondsWithSubject: 104118, secondsInRun: 104147 },
            { displayName: 'Antarctica#6606', secondsWithSubject: 83461, secondsInRun: 88500 },
            { displayName: 'Eternal#1918', secondsWithSubject: 61552, secondsInRun: 61616 },
        ]);
    });
});

describe('obeying the active range', () => {
    it('counts only the Runs inside the range', () => {
        // February 2022 alone: 44 Runs, 41 of them Pinned Full Clears (pinned by
        // tests/db/archive-range.test.ts). Antarctica#6606 tops the unfiltered board's
        // second row and this one's first.
        const february = resolveArchiveRangeFromParams({ from: '2022-02-01', to: '2022-02-28' });
        const [top] = getHelperBoard(1, february).helpers;

        expect(top).toMatchObject({
            membershipId: '4611686018447922995',
            displayName: 'Antarctica#6606',
            runs: 24,
            clears: 22,
        });
        expect(top.secondsWithSubject).toBeLessThanOrEqual(top.secondsInRun);
    });

    it('shrinks the board population with the range', () => {
        const february = resolveArchiveRangeFromParams({ from: '2022-02-01', to: '2022-02-28' });

        const board = getHelperBoard(null, february);

        expect(board.population).toBeLessThan(getHelperBoard().population);
        expect(board.helpers).toHaveLength(board.population);
    });

    it('returns an empty board for a range holding Runs but no clears', () => {
        // November 2020 holds one Run and no Pinned Full Clear. The range resolves
        // rather than degrading — "Runs but no clears" is a true answer, pinned in
        // tests/db/archive-range.test.ts — so this board has to render nothing rather
        // than quietly fall back to the whole Archive's rows. The people in that Run are
        // Helpers by getArchiveHelperCount's reckoning and are deliberately not rows
        // here: the board's population is the clears.
        const november2020 = resolveArchiveRangeFromParams({ from: '2020-11-01', to: '2020-11-30' });

        expect(getHelperBoard(null, november2020)).toEqual({ helpers: [], population: 0 });
        expect(getArchiveHelperCount(november2020)).toBeGreaterThan(0);
    });
});
