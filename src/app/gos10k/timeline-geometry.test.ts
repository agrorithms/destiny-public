import { describe, expect, it } from 'vitest';
import { monthsBetween } from '@/lib/db/archive/month-keys';
import { bucketSlots, chooseBucketSize } from '@/lib/db/archive/timeline-buckets';
import {
    MAX_ZOOMED_TICKS,
    LAST_ZOOMED_TICK_PERCENT,
    YEAR_LABELS_FROM_MONTHS,
    minimumBandPercent,
    slotAt,
    slotCentre,
    timelineBand,
    tooltipLeft,
    yearTicks,
    zoomedTicks,
} from './timeline-geometry';

/**
 * The timeline's x-arithmetic (#88, #113) — where the shaded band and the year ticks sit
 * on the whole-Archive axis, and where the labels sit on the zoomed one, as percentages.
 *
 * Pure and colocated because it is the half of the shading that can be *wrong* rather
 * than merely invisible. Since #113 the band is drawn once, on the whole-Archive overview
 * strip under the zoomed chart; a band off by a month looks plausible on a 68-month
 * axis, which is the failure this file exists to catch.
 *
 * The months below are the whole Archive's, never the range's, so every band and year
 * position is a fraction of the full history. The zoomed axis's labels are the last block.
 */

/**
 * 2020-07 … 2026-02, the fixture's own extent: 68 months.
 *
 * Built with the same helper the query uses, so the axis under test is the axis the page
 * gets. Spelling the walk out again here would be a third copy of the month arithmetic,
 * and a test whose expected axis could drift from the real one is a test that passes
 * while the chart is wrong.
 */
const MONTHS = monthsBetween('2020-07', '2026-02');

/** Midday UTC on a given day, in seconds — the shape `period` is stored in. */
const at = (iso: string): number => Date.parse(`${iso}T12:00:00Z`) / 1000;

describe('the shaded band', () => {
    it('is absent when no range is active', () => {
        // The unfiltered page shades nothing: there is no selection to show, and a band
        // covering the whole chart would read as one.
        expect(timelineBand(MONTHS, { periodFrom: null, periodTo: null })).toBeNull();
    });

    it('spans the months the range covers, as a fraction of the whole history', () => {
        // December 2021 to February 2022 — three months of sixty-eight, starting at
        // month index 17. Wide enough that the one-month floor below cannot be what is
        // being measured here.
        const band = timelineBand(MONTHS, {
            periodFrom: at('2021-12-01'),
            periodTo: at('2022-02-28'),
        });

        expect(band).not.toBeNull();
        // Each end is positioned *within* its month, not snapped to the boundary:
        // midday on the 1st of a 31-day December is half a day into it, 0.5/31.
        expect(band!.startPercent).toBeCloseTo(((17 + 0.5 / 31) / 68) * 100, 5);
        expect(band!.endPercent).toBeCloseTo(((19 + 27.5 / 28) / 68) * 100, 5);
    });

    it('widens a range narrower than a month to one month', () => {
        // One day of 68 months is 0.05% of the axis — a band a reader cannot see is
        // indistinguishable from a filter that did not apply, which is the phone
        // criterion's real risk. A whole month is the floor because the bars beneath
        // the band are months.
        const band = timelineBand(MONTHS, {
            periodFrom: at('2022-02-14'),
            periodTo: at('2022-02-14'),
        });

        expect(band!.endPercent - band!.startPercent).toBeCloseTo(minimumBandPercent(MONTHS), 5);
    });

    it('keeps a widened band inside the chart at the right-hand edge', () => {
        // The Archive's own last day is the likeliest single-day selection anyone makes
        // — it is where a "final week" preset ends — and widening rightwards from it
        // would push the band off the chart, where it shades nothing.
        const minimum = minimumBandPercent(MONTHS);
        const last = timelineBand(MONTHS, {
            periodFrom: at('2026-02-23'),
            periodTo: at('2026-02-23'),
        });

        expect(last!.endPercent).toBeCloseTo(100, 5);
        expect(last!.startPercent).toBeCloseTo(100 - minimum, 5);
    });

    it('clamps a range that overruns the Archive rather than drawing outside it', () => {
        // resolveArchiveRange() clamps most of these already, but a date range that
        // merely overruns the last Run is held as asked — so the band has to cope.
        const band = timelineBand(MONTHS, {
            periodFrom: at('2019-01-01'),
            periodTo: at('2030-01-01'),
        });

        expect(band).toEqual({ startPercent: 0, endPercent: 100 });
    });
});

