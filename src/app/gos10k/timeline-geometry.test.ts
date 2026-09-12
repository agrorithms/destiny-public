import { describe, expect, it } from 'vitest';
import { monthsBetween } from '@/lib/db/archive/month-keys';
import { minimumBandPercent, timelineBand, yearTicks } from './timeline-geometry';

/**
 * The timeline's x-arithmetic (#88) — where the shaded band sits, and where the year
 * ticks under it sit, as percentages of one shared axis.
 *
 * Pure and colocated because it is the half of the shading that can be *wrong* rather
 * than merely invisible: the band is drawn twice, once over the cumulative line and once
 * over the monthly bars, and it only "reads across both charts" (the ticket's wording)
 * if both are computed from this one function. A band off by a month looks plausible on
 * a 68-month axis, which is the failure this file exists to catch.
 *
 * The months are the whole Archive's, never the range's, so every position below is a
 * fraction of the full history.
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
