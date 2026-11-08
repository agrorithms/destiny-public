import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { getCompletenessCurve, getCompletenessCurves } from '@/lib/db/queries';
import { hourOfStep, shareAt } from '@/lib/db/completeness-curve';
import { resetTestDb } from '../helpers/db';
import { seedRun, type SeedRunOptions } from '../helpers/seed';
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
function seedRaid(start: number, seconds: number, extra: Partial<SeedRunOptions> = {}): void {
    seedRun({ instanceId: String(nextInstance++), period: start, activityDurationSeconds: seconds, completedBy: ['p1'], ...extra });
}

/** One run a day, on each of the six days from 2 to 7 days back, at `offset` into the day. */
function seedDaily(offset: number, seconds: number, extra: Partial<SeedRunOptions> = {}): void {
    for (let day = 2; day <= 7; day++) seedRaid(MIDNIGHT - day * DAY + offset, seconds, extra);
}

/**
 * The All Attempts curves (#204): what every test written before the Scope existed reads. Every
 * run `seedRaid` makes is a Full Clear unless told otherwise, so it is in every scope.
 */
function allCurves(options: Parameters<typeof getCompletenessCurves>[0]) {
    return getCompletenessCurves(options).allAttempts;
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
        // The estimate scales up raids only, so the curve must be learned from raids only.
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

describe('the curves of single raids (#199)', () => {
    /** One run a day for six days at `offset`, of `raidKey`. */
    function seedDailyOf(raidKey: string, offset: number, seconds: number): void {
        for (let day = 2; day <= 7; day++) seedRaid(MIDNIGHT - day * DAY + offset, seconds, { raidKey });
    }

    it('learns each asked-for raid from that raid\'s runs alone', () => {
        // Last Wish: a 60-minute run from 03:45, so hour 3 is known 45 minutes late. Vault
        // of Glass: 30 minutes at 03:00, known at once. Each curve says only what its own raid does.
        seedDailyOf('last_wish', 3 * HOUR + 45 * MINUTE, HOUR);
        seedDailyOf('vault_of_glass', 3 * HOUR, 30 * MINUTE);

        const { raids } = allCurves({ ...ONE_HOUR, raidKeys: ['last_wish', 'vault_of_glass'], minRaidRuns: 1 });

        expect(shareAt(raids.get('last_wish')!, 3, 0)).toBe(0);
        expect(shareAt(raids.get('last_wish')!, 3, 45 * MINUTE)).toBe(1);
        expect(shareAt(raids.get('vault_of_glass')!, 3, 0)).toBe(1);
    });

    it('keeps the total\'s curve what it was, learned from every raid, asked for or not', () => {
        seedDailyOf('last_wish', 3 * HOUR + 45 * MINUTE, HOUR);
        seedDailyOf('vault_of_glass', 3 * HOUR, 30 * MINUTE);
        const total = getCompletenessCurve(ONE_HOUR);

        expect(allCurves(ONE_HOUR).total).toEqual(total);
        expect(allCurves({ ...ONE_HOUR, raidKeys: ['vault_of_glass'], minRaidRuns: 1 }).total).toEqual(total);
        expect(total).not.toBeNull();
    });

    it('builds no raid curves when none are asked for', () => {
        seedDailyOf('last_wish', 3 * HOUR, HOUR);

        expect(allCurves({ ...ONE_HOUR, minRaidRuns: 1 }).raids.size).toBe(0);
    });

    it('leaves out a raid with fewer runs than the minimum, and a raid with no runs', () => {
        seedDailyOf('last_wish', 3 * HOUR, HOUR);

        const asked = ['last_wish', 'kings_fall'];

        expect([...allCurves({ ...ONE_HOUR, raidKeys: asked, minRaidRuns: 6 }).raids.keys()]).toEqual(['last_wish']);
        expect(allCurves({ ...ONE_HOUR, raidKeys: asked, minRaidRuns: 7 }).raids.size).toBe(0);
        expect(allCurves({ ...ONE_HOUR, raidKeys: asked }).raids.size).toBe(0);
    });

    it('counts only runs in the training week toward the minimum', () => {
        // Six runs, but three are in the last 24 hours (not complete, not training) and
        // one is more than 8 days old: two count.
        for (let day = 2; day <= 3; day++) seedRaid(MIDNIGHT - day * DAY + 3 * HOUR, HOUR, { raidKey: 'last_wish' });
        for (let hours = 1; hours <= 3; hours++) seedRaid(NOW - hours * 3 * HOUR, HOUR, { raidKey: 'last_wish' });
        seedRaid(NOW - 9 * DAY, HOUR, { raidKey: 'last_wish' });

        expect(allCurves({ ...ONE_HOUR, raidKeys: ['last_wish'], minRaidRuns: 2 }).raids.size).toBe(1);
        expect(allCurves({ ...ONE_HOUR, raidKeys: ['last_wish'], minRaidRuns: 3 }).raids.size).toBe(0);
    });
});

/**
 * The curves of each Scope (#204): the same pass tallies every run into each scope it belongs
 * to, so a scope's curves are learned from that scope's runs alone (ADR 0009, amendment
 * 2026-11-07). Full Clears last far longer than the average run, so a Full Clears count scaled
 * by every run's pace would be understated.
 */
describe('the curves of each scope (#204)', () => {
    const CHECKPOINT: Partial<SeedRunOptions> = { startedFromBeginning: false, completedBy: [], incompleteBy: ['p1'] };
    const FRESH: Partial<SeedRunOptions> = { completedBy: [], incompleteBy: ['p1'] };
    const FULL_CLEAR: Partial<SeedRunOptions> = {};

    it('learns each scope\'s curve from that scope\'s runs alone', () => {
        // In hour 3, every day: a Full Clear from 03:45 to 04:45, whose 15 minutes in the step
        // are known only 45 minutes after it; a Fresh Run nobody finished, 03:00-03:30; and a
        // Checkpoint Run, 03:00-03:30. Both short runs are known at once. Hour 3's share at age 0
        // is then 0 for Full Clears, 1800/2700 for Fresh Runs and 3600/4500 for All Attempts.
        seedDaily(3 * HOUR + 45 * MINUTE, HOUR, FULL_CLEAR);
        seedDaily(3 * HOUR, 30 * MINUTE, FRESH);
        seedDaily(3 * HOUR, 30 * MINUTE, CHECKPOINT);

        const curves = getCompletenessCurves(ONE_HOUR);

        expect(shareAt(curves.allAttempts.total!, 3, 0)).toBeCloseTo(0.8, 10);
        expect(shareAt(curves.freshRuns.total!, 3, 0)).toBeCloseTo(2 / 3, 10);
        expect(shareAt(curves.fullClear.total!, 3, 0)).toBe(0);
        for (const scope of ['allAttempts', 'freshRuns', 'fullClear'] as const) {
            expect(shareAt(curves[scope].total!, 3, 45 * MINUTE), scope).toBe(1);
        }
    });

    it('has no curve for a scope with no runs in the training week', () => {
        seedDaily(3 * HOUR, HOUR, CHECKPOINT);

        const curves = getCompletenessCurves(ONE_HOUR);

        expect(curves.allAttempts.total).not.toBeNull();
        expect(curves.freshRuns.total).toBeNull();
        expect(curves.fullClear.total).toBeNull();
    });

    it('learns a raid\'s curve per scope, counting only that scope\'s runs toward the minimum', () => {
        // Last Wish: 6 Full Clears, 6 unfinished Fresh Runs and 6 Checkpoint Runs, so 18 runs in
        // All Attempts, 12 in Fresh Runs and 6 in Full Clears.
        seedDaily(3 * HOUR, HOUR, { ...FULL_CLEAR, raidKey: 'last_wish' });
        seedDaily(5 * HOUR, HOUR, { ...FRESH, raidKey: 'last_wish' });
        seedDaily(7 * HOUR, HOUR, { ...CHECKPOINT, raidKey: 'last_wish' });

        const asked = { ...ONE_HOUR, raidKeys: ['last_wish'] };
        const withCurve = (minRaidRuns: number) => {
            const curves = getCompletenessCurves({ ...asked, minRaidRuns });
            return (['allAttempts', 'freshRuns', 'fullClear'] as const).filter((scope) => curves[scope].raids.has('last_wish'));
        };
        expect(withCurve(6)).toEqual(['allAttempts', 'freshRuns', 'fullClear']);
        expect(withCurve(7)).toEqual(['allAttempts', 'freshRuns']);
        expect(withCurve(12)).toEqual(['allAttempts', 'freshRuns']);
        expect(withCurve(13)).toEqual(['allAttempts']);
        expect(withCurve(18)).toEqual(['allAttempts']);
        expect(withCurve(19)).toEqual([]);
    });
});