describe('the year ticks', () => {
    it('labels each year at the position its January sits at', () => {
        const ticks = yearTicks(MONTHS);

        // 2020 is labelled at the axis origin even though the history starts in July:
        // the first year's tick is where the chart begins, not where its January would
        // have been off the left-hand edge.
        expect(ticks[0]).toEqual({ year: '2020', percent: 0 });
        // 2021-01 is month index 6 of 68.
        expect(ticks[1].year).toBe('2021');
        expect(ticks[1].percent).toBeCloseTo((6 / 68) * 100, 5);
        expect(ticks.map((tick) => tick.year)).toEqual([
            '2020', '2021', '2022', '2023', '2024', '2025', '2026',
        ]);
    });

    it('keeps every label on the chart when the month list has gaps', () => {
        // The list is contiguous in practice — getMonthlyClears() fills it — but this
        // module is exported and pure and cannot enforce that. Positioning by
        // `months.indexOf('2022-01')` returns -1 for a year whose January is absent,
        // which is a negative percentage: a label for a year in the middle of the axis,
        // drawn off the left-hand edge. Month-key arithmetic has no such dependency.
        const gapped = ['2021-11', '2021-12', '2022-06', '2022-07'];
        const ticks = yearTicks(gapped);

        expect(ticks.map((tick) => tick.year)).toEqual(['2021', '2022']);
        // 2021's January is ten months before the axis starts, so it clamps to the
        // origin exactly as the real first year does; 2022's is two slots along of four.
        expect(ticks[0].percent).toBe(0);
        expect(ticks[1].percent).toBeCloseTo((2 / 4) * 100, 5);
    });
});

/**
 * The zoomed chart's axis labels (#113). Its buckets change size with the range, so its
 * labels do too — years under months, months under weeks, days under days — and they
 * must still fit a 360px phone, which is what the cap and the right-hand margin are for.
 *
 * The slots come from the same pure module the query lays its buckets out with, so the
 * axis under test is the one the page draws.
 */
