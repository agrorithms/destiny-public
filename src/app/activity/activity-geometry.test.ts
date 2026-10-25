import { describe, expect, it } from 'vitest';
import { COUNTED_AGE_SECONDS, PROVISIONAL_MIN_AGE_SECONDS } from '@/lib/db/queries';
import { ACTIVITY_RANGES, type ActivityRangeId } from './activity-range';
import type { OffsetOf } from './activity-time';
import {
    CHART_HEIGHT,
    LAST_LABELLED_TICK_PERCENT,
    NOT_YET_COUNTED_AGE_SECONDS,
    TOO_RECENT_AGE_SECONDS,
    axisTicks,
    beforeData,
    busiestStep,
    dayTicks,
    describeBeforeData,
    hourTicks,
    linePath,
    linePaths,
    peakAriaLabel,
    peakCaption,
    provisionalLegend,
    tallestStep,
    tooRecent,
    tooRecentLegend,
    valueAxis,
} from './activity-geometry';

/**
 * Where things sit on the Raid Activity chart (#194–#196): the day ticks and their UTC
 * labels, the y-axis, the line's solid and dashed paths, the too-recent span and the legends.
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
        // 2,000 and is labelled every 500, from the bottom of the chart up. Each gridline's
        // y is measured down from the top of the 200-high chart, so 0 sits at 200 and the
        // top value at 0.
        expect(valueAxis(1828)).toEqual({
            max: 2000,
            ticks: [
                { value: 0, label: '0', percent: 0, y: 200 },
                { value: 500, label: '500', percent: 25, y: 150 },
                { value: 1000, label: '1,000', percent: 50, y: 100 },
                { value: 1500, label: '1,500', percent: 75, y: 50 },
                { value: 2000, label: '2,000', percent: 100, y: 0 },
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
                { value: 0, label: '0', percent: 0, y: 200 },
                { value: 1, label: '1', percent: 100, y: 0 },
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
            { start: from, end: from + HOUR, total: 1, provisional: false },
            { start: from + HOUR, end: from + 2 * HOUR, total: 3, provisional: false },
            { start: from + 2 * HOUR, end: from + 3 * HOUR, total: 2, provisional: false },
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

describe('the solid and the dashed line', () => {
    // A 10-hour window of hourly steps: midpoints at 5%, 15%, 25%, 35% of a 1000-wide chart
    // (x = 50, 150, 250, 350). Against a top of 4 on a 200-high chart a total of t sits at
    // y = 200 (1 - t/4): 1 -> 150, 3 -> 50, 2 -> 100, 4 -> 0.
    const from = 1792195200;
    const to = from + 10 * HOUR;
    const step = (index: number, total: number, provisional: boolean) => ({
        start: from + index * HOUR,
        end: from + (index + 1) * HOUR,
        total,
        provisional,
    });

    it('draws the counted steps solid and the estimated ones dashed, the dashed starting on the last counted point', () => {
        // The two segments meet: the dashed path begins at the solid one's last vertex, so
        // the line is continuous and only its style changes at the boundary.
        const points = [
            step(0, 1, false),
            step(1, 3, false),
            step(2, 2, false),
            step(3, 4, true),
            step(4, 2, true),
        ];

        expect(linePaths(points, from, to, 4)).toEqual({
            solid: 'M50,150L150,50L250,100',
            dashed: 'M250,100L350,0L450,100',
        });
    });

    it('draws no dashed line when nothing is estimated', () => {
        // With no history to learn a curve from there are no estimates: no dashed path at all.
        const points = [step(0, 1, false), step(1, 3, false)];

        expect(linePaths(points, from, to, 4)).toEqual({ solid: 'M50,150L150,50', dashed: null });
    });

    it('starts the dashed line at its own first point when there is no counted step', () => {
        // A database whose history starts hours ago has estimates but nothing counted to
        // join them to.
        const points = [step(2, 2, true), step(3, 4, true)];

        expect(linePaths(points, from, to, 4)).toEqual({ solid: '', dashed: 'M250,100L350,0' });
    });

    it('draws nothing for a series with no points', () => {
        // An empty database: the page still renders, with no line and no dashed segment.
        expect(linePaths([], from, to, 4)).toEqual({ solid: '', dashed: null });
    });
});

describe('the too-recent span', () => {
    it('shades from where the line ends to the right-hand edge', () => {
        // The last estimated step ends at 98.4795% across a week; the shade runs from there
        // to "now", the steps too young to estimate.
        const span = tooRecent({ from: FROM, to: NOW, provisionalUntil: NOW - 9196 });

        expect(span.startPercent).toBeCloseTo(98.4795, 3);
        expect(span.endPercent).toBe(100);
        expect(span.widthPercent).toBeCloseTo(1.5205, 3);
    });

    it("the dashed line's last vertex sits at or before the too-recent shade", () => {
        // Hourly steps, "now" 5 hours 20 minutes into the window: the last step at least 15
        // minutes old ends at 5 hours, and the estimate runs through it. The dashed line's last
        // vertex is that step's midpoint, 4.5 hours in (843.75 of 1000); the shade starts at
        // the step's end, 5 hours in (93.75%), half a step to its right. A vertex inside the
        // shade would be an estimate of a step too recent to estimate.
        const from = 1792195200;
        const series = { from, to: from + 5 * HOUR + 20 * 60, provisionalUntil: from + 5 * HOUR };
        const points = [0, 1, 2, 3, 4].map((index) => ({
            start: from + index * HOUR,
            end: from + (index + 1) * HOUR,
            total: 2,
            provisional: index >= 3,
        }));

        const dashed = linePaths(points, series.from, series.to, 4).dashed ?? '';
        const lastX = Number(dashed.match(/L([\d.]+),[\d.]+$/)?.[1]);

        expect(lastX).toBeCloseTo(843.75, 2);
        expect(tooRecent(series).startPercent).toBeCloseTo(93.75, 3);
    });
});

describe('the tallest step', () => {
    const counted = { start: 0, end: HOUR, total: 3, provisional: false };
    const estimate = { start: HOUR, end: 2 * HOUR, total: 5.5, provisional: true };

    it('fits the estimates, so the axis does not clip the dashed line', () => {
        expect(tallestStep([counted, estimate])).toBe(5.5);
        expect(tallestStep([])).toBe(0);
    });

    it('leaves the estimates out of the busiest step, which is a counted fact', () => {
        // The caption names the busiest *counted* hour; an estimate above it must not take
        // the title and its window.
        expect(busiestStep([counted, estimate])).toEqual(counted);
        expect(busiestStep([estimate])).toBeNull();
    });
});

describe('the busiest step', () => {
    it('names the busiest step, the earliest on a tie', () => {
        // The caption under the chart reads it: the hour with the most raids in progress,
        // the earliest one on a tie.
        const points = [
            { start: 1792195200, end: 1792198800, total: 4, provisional: false },
            { start: 1792198800, end: 1792202400, total: 7.4, provisional: false },
            { start: 1792202400, end: 1792206000, total: 7.4, provisional: false },
        ];

        expect(busiestStep(points)).toEqual(points[1]);
        expect(busiestStep([])).toBeNull();
    });

    it('names no busiest step when nothing was counted', () => {
        // A week of zeros has no busiest hour: naming its first as "0 raids in progress"
        // would hide the caption's "No raids counted" sentence behind a peak that isn't one.
        const points = [
            { start: 1792195200, end: 1792198800, total: 0, provisional: false },
            { start: 1792198800, end: 1792202400, total: 0, provisional: false },
        ];

        expect(busiestStep(points)).toBeNull();
    });
});

/** The preset with this id. */
function range(id: ActivityRangeId) {
    return ACTIVITY_RANGES.find((preset) => preset.id === id)!;
}

