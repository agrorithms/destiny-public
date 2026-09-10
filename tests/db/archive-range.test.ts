import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { closeArchiveDb, getArchiveDb } from '@/lib/db/archive';
import {
    getArchiveOverview,
    getArchiveSpan,
    getClassDistribution,
    getRunsByYear,
    getTopHelpers,
    resolveArchiveRange,
    PINNED_FULL_CLEAR,
    type ResolvedArchiveRange,
} from '@/lib/db/archive/queries';
import { parseArchiveRangeRequest } from '@/lib/db/archive/range';

/**
 * The global range filter, against the fixture Archive — the half of #87 that is
 * arithmetic over the data rather than over the URL.
 *
 * Two things are being tested and they fail differently. The **translation** — the
 * dates a Clear Number range spans, the Clear Numbers a date range contains — is the
 * most informative thing the control renders, and a wrong one is a plausible-looking
 * sentence nobody can check. The **degradation** rules never throw by construction, so
 * the only way to know a hand-edited link renders the whole Archive rather than an
 * empty page is to assert the resolved range.
 *
 * Figures are specific dates and specific Clear Numbers, per #87's acceptance
 * criteria, and they come from the widened fixture (#85): 406 Runs, 346 Pinned Full
 * Clears, 26 months, 2020-07-04 to 2026-02-23. February 2022 is the month used
 * throughout — 44 Runs, 41 of them clears 103 through 143 — because it sits inside the
 * dense sampled era with a real month either side. tests/db/archive-fixture-shape.test.ts
 * is what fails first if a re-extraction moves any of it.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

/** The Clear Numbers a resolved range actually selects, read back through its bounds. */
function clearNumbersIn(range: ResolvedArchiveRange): number[] {
    const rows = getArchiveDb().prepare(`
        SELECT r.clear_number AS n
        FROM gos_10k_runs r
        WHERE ${PINNED_FULL_CLEAR}
          AND (? IS NULL OR r.period >= ?)
          AND (? IS NULL OR r.period <= ?)
        ORDER BY n
    `).all(range.periodFrom, range.periodFrom, range.periodTo, range.periodTo) as Array<{ n: number }>;

    return rows.map((row) => row.n);
}

/** Shorthand: a URL's worth of parameters, resolved the way the page resolves them. */
function resolve(searchParams: Record<string, string>): ResolvedArchiveRange {
    return resolveArchiveRange(parseArchiveRangeRequest(searchParams));
}

describe('the Archive span', () => {
    it('is read from the data, first Run to last', () => {
        // Everything anchored — the presets, the clamping, the unfiltered control copy —
        // hangs off this rather than off the clock.
        const span = getArchiveSpan();

        expect(span.maxClearNumber).toBe(346);
        expect(new Date(span.firstRunAt! * 1000).toISOString()).toBe('2020-07-04T17:08:26.000Z');
        expect(new Date(span.lastRunAt! * 1000).toISOString()).toBe('2026-02-23T09:24:57.000Z');
    });
});

describe('translating a Clear Number range into dates', () => {
    it('reports the dates the clears actually span', () => {
        // Clears 103–143 are February 2022 in the fixture. The bounds are the two Runs'
        // own periods, not the first and last instant of a day: a Clear Number range is
        // exactly the window between two Runs.
        const range = resolve({ clearFrom: '103', clearTo: '143' });

        expect(range.mode).toBe('clears');
        expect(range.clearFrom).toBe(103);
        expect(range.clearTo).toBe(143);
        expect(range.periodFrom).toBe(1643684303);
        expect(range.periodTo).toBe(1645438571);
        expect(range.dateFrom).toBe('2022-02-01');
        expect(range.dateTo).toBe('2022-02-21');
        expect(range.degraded).toBe(false);
    });

    it('clamps a range that runs off the end of the Archive', () => {
        // "Clears 340 onwards" against a 346-clear Archive is a live question with a real
        // answer; degrading it to the whole Archive would throw the reader's intent away.
        // What is not a live question is clears 9,001–10,000 — see the degradation block.
        const range = resolve({ clearFrom: '340', clearTo: '9999' });

        expect(range.clearFrom).toBe(340);
        expect(range.clearTo).toBe(346);
        expect(range.dateFrom).toBe('2022-08-04');
        expect(range.dateTo).toBe('2026-02-23');
    });
});