describe('the zoomed axis labels', () => {
    /**
     * The zoomed axis for a date range inside the Archive, as getRangeTimeline() lays it
     * out. Every range below lies within the Archive's span, so the query's clamp to the
     * Archive's ends would change nothing and is left out.
     */
    const axis = (from: string, to: string) => {
        const fromSeconds = Date.parse(`${from}T00:00:00Z`) / 1000;
        const toSeconds = Date.parse(`${to}T23:59:59.999Z`) / 1000;
        const size = chooseBucketSize(fromSeconds, toSeconds);
        return { size, slots: bucketSlots(size, fromSeconds, toSeconds) };
    };

    it('labels a short monthly axis with months, every few months from its first', () => {
        // July 2020 to August 2022: 26 months, so month buckets — and too few for years.
        // Labelled by year, this axis had only 2021 and 2022.
        const { size, slots } = axis('2020-07-15', '2022-08-02');
        expect(size).toBe('month');

        const ticks = zoomedTicks(size, slots);

        // Every 1st up to 85% of the axis is slots 0–22, twenty-three of them, so every
        // fourth. July 2020 labels the origin because it is a real boundary here: the
        // first bar *is* July 2020, and the next label is four bars along.
        expect(ticks.map((tick) => tick.label)).toEqual([
            'Jul 2020',
            'Nov 2020',
            'Mar 2021',
            'Jul 2021',
            'Nov 2021',
            'Mar 2022',
        ]);
        // March 2021 is slot 8 of 26.
        expect(ticks[2].percent).toBeCloseTo((8 / 26) * 100, 5);
    });

    it('never leaves a two-year monthly axis with a single label', () => {
        // February 2021 to February 2023: 25 months. Labelled by year, January 2022 sat
        // at 44% and January 2023 at 96%, past the right-hand cut-off, which left one
        // label on a two-year axis.
        const { size, slots } = axis('2021-02-01', '2023-02-28');
        expect(size).toBe('month');
        expect(slots).toHaveLength(25);

        expect(zoomedTicks(size, slots).map((tick) => tick.label)).toEqual([
            'Feb 2021',
            'Jun 2021',
            'Oct 2021',
            'Feb 2022',
            'Jun 2022',
            'Oct 2022',
        ]);
    });

    it('labels a long monthly axis with the years, at each January', () => {
        // July 2020 to June 2024: 48 months, the shortest axis labelled by year.
        const { size, slots } = axis('2020-07-15', '2024-06-30');
        expect(slots).toHaveLength(YEAR_LABELS_FROM_MONTHS);

        const ticks = zoomedTicks(size, slots);

        // 2020 has no January on this axis, so no label is pinned to the origin to stand
        // in for it — a label that close to 2021's would collide with it on a phone.
        // January 2024 is at 87.5%, past the cut-off.
        expect(ticks.map((tick) => tick.label)).toEqual(['2021', '2022', '2023']);
        // January 2021 is slot 6 of 48.
        expect(ticks[0].percent).toBeCloseTo((6 / 48) * 100, 5);
    });

    it('gives every monthly axis in the Archive at least two labels, and no more than fit', () => {
        // Every monthly axis the page can draw. A monthly axis's slots are whole calendar
        // months, and its labels depend on nothing else, so every start month crossed with
        // every end month is every monthly axis there is — whatever days the range names.
        // The shortest is 25 months: 24 months span at most 731 days, which is weeks.
        const lengths = new Set<number>();
        for (const [start, first] of MONTHS.entries()) {
            for (const last of MONTHS.slice(start)) {
                const [year, month] = last.split('-').map(Number);
                const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
                const { size, slots } = axis(`${first}-01`, lastDay);
                if (size !== 'month') continue;
                lengths.add(slots.length);

                const ticks = zoomedTicks(size, slots);
                expect(ticks.length, `${first} to ${last}`).toBeGreaterThanOrEqual(2);
                expect(ticks.length, `${first} to ${last}`).toBeLessThanOrEqual(MAX_ZOOMED_TICKS);
                for (const tick of ticks) {
                    expect(tick.percent).toBeLessThanOrEqual(LAST_ZOOMED_TICK_PERCENT);
                }
            }
        }

        // The sweep reached both labellings, from the shortest monthly axis to the Archive.
        expect(Math.min(...lengths)).toBe(25);
        expect(Math.max(...lengths)).toBe(MONTHS.length);
    });

    it('labels a weekly axis with the months, where each one begins', () => {
        // 12 January to 3 May 2022: seventeen weeks from Monday 10 January.
        const { size, slots } = axis('2022-01-12', '2022-05-03');
        expect(size).toBe('week');

        const ticks = zoomedTicks(size, slots);

        expect(ticks.map((tick) => tick.label)).toEqual(['Feb 2022', 'Mar 2022', 'Apr 2022']);
        // 1 February is a Tuesday: one day into week 3 (from Monday 31 January), not
        // snapped to the week's start.
        expect(ticks[0].percent).toBeCloseTo(((3 + 1 / 7) / 17) * 100, 5);
    });

    it('labels a daily axis with days', () => {
        // 1 to 21 February 2022 — the fixture's clears 103–143.
        const { size, slots } = axis('2022-02-01', '2022-02-21');
        expect(size).toBe('day');

        const ticks = zoomedTicks(size, slots);

        expect(ticks[0]).toEqual({ label: '1 Feb', percent: 0 });
        expect(ticks.every((tick) => /^\d{1,2} [A-Z][a-z]{2}$/.test(tick.label))).toBe(true);
    });

    it('labels a single-day axis with that day, at the origin', () => {
        const { size, slots } = axis('2022-02-14', '2022-02-14');

        expect(zoomedTicks(size, slots)).toEqual([{ label: '14 Feb', percent: 0 }]);
    });

    it('never draws more labels than fit on a phone, however long the axis', () => {
        // The longest axis of each size: 92 days, two leap-year-spanning years of weeks,
        // and the whole Archive in months. Each would label every boundary otherwise —
        // ninety-two day labels in 328 pixels.
        for (const [from, to] of [
            ['2022-07-01', '2022-09-30'],
            ['2023-01-01', '2024-12-31'],
            ['2020-07-04', '2026-02-23'],
        ]) {
            const { size, slots } = axis(from, to);
            const ticks = zoomedTicks(size, slots);
            expect(ticks.length).toBeGreaterThan(0);
            expect(ticks.length).toBeLessThanOrEqual(MAX_ZOOMED_TICKS);
        }
    });

    it('keeps every label clear of the right-hand edge', () => {
        // A label starts at its boundary and runs rightwards, so one starting at 97%
        // runs off the chart — the 13px overflow the phone spec caught on the year ticks.
        for (const [from, to] of [
            ['2022-07-01', '2022-09-30'],
            ['2022-01-12', '2022-05-03'],
            ['2022-02-01', '2022-02-07'],
        ]) {
            const { size, slots } = axis(from, to);
            for (const tick of zoomedTicks(size, slots)) {
                expect(tick.percent).toBeLessThanOrEqual(LAST_ZOOMED_TICK_PERCENT);
            }
        }
    });
});

