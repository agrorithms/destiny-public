import { describe, expect, it } from 'vitest';
import { wholeArchiveTooltips, zoomedTooltips } from './timeline-tooltips';

/**
 * What the timeline's hover tooltips say (#114), one per bucket.
 *
 * Pure and colocated because the tooltip is where a bar's Clear Number span is first
 * worked out, and that span is arithmetic a reader can check against the range filter:
 * a bar reading `#4,120–#4,388` for 268 clears is off by one, looks entirely plausible,
 * and is the failure this file exists to catch. The browser spec proves the tooltip
 * appears; this file proves what it says.
 *
 * Expected strings are the issue's own worked examples, or small hand-built buckets
 * whose spans can be counted on fingers — never recomputed the way the module does.
 */

describe('the whole Archive, month by month', () => {
    it("reads the issue's own example: a bar's clears and span, the line's Clear Number", () => {
        // #114's copy: 268 clears in March 2021 take the Archive from 4,120 to 4,388.
        const tooltips = wholeArchiveTooltips([
            { month: '2021-02', clears: 150, cumulativeClears: 4120 },
            { month: '2021-03', clears: 268, cumulativeClears: 4388 },
        ]);

        expect(tooltips[1]).toEqual({
            line: 'Clear 4,388 · Mar 2021',
            bar: 'Mar 2021 · 268 clears · #4,121–#4,388',
        });
    });

    it("starts the first month's span at clear 1", () => {
        // Unfiltered there is no bucket before the first, and nothing before the Archive:
        // its first five clears are #1 to #5.
        const tooltips = wholeArchiveTooltips([{ month: '2020-07', clears: 5, cumulativeClears: 5 }]);

        expect(tooltips[0].bar).toBe('Jul 2020 · 5 clears · #1–#5');
    });

    it('says an empty month has no clears, with no span, while the line holds its place', () => {
        // 48 of the fixture's 68 months are empty (the Month Bucket rule keeps them), so
        // this is the tooltip a reader meets most often on the unfiltered chart.
        const tooltips = wholeArchiveTooltips([
            { month: '2022-02', clears: 41, cumulativeClears: 143 },
            { month: '2022-03', clears: 0, cumulativeClears: 143 },
        ]);

        expect(tooltips[1]).toEqual({
            line: 'Clear 143 · Mar 2022',
            bar: 'Mar 2022 · no clears',
        });
    });

    it('names a single clear rather than a span from a number to itself', () => {
        const tooltips = wholeArchiveTooltips([
            { month: '2022-08', clears: 40, cumulativeClears: 223 },
            { month: '2022-09', clears: 1, cumulativeClears: 224 },
        ]);

        // en-GB spells September with four letters; the label comes from the page's own
        // month formatter, so it says `Sept` here exactly as the axis beneath does.
        expect(tooltips[1].bar).toBe('Sept 2022 · 1 clear · #224');
    });

    it('says nothing has been cleared yet where the line is still at zero', () => {
        // "Clear 0" names a clear that does not exist.
        const tooltips = wholeArchiveTooltips([{ month: '2020-07', clears: 0, cumulativeClears: 0 }]);

        expect(tooltips[0].line).toBe('No clears yet · Jul 2020');
    });
});

/** Midnight UTC at the start of a day, in seconds — the shape a bucket's `start` is. */
const dayStart = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 1000;
const DAY = 86_400;

describe('the chart zoomed to a range', () => {
    it("starts the first bucket's span one past the Clear Number before the range", () => {
        // clearsBefore is 4,120, so the range's first bucket opens on clear 4,121 — not
        // on 1, which is the whole Archive's origin and not this chart's.
        const tooltips = zoomedTooltips({
            size: 'month',
            clearsBefore: 4120,
            buckets: [{ start: dayStart('2021-03-01'), end: dayStart('2021-04-01'), clears: 268, cumulativeClears: 4388 }],
        });

        expect(tooltips[0]).toEqual({
            line: 'Clear 4,388 · Mar 2021',
            bar: 'Mar 2021 · 268 clears · #4,121–#4,388',
        });
    });

    it('names a week by its Monday, and says it is a week', () => {
        // #114's copy: "week of 8 Mar 2021" — which 8 March 2021, a Monday, begins.
        const start = dayStart('2021-03-08');
        const tooltips = zoomedTooltips({
            size: 'week',
            clearsBefore: 4200,
            buckets: [{ start, end: start + 7 * DAY, clears: 12, cumulativeClears: 4212 }],
        });

        expect(tooltips[0]).toEqual({
            line: 'Clear 4,212 · week of 8 Mar 2021',
            bar: 'week of 8 Mar 2021 · 12 clears · #4,201–#4,212',
        });
    });

    it('names a day by its date', () => {
        const start = dayStart('2021-03-14');
        const tooltips = zoomedTooltips({
            size: 'day',
            clearsBefore: 4300,
            buckets: [{ start, end: start + DAY, clears: 3, cumulativeClears: 4303 }],
        });

        expect(tooltips[0].bar).toBe('14 Mar 2021 · 3 clears · #4,301–#4,303');
    });

    it("gives an empty day before the range's first clear the Clear Number the Archive had reached", () => {
        // A date range can open on days with no clears. The line is drawn in absolute
        // Clear Numbers and sits flat at clearsBefore there, so its tooltip names that
        // clear — the one before the range — rather than going quiet.
        const tooltips = zoomedTooltips({
            size: 'day',
            clearsBefore: 102,
            buckets: [
                { start: dayStart('2022-02-01'), end: dayStart('2022-02-02'), clears: 0, cumulativeClears: 102 },
                { start: dayStart('2022-02-02'), end: dayStart('2022-02-03'), clears: 13, cumulativeClears: 115 },
            ],
        });

        expect(tooltips).toEqual([
            { line: 'Clear 102 · 1 Feb 2022', bar: '1 Feb 2022 · no clears' },
            { line: 'Clear 115 · 2 Feb 2022', bar: '2 Feb 2022 · 13 clears · #103–#115' },
        ]);
    });
});
