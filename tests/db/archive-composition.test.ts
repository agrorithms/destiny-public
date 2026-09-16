import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { rangeOfClear, resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb } from '@/lib/db/archive';
import {
    getArchiveOverview,
    getClassDistribution,
    getParticipantDistribution,
    PARTICIPANT_BUCKET_CAP,
} from '@/lib/db/archive/queries';

/**
 * The participants panel and the class split (#94), against the fixture Archive.
 *
 * Both are composition panels, and both go wrong quietly. Counting player *rows* per Run
 * instead of distinct memberships moves a trio clear into the four bucket the moment one
 * of the three brought a second character — clear 13 below is exactly that Run. Dropping
 * the Pinned Full Clear filter widens the distribution to every Run. Leaving the empty
 * buckets out of the result makes "no solo clears" indistinguishable from "the panel
 * forgot solo". So the assertions are specific bucket counts, computed independently from
 * tests/fixtures/archive-seed.json.
 *
 * Fixture figures (#85): 406 Runs, 346 Pinned Full Clears, 2,482 player rows. The
 * participant buckets are also pinned by tests/db/archive-fixture-shape.test.ts, which is
 * what fails first if a re-extraction moves them.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

function february() {
    return resolveArchiveRangeFromParams({ from: '2022-02-01', to: '2022-02-28' });
}

/** One Run, and it is not a Pinned Full Clear — the range both panels are tested against. */
function november() {
    return resolveArchiveRangeFromParams({ from: '2020-11-01', to: '2020-11-30' });
}

/** `[1, 2, 3, 4, 5, 6, 7]` → clears, for readable expectations. */
function clearsByPeople(range?: ReturnType<typeof february>) {
    return getParticipantDistribution(range).map((bucket) => bucket.clears);
}

describe('people who entered each Pinned Full Clear', () => {
    it('always returns every bucket from solo to seven-or-more, in order', () => {
        // Solo is empty in the fixture and in production. It is still a row: the panel
        // covers solo through seven-plus, and an omitted bucket reads as a forgotten one.
        expect(getParticipantDistribution().map(({ people, orMore }) => ({ people, orMore }))).toEqual([
            { people: 1, orMore: false },
            { people: 2, orMore: false },
            { people: 3, orMore: false },
            { people: 4, orMore: false },
            { people: 5, orMore: false },
            { people: 6, orMore: false },
            { people: 7, orMore: true },
        ]);
        expect(PARTICIPANT_BUCKET_CAP).toBe(7);
    });

    it('buckets the whole fixture', () => {
        // Production, unfiltered: 0 / 4 / 42 / 4 / 40 / 9,480 / 430, summing to 10,000 —
        // #81's reference figures, reconciled by hand against data/gos-10k.db.
        expect(clearsByPeople()).toEqual([0, 4, 7, 3, 3, 307, 22]);
    });

    it('accounts for every Pinned Full Clear exactly once', () => {
        const total = getParticipantDistribution().reduce((sum, bucket) => sum + bucket.clears, 0);
        expect(total).toBe(getArchiveOverview().pinnedFullClears);
    });

    it('counts a person who brought two characters once (hazard 1)', () => {
        // Clear 13 has 4 player rows and 3 people: one of them brought a Warlock and a
        // Hunter. Counting rows would move the fixture's trio into the four bucket.
        expect(clearsByPeople(rangeOfClear(13))).toEqual([0, 0, 1, 0, 0, 0, 0]);
        // Clear 52: 7 rows, 6 people — a six that row-counting reads as seven-plus.
        expect(clearsByPeople(rangeOfClear(52))).toEqual([0, 0, 0, 0, 0, 1, 0]);
    });

    it('keeps the duo clears', () => {
        // Clear 10 is one of the fixture's four duos. #81 treats them as genuine; nothing
        // may filter them out.
        expect(clearsByPeople(rangeOfClear(10))).toEqual([0, 1, 0, 0, 0, 0, 0]);
    });

    it('scopes to the range', () => {
        // February 2022 is clears 103–143: 40 sixes and one seven-plus, and nothing
        // below six. These are people who entered, never fireteam size.
        expect(clearsByPeople(february())).toEqual([0, 0, 0, 0, 0, 40, 1]);
    });

    it('returns every bucket empty for a range with Runs but no clears', () => {
        // November 2020: one Run, no Pinned Full Clear — its six player rows must not leak in.
        expect(november().degraded).toBe(false);
        expect(clearsByPeople(november())).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
});

describe('the class split', () => {
    it('counts every character brought into a Run, unknown included', () => {
        // 2,482 player rows. Production: 34,821 Warlock, 30,151 Hunter, 14,029 Titan,
        // 167 unknown — 79,168, which is the player-row count, not the 78,948 distinct
        // (Run, person) pairs. #81's figures count characters.
        expect(getClassDistribution()).toEqual([
            { characterClass: 'Warlock', characters: 1359 },
            { characterClass: 'Hunter', characters: 552 },
            { characterClass: 'Titan', characters: 533 },
            { characterClass: 'Unknown', characters: 38 },
        ]);
    });

    it('counts both characters of a person who brought two', () => {
        // Clear 102: 8 rows from 7 people, one of whom brought a Warlock and a Titan. A
        // person's two characters have two classes; neither is dropped.
        expect(getClassDistribution(rangeOfClear(102))).toEqual([
            { characterClass: 'Hunter', characters: 3 },
            { characterClass: 'Titan', characters: 3 },
            { characterClass: 'Warlock', characters: 2 },
        ]);
    });

    it('covers every Run in range, not only the clears', () => {
        // November 2020's one Run is not a clear, and its six characters still count.
        expect(getClassDistribution(november())).toEqual([
            { characterClass: 'Hunter', characters: 3 },
            { characterClass: 'Titan', characters: 2 },
            { characterClass: 'Warlock', characters: 1 },
        ]);
    });
});
