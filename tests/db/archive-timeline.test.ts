import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb } from '@/lib/db/archive';
import { getArchiveSpan, getMonthlyClears } from '@/lib/db/archive/queries';
import { formatArchiveDate } from '@/lib/db/archive/range';

/**
 * The timeline's monthly bucketing (#88), against the fixture Archive.
 *
 * Two things here return a plausible wrong answer rather than an error, and both are
 * the reason this file asserts specific months and specific counts.
 *
 * The first is the gap. `GROUP BY strftime('%Y-%m', …)` returns only the months that
 * contain a Run, so a chart drawn straight off it squashes a two-year pause into the
 * gap between two adjacent bars — an axis that is no longer proportional to time, and
 * which looks entirely correct. The fixture is an unusually good witness for this: it
 * spans 68 calendar months and only 20 of them hold a Pinned Full Clear.
 *
 * The second is the range. Every other panel since #87 filters on the active range;
 * this one must not (#81: "the timeline always draws the full history and shades the
 * selection"). A `getMonthlyClears(range)` that scoped like its neighbours would return
 * a correct-looking chart with the history silently truncated, so the no-truncation
 * property is asserted directly against a filtered request.
 *
 * Figures computed independently from tests/fixtures/archive-seed.json, not read back
 * off the query. The fixture is #85's: 406 Runs, 346 Pinned Full Clears, 2020-07-04 to
 * 2026-02-23; tests/db/archive-fixture-shape.test.ts fails first if a re-extraction
 * moves any of them.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

describe('bucketing Pinned Full Clears by month', () => {
    it('covers every calendar month of the Archive, not only the ones with clears', () => {
        const months = getMonthlyClears();

        // 2020-07 to 2026-02 inclusive is 68 months. Only 20 of them contain a Pinned
        // Full Clear, so a query that returned its GROUP BY unaltered would return 20
        // rows here and draw a chart whose x-axis is not time.
        expect(months).toHaveLength(68);
        expect(months[0].month).toBe('2020-07');
        expect(months[months.length - 1].month).toBe('2026-02');
        expect(months.filter((month) => month.clears === 0)).toHaveLength(48);
    });

    it('spans the whole Archive rather than only the months holding clears', () => {
        const months = getMonthlyClears();
        const span = getArchiveSpan();

        // The axis is anchored to the Archive's own extent — the same span the header
        // states — and not to a clock. A timeline that ended at "now" would grow an
        // empty tail every month against a dataset that stopped moving in 2026.
        // Through the same formatter the query itself reduces the span with, so the
        // expected axis is the shipped derivation rather than a second one that could
        // drift from it.
        const firstRun = formatArchiveDate(span.firstRunAt!).slice(0, 7);
        const lastRun = formatArchiveDate(span.lastRunAt!).slice(0, 7);
        expect(months[0].month).toBe(firstRun);
        expect(months[months.length - 1].month).toBe(lastRun);
    });

    it('renders an empty bucket for a month inside the dense era with no clears', () => {
        const months = getMonthlyClears();
        const byMonth = new Map(months.map((month) => [month.month, month]));

        // 2022-03 has no Runs at all in the master, which is why the extraction script
        // samples across it deliberately (scripts/extract-archive-fixture.ts). It sits
        // between two 40-clear months, so omitting it would visibly join April to
        // February — the exact distortion this criterion rules out.
        expect(byMonth.get('2022-02')?.clears).toBe(41);
        expect(byMonth.get('2022-03')?.clears).toBe(0);
        expect(byMonth.get('2022-04')?.clears).toBe(40);
    });

    it('counts clears rather than Runs', () => {
        const months = getMonthlyClears();

        // The fixture holds 406 Runs and 346 Pinned Full Clears, and 26 months contain
        // a Run against the 20 that contain a clear. A bar counting Runs would total
        // 406 here and light up six months that have no clear in them.
        expect(months.reduce((total, month) => total + month.clears, 0)).toBe(346);
    });

    it('accumulates to the Archive total by the last month', () => {
        const months = getMonthlyClears();

        // The cumulative line's whole point: it reaches the headline figure at the
        // right-hand edge. In production that is 10,000; in the fixture, 346.
        expect(months[months.length - 1].cumulativeClears).toBe(346);

        // And it is monotonic, which is what makes an empty month a plateau rather
        // than a dip.
        for (let i = 1; i < months.length; i += 1) {
            expect(months[i].cumulativeClears).toBeGreaterThanOrEqual(months[i - 1].cumulativeClears);
        }
    });

    it('runs the cumulative total through an empty month without moving it', () => {
        const months = getMonthlyClears();
        const byMonth = new Map(months.map((month) => [month.month, month]));

        // 21 + 40 + 41 + 41 = 143 by the end of February 2022, held flat across the
        // empty March, then 183 at the end of April.
        expect(byMonth.get('2022-02')?.cumulativeClears).toBe(143);
        expect(byMonth.get('2022-03')?.cumulativeClears).toBe(143);
        expect(byMonth.get('2022-04')?.cumulativeClears).toBe(183);
    });

    it('reads the cumulative total off the stored Clear Number, and still agrees with the bars', () => {
        const months = getMonthlyClears();

        // The line is `MAX(clear_number)` per month rather than a running sum of the
        // bars: ADR 0008 stores that ordinal precisely so the page's panels stop
        // re-deriving it, and every other panel — the range filter above this one
        // included — already speaks in it.
        //
        // The cost of reading it is that the two halves of this panel now come from two
        // places, and nothing but this assertion says they must match. They can only
        // disagree if this query's predicate drifts from the one clear_number was ranked
        // over, which is exactly the drift worth failing on: a summed line under the
        // disjunctive rule climbs to 10,020 while the filter still says 10,000, and the
        // page renders it perfectly.
        let summed = 0;
        for (const month of months) {
            summed += month.clears;
            expect(month.cumulativeClears).toBe(summed);
        }

        // And the right-hand edge is the Archive's own MAX(clear_number) — the figure
        // the header states, in the denomination the filter reads.
        expect(months[months.length - 1].cumulativeClears).toBe(getArchiveSpan().maxClearNumber);
    });

    it('draws the full history even when a range is active', () => {
        // February 2022 — clears 103–143, the window every other Archive test filters
        // on. Every panel since #87 would return that month alone.
        const range = resolveArchiveRangeFromParams({ clearFrom: '103', clearTo: '143' });
        expect(range.mode).toBe('clears');

        // The timeline takes no range at all, which is the structural half of the same
        // criterion: there is no *required* argument, and the one optional argument is an
        // ArchiveSpan — it fixes the axis's two ends and cannot narrow what is counted.
        expect(getMonthlyClears).toHaveLength(0);

        const months = getMonthlyClears();
        expect(months).toHaveLength(68);
        expect(months[months.length - 1].cumulativeClears).toBe(346);
    });
});