describe('the bucket under the pointer (#114)', () => {
    // The main chart's slots are uniform — every bar is one slot, however long its month
    // — so the bucket under the pointer is its fraction of the way across, times the
    // number of slots. The line uses the same answer as the bar beneath it, so the two
    // tooltips always name the same bucket.

    it('picks the slot the pointer is inside', () => {
        // 21 daily slots, as in February 2022's first three weeks.
        expect(slotAt(0, 21)).toBe(0);
        expect(slotAt(0.1, 21)).toBe(2);
        expect(slotAt(0.999, 21)).toBe(20);
    });

    it('gives a boundary to the slot on its right', () => {
        // Halfway across four slots is the start of the third.
        expect(slotAt(0.5, 4)).toBe(2);
    });

    it('keeps a pointer on or past either edge on the end slot', () => {
        // The pointer's last pixel measures as 100% of the width, and a pointer event can
        // land a fraction outside the box: both still mean the end bucket, not no bucket
        // and not a slot that does not exist.
        expect(slotAt(1, 4)).toBe(3);
        expect(slotAt(1.02, 4)).toBe(3);
        expect(slotAt(-0.02, 4)).toBe(0);
    });

    it('finds nothing on a chart with no slots', () => {
        expect(slotAt(0.5, 0)).toBeNull();
    });

    it("anchors the tooltip over the middle of the slot, in the chart's pixels", () => {
        // The third of four slots on a 400px chart spans 200–300px; its middle is 250.
        expect(slotCentre(2, 4, 400)).toBe(250);
        // And it is the slot slotAt() finds there, which is the pairing that matters.
        expect(slotAt(250 / 400, 4)).toBe(2);
    });
});

describe("the tooltip's left edge (#114)", () => {
    // In pixels from the chart's left. Centred over the bucket where there is room, and
    // pushed back inside the chart where there is not: the chart is the page column, so
    // inside it is inside the viewport — at 360px, and at the chart's first and last bars.

    it('centres the tooltip over its bucket when there is room', () => {
        expect(tooltipLeft(164, 100, 328)).toBe(114);
    });

    it("stops at the chart's left edge", () => {
        expect(tooltipLeft(5, 100, 328)).toBe(0);
    });

    it("stops at the chart's right edge", () => {
        expect(tooltipLeft(325, 100, 328)).toBe(228);
    });

    it('starts at the left edge when the tooltip is wider than the chart', () => {
        // Overflow on the right beats overflow on the left, where the start of the text
        // — the bucket's name — would be the part cut off.
        expect(tooltipLeft(50, 400, 328)).toBe(0);
    });
});