describe('hour ticks for the 24-hour range', () => {
    // "Now" is Fri 23 Oct 20:33:16 UTC, so the 24-hour window opens on Thu 22 Oct at
    // 20:33:16 and its first 3-hour tick, 21:00, is 1,604 s in: 1.8565% of 86,400 s. Each
    // tick after it is another 3/24 of the axis, 12.5%.
    const from = NOW - DAY;

    it('puts a tick every 3 UTC hours, labelled with the hour, and names the day at midnight', () => {
        // A day's chart reads in hours, but a reader still needs to see where one day ends:
        // midnight is labelled with the day it begins instead of "00:00".
        const ticks = hourTicks(from, NOW);

        expect(ticks.map((tick) => tick.label)).toEqual(['21:00', 'Fri 23', '03:00', '06:00', '09:00', '12:00', '15:00', null]);
        const expected = [1.8565, 14.3565, 26.8565, 39.3565, 51.8565, 64.3565, 76.8565, 89.3565];
        ticks.forEach((tick, index) => expect(tick.percent).toBeCloseTo(expected[index], 3));
    });

    it('keeps the 6-hourly labels on a phone, midnight among them', () => {
        // At 360px three hours is ~37px of chart, so every label would touch. Every 6 UTC
        // hours keeps the day's name at midnight whatever time the window opens.
        expect(hourTicks(from, NOW).map((tick) => tick.phone)).toEqual([false, true, false, true, false, true, false, true]);
    });

    it('draws a gridline on each edge of a window from midnight to midnight, the right-hand one unlabelled', () => {
        // Ticks run up to and including the right-hand edge, like the day ticks: a window
        // ending on the hour still has its gridline there, with no label to run off it.
        const midnight = 1792195200; // Sat 17 Oct 2026, 00:00 UTC
        const ticks = hourTicks(midnight - DAY, midnight);

        expect(ticks).toHaveLength(9);
        expect(ticks[0]).toMatchObject({ percent: 0, label: 'Fri 16' });
        expect(ticks.at(-1)).toMatchObject({ percent: 100, label: null });
    });

    it('labels a tick exactly at the cut-off', () => {
        // Only a label starting *past* 88% would run off the chart: one at 88% stays. The
        // window ends 10,368 s after midnight, so midnight sits 76,032 s into 86,400: 88%.
        const midnight = 1792195200;
        const ticks = hourTicks(midnight - 76032, midnight + 10368);

        expect(ticks.find((tick) => tick.label === 'Sat 17')?.percent).toBe(88);
    });

    it('is what the 24-hour range draws', () => {
        expect(axisTicks(from, NOW, range('24h'))).toEqual(hourTicks(from, NOW));
    });
});