describe('translating a date range into Clear Numbers', () => {
    it('reports the Clear Numbers the dates contain', () => {
        const range = resolve({ from: '2022-02-01', to: '2022-02-28' });

        expect(range.mode).toBe('dates');
        expect(range.clearFrom).toBe(103);
        expect(range.clearTo).toBe(143);
        // The whole of both end days, so a reader who types one date in both boxes gets
        // that day rather than its first instant.
        expect(range.periodFrom).toBe(Date.parse('2022-02-01T00:00:00Z') / 1000);
        expect(range.periodTo).toBe(Math.floor(Date.parse('2022-02-28T23:59:59.999Z') / 1000));
        expect(range.dateFrom).toBe('2022-02-01');
        expect(range.dateTo).toBe('2022-02-28');
        expect(range.degraded).toBe(false);
    });

    it('holds a range with Runs but no clears rather than degrading it', () => {
        // November 2020 has one Run in the fixture and no Pinned Full Clear. The panels
        // below correctly report zero clears over one Run; that is an answer, not a
        // broken page, and the control has to be able to say "no clears" in words.
        const range = resolve({ from: '2020-11-01', to: '2020-11-30' });

        expect(range.mode).toBe('dates');
        expect(range.clearFrom).toBeNull();
        expect(range.clearTo).toBeNull();
        expect(getArchiveOverview(range)).toMatchObject({ runs: 1, pinnedFullClears: 0 });
    });
});

describe('the two modes are the same range', () => {
    it('returns the same Pinned Full Clears for a Clear Number range and its dates', () => {
        // #87's equivalence criterion. Clear Number is defined by period ascending, so
        // the two expressions cannot disagree — unless the filter applies them
        // differently, which is exactly what this catches.
        const byClears = resolve({ clearFrom: '103', clearTo: '143' });
        const byDates = resolve({ from: byClears.dateFrom!, to: byClears.dateTo! });

        const expected = Array.from({ length: 41 }, (_, index) => index + 103);
        expect(clearNumbersIn(byClears)).toEqual(expected);
        expect(clearNumbersIn(byDates)).toEqual(expected);
        expect(getArchiveOverview(byDates).pinnedFullClears)
            .toBe(getArchiveOverview(byClears).pinnedFullClears);
    });
});

describe('degrading to the whole Archive', () => {
    it('describes the whole Archive in both expressions when nothing is asked for', () => {
        // Not a degraded state: the control renders these as the current range, so the
        // unfiltered page still states which clears and which dates it is showing.
        const range = resolve({});

        expect(range).toMatchObject({
            mode: 'all',
            periodFrom: null,
            periodTo: null,
            clearFrom: 1,
            clearTo: 346,
            dateFrom: '2020-07-04',
            dateTo: '2026-02-23',
            degraded: false,
        });
    });

    it.each([
        ['a malformed link', { from: 'yesterday', to: '2022-02-28' }],
        ['a link asking for both modes', { from: '2022-02-01', to: '2022-02-28', clearFrom: '1', clearTo: '5' }],
        ['clears the Archive does not contain', { clearFrom: '9001', clearTo: '10000' }],
        ['dates before the Archive begins', { from: '2019-01-01', to: '2019-12-31' }],
    ])('falls back to the unfiltered view for %s', (_case, params) => {
        const range = resolve(params);

        // Filtered to nothing is the failure mode worth naming: it renders as a broken
        // page rather than as an error, and every panel would agree with it.
        expect(range.mode).toBe('all');
        expect(range.periodFrom).toBeNull();
        expect(range.periodTo).toBeNull();
        // Separately flagged so the page can say the link was not understood, rather
        // than silently showing something else than the URL asked for.
        expect(range.degraded).toBe(true);
        expect(getArchiveOverview(range).runs).toBe(406);
    });
});

describe('every panel obeys the range', () => {
    const february = () => resolve({ from: '2022-02-01', to: '2022-02-28' });

    it('scopes the overview figures', () => {
        expect(getArchiveOverview(february())).toMatchObject({
            runs: 44,
            completions: 41,
            pinnedFullClears: 41,
            helpers: 58,
        });
        // Unfiltered by default, which is what the share card and the existing callers
        // still get.
        expect(getArchiveOverview()).toMatchObject({ runs: 406, pinnedFullClears: 346 });
    });

    it('scopes the Helper board, still counting distinct instances', () => {
        // Hazard 1: a Helper who brought two characters to one Run is one Run. The
        // range clause must not turn the join into a row count.
        const [top] = getTopHelpers(1, february());

        expect(top).toEqual({
            membershipId: '4611686018447922995',
            membershipType: expect.any(Number),
            displayName: 'Antarctica#6606',
            runs: 24,
            fullClears: 22,
        });
    });

    it('scopes the by-year table to the years the range covers', () => {
        expect(getRunsByYear(february())).toEqual([{ year: '2022', runs: 44, fullClears: 41 }]);
    });

    it('scopes the class split', () => {
        expect(getClassDistribution(february())).toEqual([
            { characterClass: 'Warlock', playerRuns: 157 },
            { characterClass: 'Titan', playerRuns: 61 },
            { characterClass: 'Hunter', playerRuns: 50 },
        ]);
    });
});
