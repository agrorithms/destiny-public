import { describe, expect, it } from 'vitest';
import {
    CURVE_BIN_SECONDS,
    CURVE_MAX_AGE_SECONDS,
    curveFromTally,
    estimateTotal,
    hourOfStep,
    newTally,
    shareAt,
    tallyRun,
    trainingWindow,
    type CompletenessCurve,
} from './completeness-curve';

/**
 * The completeness curve (#196): for each hour of the day, what share of a step's raid time
 * is already known a given age after the step ends. The Provisional estimate divides the
 * partial count by that share, so a wrong share is a wrong chart that looks plausible. These
 * tests drive the arithmetic with runs short enough to work out by hand; the SQL that feeds
 * it is tested against a real database in tests/db/completeness-curve.test.ts.
 *
 * Everything is on one 1-hour grid unless a test says otherwise. `S` is the start of a
 * training step, at 03:00 UTC, so the steps it makes are hours 3 and 4 of the day.
 */
const HOUR = 3600;
const MINUTE = 60;
const DAY = 24 * HOUR;
const S = 20000 * DAY + 3 * HOUR;
/** A window wide enough that no test below is clipped by it. */
const WIDE = { from: S - DAY, until: S + DAY };

function tallied(runs: Array<[number, number]>, step = HOUR, window = WIDE) {
    const tally = newTally();
    for (const [period, endedAt] of runs) tallyRun(tally, window, step, period, endedAt);
    return curveFromTally(tally);
}

/** The curve of a tally known to hold data: fails the test rather than return null. */
function curveOf(runs: Array<[number, number]>, step = HOUR, window = WIDE): CompletenessCurve {
    const curve = tallied(runs, step, window);
    if (curve === null) throw new Error('expected a curve');
    return curve;
}

describe('the training window', () => {
    it('ends at the last step whose end is 24 hours old and reaches back 7 days from there', () => {
        // "Complete" is a bound on age: a step 24 hours old has had every run that overlapped
        // it end bar the multi-day ones. The window is the 7 days before that bound, on the
        // step grid, so every training step is whole.
        const now = 20100 * DAY + 5 * HOUR + 17 * MINUTE;

        expect(trainingWindow(now, HOUR)).toEqual({
            until: 20099 * DAY + 5 * HOUR,
            from: 20092 * DAY + 5 * HOUR,
        });
    });

    it('sits on the 3-hour grid at the 30-day range', () => {
        const now = 20100 * DAY + 5 * HOUR;

        const { from, until } = trainingWindow(now, 3 * HOUR);

        expect(until).toBe(20099 * DAY + 3 * HOUR);
        expect(until - from).toBe(7 * DAY);
        expect(until % (3 * HOUR)).toBe(0);
    });
});

describe('which hour a step belongs to', () => {
    it('is the UTC hour of the step\'s midpoint', () => {
        // A 3-hour step starting at 00:00 spends most of its life in hours 0 to 2; its
        // midpoint, 01:30, names it. A 10-minute step is the hour it sits in.
        expect(hourOfStep(20000 * DAY, 3 * HOUR)).toBe(1);
        expect(hourOfStep(20000 * DAY + 5 * HOUR + 50 * MINUTE, 10 * MINUTE)).toBe(5);
    });

    it('wraps at midnight rather than reaching hour 24', () => {
        expect(hourOfStep(20000 * DAY + 23 * HOUR, HOUR)).toBe(23);
        expect(hourOfStep(20000 * DAY + 22 * HOUR, 3 * HOUR)).toBe(23);
    });
});