describe('day ticks for the 7- and 30-day ranges', () => {
    it('draws the 7-day range with a tick every UTC midnight', () => {
        expect(axisTicks(FROM, NOW, range('7d'))).toEqual(dayTicks(FROM, NOW));
    });

    it('draws the 30-day range with a tick every other UTC midnight, on even days since the epoch', () => {
        // The window opens Wed 23 Sep at 20:33:16; the first even-numbered epoch day after
        // it is Thu 24 Sep (day 20,720), 12,404 s in: 0.4785% of 30 days. Every two days is
        // another 6.6667%. Even epoch days, not "every other from the first", so the labels
        // don't jump a day each time the window moves past a midnight. Thu 22 Oct, at
        // 93.81%, is past the label cut-off.
        const from = NOW - 30 * DAY;
        const ticks = axisTicks(from, NOW, range('30d'));

        expect(ticks.map((tick) => tick.label)).toEqual([
            'Thu 24', 'Sat 26', 'Mon 28', 'Wed 30', 'Fri 2', 'Sun 4', 'Tue 6', 'Thu 8',
            'Sat 10', 'Mon 12', 'Wed 14', 'Fri 16', 'Sun 18', 'Tue 20', null,
        ]);
        expect(ticks[0].percent).toBeCloseTo(0.4785, 3);
        expect(ticks[1].percent).toBeCloseTo(7.1452, 3);
        expect(ticks.at(-1)?.percent).toBeCloseTo(93.8119, 3);
    });

    it('labels every third 30-day tick on a phone, six days apart', () => {
        // At 360px two days is ~20px of chart, so a label at each would overlap its
        // neighbours; six days is ~59px, room for one.
        const ticks = axisTicks(NOW - 30 * DAY, NOW, range('30d'));

        expect(ticks.filter((tick) => tick.phone).map((tick) => tick.label)).toEqual(['Thu 24', 'Wed 30', 'Tue 6', 'Mon 12', 'Sun 18']);
    });
});

