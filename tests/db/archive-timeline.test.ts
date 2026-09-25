import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive } from '../helpers/archive-seed';
import { resolveArchiveRangeFromParams } from '../helpers/archive-range';
import { closeArchiveDb } from '@/lib/db/archive';
import { getArchiveSpan, getMonthlyClears, getRangeTimeline } from '@/lib/db/archive/queries';
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
 * the monthly read must not, because under a range it feeds the whole-Archive overview
 * strip (#113) — the context a zoomed chart would otherwise lose. A
 * `getMonthlyClears(range)` that scoped like its neighbours would return a
 * correct-looking strip with the history silently truncated, so the no-truncation
 * property is asserted directly against a filtered request.
 *
 * The zoomed chart's own read, getRangeTimeline(), is the last block: adaptive buckets,
 * partly covered buckets, and a line in absolute Clear Numbers.
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
        // on. Every panel since #87 would return that month alone; the overview strip
        // this feeds must still show all 68.
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

describe('the zoomed timeline under a range (#113)', () => {
    it('draws a short range in days, one slot per day whether or not it holds a clear', () => {
        // February 2022 — clears 103–143, the window every other Archive test filters on.
        // 1 to 21 February is 21 days, so the chart is 21 daily bars rather than the one
        // monthly bar a fixed bucket would draw.
        const range = resolveArchiveRangeFromParams({ clearFrom: '103', clearTo: '143' });
        const timeline = getRangeTimeline(range);

        expect(timeline.size).toBe('day');
        expect(timeline.buckets).toHaveLength(21);
        expect(formatArchiveDate(timeline.buckets[0].start)).toBe('2022-02-01');
        expect(formatArchiveDate(timeline.buckets[20].start)).toBe('2022-02-21');

        // 13 + 9 + 18 on the first three days, one on the 21st, nothing in between —
        // and the empty days are still there, holding their place on the axis.
        const clears = timeline.buckets.map((bucket) => bucket.clears);
        expect(clears.slice(0, 4)).toEqual([13, 9, 18, 0]);
        expect(clears[20]).toBe(1);
        expect(clears.reduce((total, n) => total + n, 0)).toBe(41);
    });

    it('climbs in absolute Clear Numbers, from the one before the range to its last', () => {
        // The ticket's "4,120 → 4,388", in the fixture: the line starts at clear 102 —
        // the Archive's count when the range opens — and ends on clear 143, rather than
        // restarting at zero. It is then visibly the same window as the Clear Number
        // mode of the range filter above it.
        const range = resolveArchiveRangeFromParams({ clearFrom: '103', clearTo: '143' });
        const timeline = getRangeTimeline(range);
        const line = timeline.buckets.map((bucket) => bucket.cumulativeClears);

        expect(timeline.clearsBefore).toBe(102);
        expect(line[0]).toBe(115);
        // An empty day carries the total forward, so the line is flat across it.
        expect(line[2]).toBe(142);
        expect(line[3]).toBe(142);
        expect(line[19]).toBe(142);
        expect(line[20]).toBe(143);
        expect(line[20]).toBe(range.clearTo);
    });

    it('draws a range of a few months in Monday-start weeks, counting only its own clears', () => {
        // 12 January (a Wednesday) to 3 May 2022 (a Tuesday): 112 days, so weeks. Both
        // end weeks reach outside the range. The first, from Monday 10 January, holds 26
        // clears but only 15 of them fall on or after the 12th; the last, from Monday
        // 2 May, holds 40 but only 3 fall on or before the 3rd. A bucket counting its
        // whole week would put 11 and 37 clears into a range that does not contain them.
        const range = resolveArchiveRangeFromParams({ from: '2022-01-12', to: '2022-05-03' });
        const timeline = getRangeTimeline(range);

        expect(timeline.size).toBe('week');
        expect(formatArchiveDate(timeline.buckets[0].start)).toBe('2022-01-10');
        expect(formatArchiveDate(timeline.buckets[timeline.buckets.length - 1].start)).toBe('2022-05-02');
        // Seventeen Mondays, 10 January to 2 May, including the empty March weeks.
        expect(timeline.buckets).toHaveLength(17);

        expect(timeline.buckets[0].clears).toBe(15);
        expect(timeline.buckets[timeline.buckets.length - 1].clears).toBe(3);
        expect(timeline.buckets.reduce((total, bucket) => total + bucket.clears, 0)).toBe(100);

        // And the line runs from the clear before the range to the range's last — clears
        // 87 to 186, which is what the range filter says this window is.
        expect(timeline.clearsBefore).toBe(86);
        expect(timeline.buckets[timeline.buckets.length - 1].cumulativeClears).toBe(186);
        expect(range.clearFrom).toBe(87);
        expect(range.clearTo).toBe(186);
    });

    it('draws a range over two years in months, counting only its own clears', () => {
        // 15 July 2020 to 2 August 2022: 749 days, so months. July 2020 holds three
        // clears and August 2022 forty, but only two and twenty-five fall inside.
        const range = resolveArchiveRangeFromParams({ from: '2020-07-15', to: '2022-08-02' });
        const timeline = getRangeTimeline(range);

        expect(timeline.size).toBe('month');
        // July 2020 to August 2022 inclusive, the empty months kept.
        expect(timeline.buckets).toHaveLength(26);
        expect(timeline.buckets[0].clears).toBe(2);
        expect(timeline.buckets[timeline.buckets.length - 1].clears).toBe(25);
        expect(timeline.buckets.reduce((total, bucket) => total + bucket.clears, 0)).toBe(327);
        expect(timeline.clearsBefore).toBe(1);
        expect(timeline.buckets[timeline.buckets.length - 1].cumulativeClears).toBe(328);
    });

    it('draws a range holding Runs but no clears as empty buckets and a flat line', () => {
        // 2 to 5 April 2022: nine Runs, not one of them a Pinned Full Clear. The range
        // is held as asked (resolveArchiveRange keeps a window with Runs in it), so the
        // chart has four empty days — and the line sits flat at the clear the Archive
        // had reached, 143, rather than dropping to zero. The page says so in words.
        const range = resolveArchiveRangeFromParams({ from: '2022-04-02', to: '2022-04-05' });
        expect(range.mode).toBe('dates');
        expect(range.clearFrom).toBeNull();

        const timeline = getRangeTimeline(range);
        expect(timeline.buckets).toHaveLength(4);
        expect(timeline.buckets.every((bucket) => bucket.clears === 0)).toBe(true);
        expect(timeline.clearsBefore).toBe(143);
        expect(timeline.buckets.every((bucket) => bucket.cumulativeClears === 143)).toBe(true);
    });

    it('stops the axis at the Archive\'s own ends when a date range overruns them', () => {
        // A date range that merely overruns the Archive is held as asked, but the zoomed
        // chart is drawn over the part of it that has data: 1 January 2026 to the last
        // Run on 23 February is 54 days, so days — not the five years of empty months
        // the request's own length would choose.
        const range = resolveArchiveRangeFromParams({ from: '2026-01-01', to: '2030-12-31' });
        const timeline = getRangeTimeline(range);

        expect(timeline.size).toBe('day');
        expect(formatArchiveDate(timeline.buckets[0].start)).toBe('2026-01-01');
        expect(formatArchiveDate(timeline.buckets[timeline.buckets.length - 1].start)).toBe('2026-02-23');
        expect(timeline.buckets[timeline.buckets.length - 1].cumulativeClears).toBe(346);
    });
});