describe('learning shares from runs', () => {
    it('reads a run that ends with its step as fully known at every age', () => {
        // The whole run was in the step and over by its end, so nothing is waiting on a
        // report that arrives later: the share is 1 from age 0.
        const curve = curveOf([[S, S + HOUR]]);

        expect(shareAt(curve, 3, 0)).toBe(1);
        expect(shareAt(curve, 3, 15 * MINUTE)).toBe(1);
    });

    it('counts a run that outlasts its step only from the age it ended', () => {
        // 45 minutes into the 03:00 step to 45 minutes past its end: 15 minutes of raid time
        // in 03:00 that no report covers until 45 minutes after the step. At 04:00 the same
        // run is 45 minutes of time known already.
        const curve = curveOf([[S + 45 * MINUTE, S + 105 * MINUTE]]);

        expect(shareAt(curve, 3, 40 * MINUTE)).toBe(0);
        expect(shareAt(curve, 3, 45 * MINUTE)).toBe(1);
        expect(shareAt(curve, 4, 0)).toBe(1);
    });

    it('weights each run by the raid time it has in the step', () => {
        // A whole-step run (3600 s, known at once) and a run with 900 s in the step that
        // is known only 45 minutes later. Total 4500 s: 80% known at once, all of it at 45 minutes.
        const curve = curveOf([
            [S, S + HOUR],
            [S + 45 * MINUTE, S + 105 * MINUTE],
        ]);

        expect(shareAt(curve, 3, 0)).toBeCloseTo(0.8, 10);
        expect(shareAt(curve, 3, 20 * MINUTE)).toBeCloseTo(0.8, 10);
        expect(shareAt(curve, 3, 45 * MINUTE)).toBeCloseTo(1, 10);
        // Between the two points the share moves from 0.8 to 1 in proportion: a quarter of
        // the way through the 40-to-45-minute bin is 0.85.
        expect(shareAt(curve, 3, 41.25 * MINUTE)).toBeCloseTo(0.85, 10);
    });

    it('credits a long run to every step it overlaps, each at its own age', () => {
        // Two and a half hours from 03:00: it ends 90 minutes after the 03:00 step does,
        // 30 minutes after 04:00 does, and inside 05:00. Each step learns when *its* share
        // of the run became known.
        const curve = curveOf([[S, S + 150 * MINUTE]]);

        expect(shareAt(curve, 3, 85 * MINUTE)).toBe(0);
        expect(shareAt(curve, 3, 90 * MINUTE)).toBe(1);
        expect(shareAt(curve, 4, 25 * MINUTE)).toBe(0);
        expect(shareAt(curve, 4, 30 * MINUTE)).toBe(1);
        expect(shareAt(curve, 5, 0)).toBe(1);
    });

    it('keeps a run that ends after the curve\'s longest age out of every share', () => {
        // A run reported 2 hours 5 minutes after its step ends is past the 2 hours the curve
        // covers, so the 03:00 share stays at nothing however far the age goes, and the curve
        // gains no point for it.
        const curve = curveOf([[S, S + HOUR + 125 * MINUTE]]);

        expect(shareAt(curve, 3, CURVE_MAX_AGE_SECONDS)).toBe(0);
        expect(curve.byHour[3]).toHaveLength(CURVE_MAX_AGE_SECONDS / CURVE_BIN_SECONDS + 1);
    });

    it('ignores the steps of a run that lie before the window, as well as after it', () => {
        // The window is 04:00 only. The run starts in 03:00 and ends in 05:00: only its 04:00
        // piece is learned, so hours 3 and 5 stay empty.
        const window = { from: S + HOUR, until: S + 2 * HOUR };
        const curve = curveOf([[S + 30 * MINUTE, S + 150 * MINUTE]], HOUR, window);

        expect(curve.byHour[3]).toBeNull();
        expect(curve.byHour[4]).not.toBeNull();
        expect(curve.byHour[5]).toBeNull();
    });

    it('ignores steps outside the training window, even of a run that overlaps it', () => {
        // The window is 03:00 only. The run's 04:00 piece is outside it and must not
        // reach hour 4's curve, which stays empty and falls back to the overall one.
        const window = { from: S, until: S + HOUR };
        const curve = curveOf([[S + 45 * MINUTE, S + 105 * MINUTE]], HOUR, window);

        expect(curve.byHour[3]).not.toBeNull();
        expect(curve.byHour[4]).toBeNull();
    });

    it('learns hours of the day separately', () => {
        // The 03:00 step's run is over at once; the 04:00 step's run (90 to 150 minutes
        // after 03:00) ends half an hour after that step does. Same week, two curves.
        const curve = curveOf([
            [S, S + HOUR],
            [S + 90 * MINUTE, S + 150 * MINUTE],
        ]);

        expect(shareAt(curve, 3, 0)).toBe(1);
        expect(shareAt(curve, 4, 0)).toBe(0);
        expect(shareAt(curve, 4, 30 * MINUTE)).toBe(1);
    });

    it('reads a 3-hour step\'s age from its own end', () => {
        // A 3-hour step at 03:00: a run from 05:00 to 07:00 has 1 hour in it and ends
        // 1 hour after the step does.
        const curve = curveOf([[S + 2 * HOUR, S + 4 * HOUR]], 3 * HOUR);
        const hour = hourOfStep(S, 3 * HOUR);

        expect(shareAt(curve, hour, 55 * MINUTE)).toBe(0);
        expect(shareAt(curve, hour, 60 * MINUTE)).toBe(1);
    });
});