describe('the span before the data starts', () => {
    it('shades from the left-hand edge to where counting starts when the window opens at the retention bound', () => {
        // Prod keeps 720 hours of PGCRs, the 30-day window exactly, so the query starts
        // counting 6 hours in (the margin after the oldest report): 6 / 720 = 0.8333% of
        // the way across.
        const from = 1792195200 - 30 * DAY;
        const span = beforeData({ from, to: from + 30 * DAY, stepSeconds: 3 * HOUR, countedFrom: from + 6 * HOUR });

        expect(span).toEqual({ startPercent: 0, endPercent: expect.closeTo(0.8333, 3), widthPercent: expect.closeTo(0.8333, 3) });
    });

    it('shades a third of a 30-day window whose data starts ten days in', () => {
        // A database that has only kept 20 days: the first ten are no history, not a quiet
        // stretch.
        const from = 1792195200 - 30 * DAY;
        const span = beforeData({ from, to: from + 30 * DAY, stepSeconds: 3 * HOUR, countedFrom: from + 10 * DAY });

        expect(span?.endPercent).toBeCloseTo(33.3333, 3);
        expect(span?.widthPercent).toBeCloseTo(33.3333, 3);
    });

    it('shades nothing when counting starts at the window\'s first whole step', () => {
        // The window opens at 20:33:16, so its first whole hour starts at 21:00: the 26
        // minutes before it are the step grid, not missing data.
        expect(beforeData({ from: FROM, to: NOW, stepSeconds: HOUR, countedFrom: FROM + 1604 })).toBeNull();
    });

    it('shades up to a step past the first whole one when the data starts there', () => {
        // One hour later than the first whole step, 22:00: 5,204 s of 604,800, 0.8604%.
        expect(beforeData({ from: FROM, to: NOW, stepSeconds: HOUR, countedFrom: FROM + 1604 + HOUR })?.endPercent)
            .toBeCloseTo(0.8604, 3);
    });

    it('says where the data starts, in UTC', () => {
        expect(describeBeforeData(1792195200 - 21 * DAY + 6 * HOUR)).toBe(
            'Shaded at the left: no data before Sat 26 Sep, 06:00 UTC. Older raid reports are no longer stored.'
        );
    });
});

describe('the peak sentence', () => {
    // Sat 17 Oct 2026, 00:00 UTC.
    const midnight = 1792195200;

    it('names the busiest hour over the last 7 days', () => {
        // #194's caption and label, unchanged for the default range.
        const busiest = { start: midnight, end: midnight + HOUR, total: 1828, provisional: false };

        expect(peakCaption(busiest, range('7d'))).toBe('Busiest hour: 1,828 raids in progress, Sat 17 Oct, 00:00–01:00 UTC.');
        expect(peakAriaLabel(busiest, range('7d'))).toBe(
            'Raids in progress per hour over the last 7 days, peaking at 1,828 raids in progress, Sat 17 Oct, 00:00–01:00 UTC'
        );
    });

    it('names the busiest 10 minutes over the last 24 hours', () => {
        const busiest = { start: midnight, end: midnight + 600, total: 2, provisional: false };

        expect(peakCaption(busiest, range('24h'))).toBe('Busiest 10 minutes: 2 raids in progress, Sat 17 Oct, 00:00–00:10 UTC.');
        expect(peakAriaLabel(busiest, range('24h'))).toBe(
            'Raids in progress per 10 minutes over the last 24 hours, peaking at 2 raids in progress, Sat 17 Oct, 00:00–00:10 UTC'
        );
    });

    it('names the busiest 3 hours over the last 30 days, and says "raid" for one', () => {
        // An average of 1 — or anything that rounds to it — is one raid, not "1 raids".
        const busiest = { start: midnight, end: midnight + 3 * HOUR, total: 1, provisional: false };

        expect(peakCaption(busiest, range('30d'))).toBe('Busiest 3 hours: 1 raid in progress, Sat 17 Oct, 00:00–03:00 UTC.');
        expect(peakAriaLabel(busiest, range('30d'))).toBe(
            'Raids in progress per 3 hours over the last 30 days, peaking at 1 raid in progress, Sat 17 Oct, 00:00–03:00 UTC'
        );
        expect(peakCaption({ ...busiest, total: 0.6 }, range('30d'))).toMatch(/^Busiest 3 hours: 1 raid in progress,/);
        expect(peakCaption({ ...busiest, total: 1.5 }, range('30d'))).toMatch(/^Busiest 3 hours: 2 raids in progress,/);
    });

    it('says nothing was counted when there is no busiest step', () => {
        expect(peakCaption(null, range('30d'))).toBe('No raids counted in the last 30 days yet.');
        expect(peakAriaLabel(null, range('30d'))).toBe('Raids in progress per 3 hours over the last 30 days: none counted yet');
        expect(peakCaption(null, range('24h'))).toBe('No raids counted in the last 24 hours yet.');
    });
});

