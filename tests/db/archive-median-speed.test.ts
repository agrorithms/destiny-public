import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { closeArchiveDb } from '@/lib/db/archive';
import {
    MEDIAN_SPEED_BOARD_ROWS,
    MEDIAN_SPEED_CLEAR_FLOOR,
    getMedianSpeedBoard,
    resolveArchiveRange,
    type ResolvedArchiveRange,
} from '@/lib/db/archive/queries';
import { parseArchiveRangeRequest } from '@/lib/db/archive/range';

/**
 * The median speed board (#92), against the fixture Archive.
 *
 * The board answers "who is consistently fast" rather than "who had one good night",
 * and every way it can be wrong returns a plausible number rather than an error: a mean
 * dressed up as a median (one AFK run of several hours moves it), a median taken over
 * player rows instead of distinct Runs (hazard 1 inflates a three-character Helper's
 * clear count past the floor), a floor written `>` instead of `>=` (drops exactly the
 * Helper sitting on it), an even-count median that silently returns the lower of the two
 * middle values. So the assertions below are specific Helpers, specific clear counts and
 * specific medians, computed independently from tests/fixtures/archive-seed.json.
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

/** Shorthand: a URL's worth of parameters, resolved the way the page resolves them. */
function resolve(searchParams: Record<string, string>): ResolvedArchiveRange {
    return resolveArchiveRange(parseArchiveRangeRequest(searchParams));
}

describe('ranking Helpers by median clear duration', () => {
    it('ranks the fastest median first and stops at the row limit', () => {
        const board = getMedianSpeedBoard();

        // The named row count, not a bare 15: the floor is also 15 and means a
        // completely different thing, so asserting the literal would let a change to
        // either one read as a change to the other.
        expect(board).toHaveLength(MEDIAN_SPEED_BOARD_ROWS);
        expect(board.slice(0, 4).map((helper) => ({
            displayName: helper.displayName,
            clears: helper.clears,
            medianSeconds: helper.medianSeconds,
        }))).toEqual([
            { displayName: '孑孓#4862', clears: 18, medianSeconds: 725.5 },
            { displayName: 'Xapus#3699', clears: 18, medianSeconds: 731 },
            { displayName: 'Johnathan#7089', clears: 29, medianSeconds: 754 },
            { displayName: 'Hashira#4590', clears: 25, medianSeconds: 758 },
        ]);
    });

    it('averages the two middle clears when the count is even', () => {
        // The even-count criterion, and it is the top row rather than a corner case:
        // 孑孓#4862 has 18 clears, so the median is the mean of the 9th and 10th. A
        // query taking `position = (clears + 1) / 2` alone returns 725 — one second
        // out, always the lower middle, and invisible on the page.
        const board = getMedianSpeedBoard();
        const evenCase = board.find((helper) => helper.displayName === '孑孓#4862');

        expect(evenCase).toBeDefined();
        expect(evenCase!.clears % 2).toBe(0);
        expect(evenCase!.medianSeconds).toBe(725.5);
    });

    it('takes the middle clear itself when the count is odd', () => {
        // 15 clears — the floor row — so the median is the 8th of 15 and is a whole
        // number of seconds, not an average of two.
        const board = getMedianSpeedBoard();
        const oddCase = board.find((helper) => helper.displayName === 'Azźyyy#2886');

        expect(oddCase!.clears).toBe(15);
        expect(oddCase!.medianSeconds).toBe(763);
    });

    it('is a median rather than a mean', () => {
        // Maddix#3234 has 67 clears in the fixture and the fixture's slowest Pinned
        // Full Clear is 18,820 seconds. A mean is what a single AFK run wrecks; the
        // median is the statistic that survives it, and the two disagree here by
        // minutes.
        const board = getMedianSpeedBoard(100);
        const maddix = board.find((helper) => helper.displayName === 'Maddix#3234');

        expect(maddix).toEqual(expect.objectContaining({ clears: 67, medianSeconds: 770 }));
    });

    it('breaks a median tie deterministically, more clears first', () => {
        // Ranks 14 and 15 both sit at 884 seconds. Untied, which of them the query
        // returns — and, on a 15-row board, which of them a reader sees at all — is
        // whatever the query plan produced that day. More clears wins, because the
        // board is about consistency and 61 clears is more evidence than 15.
        const board = getMedianSpeedBoard();

        const tied = board.filter((helper) => helper.medianSeconds === 884);
        expect(tied.map((helper) => [helper.displayName, helper.clears])).toEqual([
            ['clara#1830', 61],
            ['exqte#1821', 15],
        ]);
    });
});

describe('the clear floor', () => {
    it('admits a Helper sitting exactly on the floor', () => {
        // The boundary row. A floor written `> 15` rather than `>= 15` drops exactly
        // this Helper out of rank 6 and nothing else — the board still renders fifteen
        // plausible rows.
        const board = getMedianSpeedBoard(100);

        expect(MEDIAN_SPEED_CLEAR_FLOOR).toBe(15);
        const boundary = board.find((helper) => helper.displayName === 'Azźyyy#2886');
        expect(boundary!.clears).toBe(MEDIAN_SPEED_CLEAR_FLOOR);
    });

    it('excludes every Helper below the floor', () => {
        // 28 of the fixture's Helpers reach 15 clears; the whole board is those 28 and
        // no more, whatever limit it is asked for.
        const board = getMedianSpeedBoard(100);

        expect(board).toHaveLength(28);
        for (const helper of board) {
            expect(helper.clears).toBeGreaterThanOrEqual(MEDIAN_SPEED_CLEAR_FLOOR);
        }
    });

    it('counts clears as distinct Runs, not as player rows', () => {
        // HAZARD 1. 217 (instance, membership) pairs in the Archive have several
        // character rows; counting rows would push a Helper over the floor on
        // characters rather than on clears, and would drag duplicate durations into
        // the median with them. Nesspo's own runs are the subject's, so he is never a
        // Helper on his own board either.
        const board = getMedianSpeedBoard(100);

        expect(board.map((helper) => helper.displayName)).not.toContain('Nesspo#9781');
        expect(new Set(board.map((helper) => helper.membershipId)).size).toBe(board.length);
    });
});

describe('obeying the global range', () => {
    it('measures the median within the active range rather than across the Archive', () => {
        // February 2022 — clears 103 through 143, the month every other Archive test
        // uses. Exactly one Helper reaches 15 clears inside it, and his median there
        // (1,039s) is nothing like his median across the whole fixture.
        const board = getMedianSpeedBoard(
            MEDIAN_SPEED_BOARD_ROWS,
            resolve({ clearFrom: '103', clearTo: '143' })
        );

        expect(board).toEqual([
            expect.objectContaining({
                displayName: 'Antarctica#6606',
                clears: 22,
                medianSeconds: 1039,
            }),
        ]);
    });

    it('returns an empty board when no Helper reaches the floor in the range', () => {
        // A single day holds one clear in this fixture, so nobody can reach fifteen.
        // The panel has to say so rather than render an empty table — this is the
        // query half of that criterion, MedianSpeedBoard.tsx is the other.
        expect(
            getMedianSpeedBoard(
                MEDIAN_SPEED_BOARD_ROWS,
                resolve({ from: '2020-10-30', to: '2020-10-30' })
            )
        ).toEqual([]);
    });
});