describe('the curve\'s points', () => {
    it('has one every 5 minutes from age 0 to 2 hours, for each hour and for all hours', () => {
        // 25 points: 0, 5 … 120 minutes. The estimate reads the curve at a step's end age,
        // which is never 2 hours or more (a step that old is counted), so nothing longer is kept.
        const curve = curveOf([[S, S + HOUR]]);
        const points = CURVE_MAX_AGE_SECONDS / CURVE_BIN_SECONDS + 1;

        expect(points).toBe(25);
        expect(curve.overall).toHaveLength(points);
        expect(curve.byHour[3]).toHaveLength(points);
    });
});

describe('reading a share at an age', () => {
    it('interpolates between the curve\'s 5-minute points', () => {
        // The share steps from 0 to 1 across the bin that ends at 45 minutes, so halfway
        // through that bin it reads one half.
        const curve = curveOf([[S + 45 * MINUTE, S + 105 * MINUTE]]);

        expect(shareAt(curve, 3, 42.5 * MINUTE)).toBeCloseTo(0.5, 10);
        expect(CURVE_BIN_SECONDS).toBe(5 * MINUTE);
    });

    it('holds the last share past the curve\'s longest age, and the first before age 0', () => {
        const curve = curveOf([[S, S + HOUR]]);

        expect(shareAt(curve, 3, CURVE_MAX_AGE_SECONDS + HOUR)).toBe(1);
        expect(shareAt(curve, 3, -10 * MINUTE)).toBe(shareAt(curve, 3, 0));
    });

    it('uses the all-hours curve for an hour with no data', () => {
        // Hour 9 saw nothing; the curve of every hour together stands in for it. Here the
        // 03:00 piece (900 s, known at 45 minutes) and the 04:00 piece (2700 s, known at once)
        // make 75% known at once and everything at 45 minutes.
        const curve = curveOf([[S + 45 * MINUTE, S + 105 * MINUTE]]);

        expect(curve.byHour[9]).toBeNull();
        expect(shareAt(curve, 9, 0)).toBeCloseTo(0.75, 10);
        expect(shareAt(curve, 9, 45 * MINUTE)).toBeCloseTo(1, 10);
    });

    it('is no curve at all when nothing was tallied', () => {
        // A database with no history has no completeness to learn: the estimate is off,
        // rather than a made-up curve.
        expect(tallied([])).toBeNull();
    });
});

describe('estimating a total', () => {
    it('divides the partial count by the share', () => {
        expect(estimateTotal(2, 0.8)).toBeCloseTo(2.5, 10);
        expect(estimateTotal(0, 0.5)).toBe(0);
    });

    it('estimates nothing from a share of nothing', () => {
        expect(estimateTotal(2, 0)).toBeNull();
    });
});