describe('the legends for the estimate and the shade', () => {
    it('says how wide the shade can be at each range\'s step', () => {
        // The line ends at the last whole step 15 minutes old, so the shade is 15 minutes
        // plus up to one step wide, per range.
        expect(tooRecentLegend(HOUR)).toBe('Shaded: the last 15 minutes to 1 hour 15 minutes, too recent to estimate.');
        expect(tooRecentLegend(600)).toBe('Shaded: the last 15 to 25 minutes, too recent to estimate.');
        expect(tooRecentLegend(3 * HOUR)).toBe('Shaded: the last 15 minutes to 3 hours 15 minutes, too recent to estimate.');
    });

    it('says where the dashed line starts at each range\'s step', () => {
        // It starts where counting ends: 2 hours back plus up to one step.
        expect(provisionalLegend(HOUR)).toBe('Dashed: an estimate, from 2 to 3 hours ago up to the shaded stretch.');
        expect(provisionalLegend(600)).toBe('Dashed: an estimate, from 2 hours to 2 hours 10 minutes ago up to the shaded stretch.');
        expect(provisionalLegend(3 * HOUR)).toBe('Dashed: an estimate, from 2 to 5 hours ago up to the shaded stretch.');
    });

    it('words any step size, not only the three ranges\'', () => {
        // A step that makes the longest end exactly an hour: "15 minutes to 1 hour", each end
        // with its own unit, not "0.25 to 1 hour" or "15 to 1 hour".
        expect(tooRecentLegend(45 * 60)).toBe('Shaded: the last 15 minutes to 1 hour, too recent to estimate.');
        expect(provisionalLegend(30 * 60)).toBe('Dashed: an estimate, from 2 hours to 2 hours 30 minutes ago up to the shaded stretch.');
    });

    it('keeps a copy of the query\'s counted age', () => {
        // This module can't import the query's value (it would put better-sqlite3 on the
        // client path #197 adds), so it keeps a copy, and this is what stops them drifting.
        expect(NOT_YET_COUNTED_AGE_SECONDS).toBe(COUNTED_AGE_SECONDS);
    });

    it('keeps a copy of the query\'s 15-minute cutoff', () => {
        // As with the counted age: this module can't import the query's value without
        // putting better-sqlite3 on the client path, so this stops the copy drifting.
        expect(TOO_RECENT_AGE_SECONDS).toBe(PROVISIONAL_MIN_AGE_SECONDS);
    });
});

/** Two decimal places, the precision the path is written at. */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * The same chart in a reader's time zone (#197): the gridlines and their labels fall on the
 * zone's midnights and 3-hour marks, so a UTC midnight is no longer where a day starts. Every
 * expected position is worked out by hand from the zone's offset.
 */
