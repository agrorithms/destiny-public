import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { getCompletenessCurve } from '@/lib/db/queries';
import { hourOfStep, shareAt } from '@/lib/db/completeness-curve';
import { resetTestDb } from '../helpers/db';
import { seedRun } from '../helpers/seed';
import { NON_RAID_HASH } from '../helpers/pgcr-builder';

/**
 * The completeness curve (#196) read from real PGCRs. The arithmetic is tested on its own in
 * src/lib/db/completeness-curve.test.ts; these tests prove the *query* feeds it the right
 * rows: raids only, by `ended_at`, from the week that ended 24 hours ago, at the range's own
 * step size. The history is a run every day for six days, placed so the shares are worked
 * out by hand.
 *
 * "Now" is pinned to a whole hour shortly in the past, as in raids-in-progress.test.ts.
 */
const MINUTE = 60;
const HOUR = 3600;
const DAY = 24 * HOUR;
const NOW = Math.floor(Date.now() / 1000 / HOUR) * HOUR - HOUR;
const MIDNIGHT = Math.floor(NOW / DAY) * DAY;
const ONE_HOUR = { now: NOW, stepSeconds: HOUR };

let nextInstance = 1;
function seedRaid(start: number, seconds: number, extra: { activityHash?: number } = {}): void {
    seedRun({ instanceId: String(nextInstance++), period: start, activityDurationSeconds: seconds, completedBy: ['p1'], ...extra });
}

/** One run a day, on each of the six days from 2 to 7 days back, at `offset` into the day. */
function seedDaily(offset: number, seconds: number): void {
    for (let day = 2; day <= 7; day++) seedRaid(MIDNIGHT - day * DAY + offset, seconds);
}

/** The curve, which must exist. */
function learn(options = ONE_HOUR) {
    const curve = getCompletenessCurve(options);
    if (curve === null) throw new Error('expected a curve');
    return curve;
}

beforeEach(() => {
    resetTestDb();
});

describe('learning the curve from PGCRs', () => {
    it('reads each hour of the day from the runs that overlapped it', () => {
        // A 60-minute run starting at 03:45 every day: 15 minutes in the 03:00 step, which
        // outlasts the step by 45 minutes, and 45 minutes in the 04:00 step, over by its
        // end. So 03:00's raid time is known only 45 minutes late; 04:00's at once.
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR);

        const curve = learn();

        expect(shareAt(curve, 3, 40 * MINUTE)).toBe(0);
        expect(shareAt(curve, 3, 45 * MINUTE)).toBe(1);
        expect(shareAt(curve, 4, 0)).toBe(1);
    });

    it('gives an hour whose runs differ its own curve', () => {
        // The same week also has a 30-minute run at 10:00 every day: over inside its step,
        // known at once. 10:00 and 03:00 have different curves, and an hour with no runs
        // (hour 20) falls back to the overall one.
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR);
        seedDaily(10 * HOUR, 30 * MINUTE);

        const curve = learn();

        expect(shareAt(curve, 10, 0)).toBe(1);
        expect(shareAt(curve, 3, 0)).toBe(0);
        expect(curve.byHour[20]).toBeNull();
        // 6 x 1800 s known at once in hour 10, 6 x 2700 s in hour 4, 6 x 900 s late in hour 3.
        expect(shareAt(curve, 20, 0)).toBeCloseTo((1800 + 2700) / (1800 + 2700 + 900), 10);
    });

    it('is no curve for a database with no raids in the training week', () => {
        // Nothing to learn from: the estimate must switch itself off rather than invent one.
        seedRaid(MIDNIGHT - 30 * DAY, HOUR, { activityHash: NON_RAID_HASH });

        expect(getCompletenessCurve(ONE_HOUR)).toBeNull();
    });
});

describe('which runs it learns from', () => {
    it('learns only from steps between 8 days and 24 hours old', () => {
        // Runs in the last 24 hours (not yet complete) and before the week (too old to be
        // this week's) must not move the curve, even with a long tail that would. The recent
        // one has already ended, so only the 24-hour bound keeps it out, not `ended_at <= now`.
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR);
        const before = learn();

        seedRaid(NOW - 20 * HOUR, 10 * HOUR);
        seedRaid(NOW - 8 * DAY - 6 * HOUR, 5 * HOUR);

        expect(learn()).toEqual(before);
    });

    it('does not learn from a PGCR that is not a raid', () => {
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR);
        const before = learn();

        seedRaid(MIDNIGHT - 3 * DAY + 3 * HOUR, 5 * HOUR, { activityHash: NON_RAID_HASH });

        expect(learn()).toEqual(before);
    });

    it('does not learn from a run that has not ended by "now"', () => {
        // A run recorded with an end after "now" cannot have been reported yet. (The writer
        // would not store one this far ahead; this is a row from a replay at an earlier now.)
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR);
        const before = learn();
        seedRaid(MIDNIGHT - 3 * DAY, HOUR);
        getDb().prepare('UPDATE pgcrs SET ended_at = ? WHERE instance_id = ?').run(NOW + HOUR, String(nextInstance - 1));

        expect(learn()).toEqual(before);
    });

    it('learns when runs ended, not when the scanner fetched them', () => {
        // The scanner's fetch lag is operational, not a property of raids: a week it ran
        // hours behind must not teach the curve that raids end late.
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR);
        const before = learn();

        getDb().prepare('UPDATE pgcrs SET fetched_at = fetched_at + ?').run(6 * HOUR);

        expect(learn()).toEqual(before);
    });
});

describe('each step size', () => {
    it('learns 10-minute steps for the 24-hour range', () => {
        // A 15-minute run from 03:55: 5 minutes in the 03:50 step, which it outlasts by 10
        // minutes; 10 in the 04:00 step, over by its end.
        seedDaily(3 * HOUR + 55 * MINUTE, 15 * MINUTE);

        const curve = learn({ now: NOW, stepSeconds: 10 * MINUTE });

        expect(shareAt(curve, 3, 5 * MINUTE)).toBe(0);
        expect(shareAt(curve, 3, 10 * MINUTE)).toBe(1);
        expect(shareAt(curve, 4, 0)).toBe(1);
    });

    it('learns 3-hour steps for the 30-day range, named by their midpoint hour', () => {
        // 05:00 to 07:00: an hour in the 03:00-06:00 step, over an hour after it; an hour
        // in the 06:00-09:00 step, over inside it. Those steps are hours 4 and 7 of the day.
        seedDaily(5 * HOUR, 2 * HOUR);

        const curve = learn({ now: NOW, stepSeconds: 3 * HOUR });

        expect(hourOfStep(MIDNIGHT + 3 * HOUR, 3 * HOUR)).toBe(4);
        expect(shareAt(curve, 4, 55 * MINUTE)).toBe(0);
        expect(shareAt(curve, 4, HOUR)).toBe(1);
        expect(shareAt(curve, 7, 0)).toBe(1);
    });
});
