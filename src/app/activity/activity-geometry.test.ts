import { describe, expect, it } from 'vitest';
import {
    CHART_HEIGHT,
    LAST_LABELLED_TICK_PERCENT,
    busiestStep,
    dayTicks,
    formatStepWindow,
    linePath,
    notYetCounted,
    valueAxis,
} from './activity-geometry';

/**
 * Where things sit on the Raid Activity chart (#194): the day ticks and their UTC
 * labels, the y-axis, the line's path and the shaded "not yet counted" span.
 *
 * Pure and colocated, because this is the half of the chart that can be wrong rather
 * than merely missing: a tick a few hours off, or a shade covering the wrong stretch,
 * still draws a plausible-looking chart. Every expected value below is worked out by
 * hand from the inputs, not by re-running the module's own arithmetic.
 */

const HOUR = 3600;
const DAY = 24 * HOUR;

// A 7-day window like prod's: "now" is Fri 23 Oct 2026 20:33:16 UTC, so the window opens
// on Fri 16 Oct at 20:33:16, 12,404 seconds before the first midnight (Sat 17 Oct).
const NOW = 1792787596;
const FROM = NOW - 7 * DAY;

describe('day ticks', () => {
    it('puts one tick at each UTC midnight in a 7-day window, labelled with its weekday and date', () => {
        // The first midnight is 12,404 s into a 604,800 s axis, 2.0509%; each day after it
        // is another 1/7 of the axis, 14.2857%. Labels are UTC in this ticket.
        const ticks = dayTicks(FROM, NOW);

        expect(ticks.map((tick) => tick.label)).toEqual(['Sat 17', 'Sun 18', 'Mon 19', 'Tue 20', 'Wed 21', 'Thu 22', 'Fri 23']);
        const expected = [2.0509, 16.3366, 30.6223, 44.9080, 59.1938, 73.4795, 87.7652];
        ticks.forEach((tick, index) => expect(tick.percent).toBeCloseTo(expected[index], 3));
    });

    it('labels every other day on a phone, from the first', () => {
        // At 360px a day is ~38px of chart and a label ~35px, so seven labels touch. Every
        // other one keeps the axis readable and still names a day every 48 hours.
        expect(dayTicks(FROM, NOW).map((tick) => tick.phone)).toEqual([true, false, true, false, true, false, true]);
    });

    it('keeps a midnight near the right-hand edge as a gridline but drops its label', () => {
        // A label runs rightwards from its tick, so one starting past the cut-off would
        // run off the chart at 360px. "Now" at 08:24 UTC puts the last midnight at
        // 95% of the axis (8.4 h of 168 h from the end).
        const now = 1792743840; // Fri 23 Oct 2026 08:24 UTC
        const ticks = dayTicks(now - 7 * DAY, now);

        expect(ticks.at(-1)?.percent).toBeCloseTo(95, 6);
        expect(ticks.at(-1)?.label).toBeNull();
        expect(ticks.filter((tick) => tick.label !== null).every((tick) => tick.percent <= LAST_LABELLED_TICK_PERCENT)).toBe(true);
        expect(ticks).toHaveLength(7);
    });
});

describe('day ticks at the edges', () => {
    it('draws a gridline on each edge of a window from midnight to midnight, and labels the cut-off itself', () => {
        // 25 days from a midnight: a tick every 4%, both edges included, and the 22nd day
        // falls exactly on the 88% cut-off — kept, since only a label starting *past* it
        // would run off the chart. The 23rd, at 92%, is a gridline without a label.
        const midnight = 1792195200;
        const ticks = dayTicks(midnight, midnight + 25 * DAY);

        expect(ticks).toHaveLength(26);
        expect(ticks[0].percent).toBe(0);
        expect(ticks.at(-1)?.percent).toBe(100);
        expect(ticks[22]).toMatchObject({ percent: 88, label: 'Sun 8' });
        expect(ticks[23].label).toBeNull();
    });
});

