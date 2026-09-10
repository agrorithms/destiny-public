import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { closeArchiveDb } from '@/lib/db/archive';
import {
    getFastestClears,
    resolveArchiveRange,
    type ResolvedArchiveRange,
} from '@/lib/db/archive/queries';
import { parseArchiveRangeRequest } from '@/lib/db/archive/range';

/**
 * The fastest-clears list (#91), against the fixture Archive.
 *
 * Every failure this file is built to catch is the same kind: a query that returns a
 * plausible number rather than an error. A participant list that counts player rows
 * instead of memberships renders a seven-person fireteam for a six-person Run (hazard
 * 1); a rank that forgets to scope to Pinned Full Clears puts a 97-second abandoned
 * Run at the top of a board of records; a tie broken by nothing renders in whatever
 * order SQLite felt like. None of those throw, so the assertions below are specific
 * instances, specific durations and specific names.
 *
 * The figures come from the widened fixture (#85): 406 Runs, 346 Pinned Full Clears,
 * 2020-07-04 to 2026-02-23. tests/db/archive-fixture-shape.test.ts is what fails first
 * if a re-extraction moves any of them.
 *
 * **The 453-second reconciliation in #91's acceptance criteria is not asserted here.**
 * 453s is the fastest clear in the *production* Archive; the fixture is a 406-Run
 * sample whose own fastest clear is 676s. Asserting 453 against this database would be
 * asserting a number that is not in it. The rendering half of that criterion — that 453
 * reads as `7:33` — is pinned in src/app/gos10k/duration-copy.test.ts.
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

describe('ranking the fastest clears', () => {
    it('returns the fastest Pinned Full Clears, fastest first', () => {
        const clears = getFastestClears();

        expect(clears).toHaveLength(10);
        expect(clears.slice(0, 3).map((clear) => ({
            instanceId: clear.instanceId,
            durationSeconds: clear.durationSeconds,
            clearNumber: clear.clearNumber,
        }))).toEqual([
            { instanceId: '11250894049', durationSeconds: 676, clearNumber: 343 },
            { instanceId: '11241193127', durationSeconds: 684, clearNumber: 325 },
            { instanceId: '11241171375', durationSeconds: 687, clearNumber: 324 },
        ]);
    });

    it('counts only Pinned Full Clears, not every fast Run', () => {
        // The fixture holds a 97-second Run (10557146621) and three more under two
        // minutes. They are Runs he entered and nobody finished — a board of records
        // that ranked them would be topped by four resets. The slowest row here is
        // still nearly six times the fastest of those.
        const clears = getFastestClears(50);

        for (const clear of clears) {
            expect(clear.durationSeconds).toBeGreaterThanOrEqual(676);
            expect(clear.clearNumber).toBeGreaterThan(0);
        }
    });

    it('breaks a duration tie deterministically, earliest Run first', () => {
        // Two clears share 691 seconds and two more share 700. Without a tiebreaker the
        // order is whatever the query plan produces, which can differ between the
        // fixture and production for no reason a reader could ever see.
        const clears = getFastestClears();

        const tied = clears.filter((clear) => clear.durationSeconds === 691);
        expect(tied.map((clear) => clear.instanceId)).toEqual(['11072506964', '11250869025']);
        // The earlier Run is the earlier row: 2022-07-01 before 2022-08-04.
        expect(tied[0].period).toBeLessThan(tied[1].period);
    });

    it('takes the size of the list from its caller', () => {
        expect(getFastestClears(3).map((clear) => clear.durationSeconds)).toEqual([676, 684, 687]);
    });
});

describe('naming everyone who was in the Run', () => {
    it('names each membership once, however many characters they brought', () => {
        // HAZARD 1. Instance 9780072115 has seven player rows and six people: he
        // brought two characters to it. A participant list built straight off the rows
        // renders a seven-person fireteam that never existed.
        //
        // Scoped to the day it happened, where it is the fifth-fastest of seven clears.
        const clears = getFastestClears(10, resolve({ from: '2021-12-18', to: '2021-12-18' }));
        const run = clears.find((clear) => clear.instanceId === '9780072115');

        expect(run).toBeDefined();
        expect(run!.participants).toHaveLength(6);
        expect(new Set(run!.participants.map((player) => player.membershipId)).size).toBe(6);
        expect(run!.participants.map((player) => player.displayName)).toEqual([
            'Sneaky#8874', 'r5vx#9921', 'x cs53#1175', 'Nesspo#9781', 'Wolf#6888', 'zr 吴#3987',
        ]);
    });

    it('names everyone who entered, including anyone who left', () => {
        // Seven distinct people were in this Run and it was never a fireteam of seven:
        // Rohan#4619 entered at four seconds and played 222 of the 896, and Xapus#3699
        // arrived at 285. "Every participant" in #91 means exactly this — the people who
        // entered, not the six who finished.
        const clears = getFastestClears(10, resolve({ from: '2022-08-03', to: '2022-08-03' }));
        const run = clears.find((clear) => clear.instanceId === '11245834298');

        expect(run!.durationSeconds).toBe(896);
        expect(run!.participants.map((player) => player.displayName)).toEqual([
            '孑孓#4862', 'Nesspo#9781', 'Maddix#3234', 'Zeus1#5390',
            'ezzie#4307', 'Rohan#4619', 'Xapus#3699',
        ]);
    });

    it('falls back rather than rendering a name against a null code', () => {
        // HAZARD 2. 174 player rows across the Archive carry a null
        // bungie_global_display_name_code; instance 7085305400 is the fixture's. The
        // shared display-name formatter's ladder is what produces `bkuder12` here, and
        // the failure it prevents is a row reading `#null`.
        const clears = getFastestClears(10, resolve({ from: '2020-10-30', to: '2020-10-30' }));

        expect(clears).toHaveLength(1);
        expect(clears[0].instanceId).toBe('7085305400');
        expect(clears[0].participants.map((player) => player.displayName)).toEqual([
            'Ya nans Dero#7023', 'bkuder12', 'Chaos#6244',
            'Nesspo#9781', 'CHINESEDURAG#5820', 'Aki#3970',
        ]);
    });
});

describe('obeying the global range', () => {
    it('ranks within the active range rather than across the whole Archive', () => {
        // February 2022 is the month the range tests use throughout: 44 Runs, 41 of them
        // clears 103 through 143. Its fastest clear is nowhere near the Archive's.
        const clears = getFastestClears(10, resolve({ clearFrom: '103', clearTo: '143' }));

        expect(clears).toHaveLength(10);
        expect(clears[0].instanceId).toBe('10042779628');
        expect(clears[0].durationSeconds).toBe(753);
        expect(clears[0].clearNumber).toBe(135);
        for (const clear of clears) {
            expect(clear.clearNumber).toBeGreaterThanOrEqual(103);
            expect(clear.clearNumber).toBeLessThanOrEqual(143);
        }
    });

    it('returns a short list rather than padding one when the range holds few clears', () => {
        // The panel has to render two rows without looking broken. A range holding one
        // clear is the honest answer to a one-day filter.
        expect(getFastestClears(10, resolve({ from: '2020-10-30', to: '2020-10-30' }))).toHaveLength(1);
    });
});