describe('ticks in a reader\'s time zone', () => {
    // UTC+5:45 all year: a local midnight is 18:15 UTC the evening before.
    const KATHMANDU: OffsetOf = () => 345;

    it('puts the 7-day range\'s ticks on local midnights, not UTC ones', () => {
        // The window opens Fri 16 Oct at 20:33:16 UTC. Local Sat 17 began at 18:15 UTC on the
        // 16th, before it; local Sun 18 began 78,104 s in (21 h 41 m 44 s), 12.9143% of the
        // week, and each day after is another 14.2857%. Local Sat 24 began at 18:15 UTC on
        // Fri 23, just before "now": a seventh tick, past the label cut-off.
        const ticks = axisTicks(FROM, NOW, range('7d'), KATHMANDU);

        expect(ticks.map((tick) => tick.label)).toEqual(['Sun 18', 'Mon 19', 'Tue 20', 'Wed 21', 'Thu 22', 'Fri 23', null]);
        ticks.forEach((tick, index) => expect(tick.percent).toBeCloseTo(12.9143 + index * 14.2857, 3));
        expect(ticks.map((tick) => tick.phone)).toEqual([true, false, true, false, true, false, true]);
    });

    it('puts the 24-hour range\'s ticks on local 3-hour marks, a quarter past on the UTC clock', () => {
        // Local 03:00 is 21:15 UTC the evening before. The window opens Thu 22 Oct at
        // 20:33:16 UTC, so the first mark is 2,504 s in: 2.8981% of the day, and each 3 hours
        // is another 12.5%. The last, local midnight at 90.3981%, is past the label cut-off.
        const ticks = axisTicks(NOW - DAY, NOW, range('24h'), KATHMANDU);

        expect(ticks.map((tick) => tick.label)).toEqual(['03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', null]);
        ticks.forEach((tick, index) => expect(tick.percent).toBeCloseTo(2.8981 + index * 12.5, 3));
        // A phone keeps the marks on a local 6-hour boundary, midnight among them.
        expect(ticks.map((tick) => tick.phone)).toEqual([false, true, false, true, false, true, false, true]);
    });

    it('names the day at a local midnight in the 24-hour range', () => {
        // Window to Fri 23 Oct 12:00 UTC, opening Thu 22 at 12:00. Local midnight Fri 23 is
        // 18:15 UTC on the 22nd, 6 h 15 m in (26.0417%), and is named by its day as in UTC.
        // The mark before it is 18:00 and 21:00 local; the last, 15:00 local at 88.5417%, is
        // past the label cut-off.
        const now = 1792756800;
        const ticks = axisTicks(now - DAY, now, range('24h'), KATHMANDU);

        expect(ticks.map((tick) => tick.label)).toEqual(['18:00', '21:00', 'Fri 23', '03:00', '06:00', '09:00', '12:00', null]);
        expect(ticks[2].percent).toBeCloseTo(26.0417, 3);
        expect(ticks[7].percent).toBeCloseTo(88.5417, 3);
    });

    it('puts the 30-day range\'s ticks on every other local midnight, on even local days', () => {
        // Local Thu 24 Sep began before the window opened, so the first even local day is
        // Sat 26 (day 20,722), 164,504 s in: 6.3466% of 30 days; every two days is another
        // 6.6667%. Local Thu 22 and Sat 24 Oct are past the label cut-off.
        const ticks = axisTicks(NOW - 30 * DAY, NOW, range('30d'), KATHMANDU);

        expect(ticks.map((tick) => tick.label)).toEqual([
            'Sat 26', 'Mon 28', 'Wed 30', 'Fri 2', 'Sun 4', 'Tue 6', 'Thu 8', 'Sat 10',
            'Mon 12', 'Wed 14', 'Fri 16', 'Sun 18', 'Tue 20', null, null,
        ]);
        ticks.forEach((tick, index) => expect(tick.percent).toBeCloseTo(6.3466 + index * 6.6667, 3));
        expect(ticks.map((tick) => tick.phone).slice(0, 4)).toEqual([true, false, false, true]);
    });

    it('follows a clock change: the midnight after it is an hour later in UTC than the one before', () => {
        // London goes back an hour at 01:00 UTC on Sun 25 Oct 2026. The window is the 7 days
        // to Mon 26 Oct 12:00 UTC. Local Tue 20 began at 23:00 UTC on Mon 19, 39,600 s in
        // (6.5476%); local Sun 25 began at 23:00 UTC on Sat 24 (summer time), 471,600 s in
        // (77.9762%) and local Mon 26 at 00:00 UTC, 561,600 s in (92.8571%, unlabelled).
        const london: OffsetOf = (at) => (at < 1792890000 ? 60 : 0);
        const now = 1793016000;
        const ticks = axisTicks(now - 7 * DAY, now, range('7d'), london);

        expect(ticks.map((tick) => tick.label)).toEqual(['Tue 20', 'Wed 21', 'Thu 22', 'Fri 23', 'Sat 24', 'Sun 25', null]);
        expect(ticks[0].percent).toBeCloseTo(6.5476, 3);
        expect(ticks[5].percent).toBeCloseTo(77.9762, 3);
        expect(ticks[6].percent).toBeCloseTo(92.8571, 3);
    });

    // The Azores go back an hour at 01:00 UTC on Sun 25 Oct 2026, from UTC+0 to UTC-1, so their
    // clock reads 00:00 twice: at 00:00 UTC and again at 01:00 UTC. One midnight is one tick,
    // the first, or the chart would draw two `Sun 25` gridlines an hour apart.
    const AZORES: OffsetOf = (at) => (at < 1792890000 ? 0 : -60);

    it('marks a midnight the clock reads twice once, at the first of the two', () => {
        // The 7 days to Mon 26 Oct 12:00 UTC, opening Mon 19 at 12:00. Local Tue 20 began at
        // 00:00 UTC, 43,200 s in (7.1429%); local Sun 25 at 00:00 UTC, 475,200 s in (78.5714%),
        // and not again at 01:00 UTC; local Mon 26 at 01:00 UTC, 565,200 s in (93.4524%,
        // unlabelled).
        const now = 1793016000;
        const ticks = axisTicks(now - 7 * DAY, now, range('7d'), AZORES);

        expect(ticks.map((tick) => tick.label)).toEqual(['Tue 20', 'Wed 21', 'Thu 22', 'Fri 23', 'Sat 24', 'Sun 25', null]);
        expect(ticks[0].percent).toBeCloseTo(7.1429, 3);
        expect(ticks[5].percent).toBeCloseTo(78.5714, 3);
        expect(ticks[6].percent).toBeCloseTo(93.4524, 3);
        expect(ticks.map((tick) => tick.phone)).toEqual([true, false, true, false, true, false, true]);
    });

    it('marks the repeated midnight once in the 24-hour range too, and the 3-hour marks after it on the new clock', () => {
        // The 24 hours to Sun 25 Oct 12:00 UTC. Every 3 hours from the window's start to local
        // midnight at 00:00 UTC (50%); not again at 01:00 UTC; then local 03:00 at 04:00 UTC
        // (66.6667%), 06:00 at 07:00 UTC (79.1667%) and 09:00 at 10:00 UTC (91.6667%, unlabelled).
        const now = 1792929600;
        const ticks = axisTicks(now - DAY, now, range('24h'), AZORES);

        expect(ticks.map((tick) => tick.label)).toEqual(['12:00', '15:00', '18:00', '21:00', 'Sun 25', '03:00', '06:00', null]);
        expect(ticks.map((tick) => tick.percent)).toEqual([0, 12.5, 25, 37.5, 50, expect.closeTo(66.6667, 3), expect.closeTo(79.1667, 3), expect.closeTo(91.6667, 3)]);
        expect(ticks.map((tick) => tick.phone)).toEqual([true, false, true, false, true, false, true, false]);
    });

    it('is the UTC axis when there is no offset', () => {
        expect(axisTicks(FROM, NOW, range('7d'), null)).toEqual(axisTicks(FROM, NOW, range('7d')));
    });
});

describe('the sentences in a reader\'s time zone', () => {
    const KATHMANDU: OffsetOf = () => 345;

    it('names the peak\'s window on the reader\'s clock, and keeps the accessible name in UTC', () => {
        // 00:00–01:00 UTC on Sat 17 Oct is 05:45–06:45 in Kathmandu. The SVG's accessible name
        // is read before any script runs and must not change under a screen reader.
        const busiest = { start: 1792195200, end: 1792195200 + HOUR, total: 1828, provisional: false };

        expect(peakCaption(busiest, range('7d'), KATHMANDU)).toBe('Busiest hour: 1,828 raids in progress, Sat 17 Oct, 05:45–06:45.');
        expect(peakAriaLabel(busiest, range('7d'))).toBe(
            'Raids in progress per hour over the last 7 days, peaking at 1,828 raids in progress, Sat 17 Oct, 00:00–01:00 UTC'
        );
    });

    it('says where the data starts on the reader\'s clock', () => {
        expect(describeBeforeData(1792195200 - 21 * DAY + 6 * HOUR, KATHMANDU)).toBe(
            'Shaded at the left: no data before Sat 26 Sep, 11:45. Older raid reports are no longer stored.'
        );
    });
});