describe('value axis', () => {
    it('uses a round step exactly when it covers the busiest step in four', () => {
        // 2,000 is four steps of 500 exactly, so 500 is the step — not the next round step
        // up, which would leave the axis with three gridlines where it has room for five.
        expect(valueAxis(2000).ticks.map((tick) => tick.value)).toEqual([0, 500, 1000, 1500, 2000]);
    });

    it('rounds the busiest step up to a whole number of round steps', () => {
        // Prod's 7-day peak was ~1,828: four steps of 500 cover it, so the axis tops out at
        // 2,000 and is labelled every 500, from the bottom of the chart up.
        expect(valueAxis(1828)).toEqual({
            max: 2000,
            ticks: [
                { value: 0, label: '0', percent: 0 },
                { value: 500, label: '500', percent: 25 },
                { value: 1000, label: '1,000', percent: 50 },
                { value: 1500, label: '1,500', percent: 75 },
                { value: 2000, label: '2,000', percent: 100 },
            ],
        });
    });

    it('never labels a fraction of a raid, and still has a height with nothing counted', () => {
        // A quiet seeded world peaks at 3 (whole steps of 1), and an empty one at 0 — which
        // must still give the line a height to sit at the bottom of, not a division by zero.
        expect(valueAxis(3).ticks.map((tick) => tick.label)).toEqual(['0', '1', '2', '3']);
        expect(valueAxis(0.4).max).toBe(1);
        expect(valueAxis(0)).toEqual({
            max: 1,
            ticks: [
                { value: 0, label: '0', percent: 0 },
                { value: 1, label: '1', percent: 100 },
            ],
        });
    });
});

describe('the line', () => {
    it('draws each step at its midpoint, with height in proportion to the axis', () => {
        // A 4-hour axis holding three hourly steps of 1, 3 and 2 against a top of 3: the
        // midpoints sit at 12.5%, 37.5% and 62.5% of a 1000-wide chart, and the heights at
        // 1/3, 3/3 and 2/3 of it, measured down from the top.
        const from = 1792195200;
        const points = [
            { start: from, end: from + HOUR, total: 1 },
            { start: from + HOUR, end: from + 2 * HOUR, total: 3 },
            { start: from + 2 * HOUR, end: from + 3 * HOUR, total: 2 },
        ];

        const h = CHART_HEIGHT;
        expect(linePath(points, from, from + 4 * HOUR, 3)).toBe(
            `M125,${round(h - h / 3)}L375,0L625,${round(h - (2 * h) / 3)}`
        );
    });

    it('draws nothing for a series with no points', () => {
        // A range whose steps are all newer than two hours has no counted value at all.
        expect(linePath([], FROM, NOW, 1)).toBe('');
    });
});

describe('the not-yet-counted span', () => {
    it('shades from where the last counted step ends to the right-hand edge', () => {
        // "Now" is 20:33:16, so the moment two hours ago is 18:33:16 and the last counted
        // step ends at 18:00 — 9,196 s before "now", which is where the query reports that
        // counting ends. The shade starts there, (604,800 − 9,196) / 604,800 = 98.4795% of
        // the way across, and meets the line's last step rather than leaving a gap after it.
        const span = notYetCounted({ from: FROM, to: NOW, countedUntil: NOW - 9196 });

        expect(span.startPercent).toBeCloseTo(98.4795, 3);
        expect(span.endPercent).toBe(100);
    });
});

describe('the busiest step', () => {
    it('names the busiest step and its window in UTC', () => {
        // The caption under the chart reads it: the hour with the most raids in progress,
        // the earliest one on a tie, and its window spelled out as a reader would say it.
        const points = [
            { start: 1792195200, end: 1792198800, total: 4 },
            { start: 1792198800, end: 1792202400, total: 7.4 },
            { start: 1792202400, end: 1792206000, total: 7.4 },
        ];

        expect(busiestStep(points)).toEqual(points[1]);
        expect(busiestStep([])).toBeNull();
        expect(formatStepWindow(points[1].start, points[1].end)).toBe('Sat 17 Oct, 01:00–02:00 UTC');
        // Across midnight the window still reads as one evening's hour.
        expect(formatStepWindow(1792195200 - HOUR, 1792195200)).toBe('Fri 16 Oct, 23:00–00:00 UTC');
    });

    it('names no busiest step when nothing was counted', () => {
        // A week of zeros has no busiest hour: naming its first as "0 raids in progress"
        // would hide the caption's "No raids counted" sentence behind a peak that isn't one.
        const points = [
            { start: 1792195200, end: 1792198800, total: 0 },
            { start: 1792198800, end: 1792202400, total: 0 },
        ];

        expect(busiestStep(points)).toBeNull();
    });
});

/** Two decimal places, the precision the path is written at. */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}
