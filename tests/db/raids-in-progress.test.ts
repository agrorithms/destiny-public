import { beforeEach, describe, expect, it } from 'vitest';
import {
    DATA_START_MARGIN_SECONDS,
    deleteExpiredPGCRBatch,
    getRaidsInProgress,
    type RaidsInProgressSeries,
} from '@/lib/db/queries';
import { resetTestDb } from '../helpers/db';
import { getDb } from '@/lib/db';
import { seedRun, type SeedRunOptions } from '../helpers/seed';
import { NON_RAID_HASH } from '../helpers/pgcr-builder';

/**
 * Raids in Progress (#194): how many raid instances were under way during each step of
 * the Raid Activity chart, rebuilt from PGCRs. Each point is a step average — the raid
 * time overlapping the step, divided by the step's length — so these tests pin numbers a
 * reader would see on the chart, because a wrong-but-plausible activity line is the
 * failure nobody would report.
 *
 * "Now" is pinned to a whole hour shortly in the past rather than read from the clock,
 * so step boundaries fall on known instants. It stays in the past because the PGCR
 * writer drops an `ended_at` too far in the future (FUTURE_ENDED_SKEW_SECONDS), and a
 * seeded run must look like one production could store.
 */
const HOUR = 3600;
const NOW = Math.floor(Date.now() / 1000 / HOUR) * HOUR - HOUR;
const SEVEN_DAYS = { rangeSeconds: 7 * 24 * HOUR, stepSeconds: HOUR, now: NOW };

/** The instant `hours` before NOW. Whole numbers land on a step boundary. */
function hoursBeforeNow(hours: number): number {
    return NOW - hours * HOUR;
}

/** The value of the step starting at `start`, or undefined when the series has no such step. */
function valueAt(series: RaidsInProgressSeries, start: number): number | undefined {
    return series.points.find((point) => point.start === start)?.total;
}

/** The series' counted steps: the Provisional ones are #196's, and these tests are about the count. */
function countedPoints(series: RaidsInProgressSeries) {
    return series.points.filter((point) => !point.provisional);
}

let nextInstance = 1;
/** A raid run from `start` lasting `seconds`; every other field is seedRun's default. */
function seedRaid(start: number, seconds: number, extra: Partial<SeedRunOptions> = {}): void {
    seedRun({ instanceId: String(nextInstance++), period: start, activityDurationSeconds: seconds, completedBy: ['p1'], ...extra });
}

/**
 * A report long before any window, so the stored history reaches back further than every
 * range and no test below is clamped by where the data starts — except the ones about
 * exactly that, which reset it away. Not a raid, so it adds nothing to any step.
 */
function seedHistoryReachingBack(): void {
    seedRaid(NOW - 60 * 24 * HOUR, HOUR, { activityHash: NON_RAID_HASH });
}

beforeEach(() => {
    resetTestDb();
    seedHistoryReachingBack();
});

describe('step averaging', () => {
    it('counts a run covering a whole step as 1 in that step and 0 either side', () => {
        // The unit of the chart: one instance under way for the whole hour is one raid
        // in progress. The neighbours prove it is not smeared into the steps beside it.
        seedRaid(hoursBeforeNow(10), HOUR);

        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(valueAt(series, hoursBeforeNow(10))).toBe(1);
        expect(valueAt(series, hoursBeforeNow(11))).toBe(0);
        expect(valueAt(series, hoursBeforeNow(9))).toBe(0);
    });

    it('counts a run covering half a step as 0.5', () => {
        // The point is an average over the hour, not "was anything running": half an hour
        // of one raid is half a raid in progress, wherever in the step it falls.
        seedRaid(hoursBeforeNow(10) + 15 * 60, HOUR / 2);

        expect(valueAt(getRaidsInProgress(SEVEN_DAYS), hoursBeforeNow(10))).toBe(0.5);
    });

    it('counts two overlapping runs as 2', () => {
        // Two instances under way at once are two raids in progress: the sum, not a
        // yes/no per step.
        seedRaid(hoursBeforeNow(10), HOUR);
        seedRaid(hoursBeforeNow(10), HOUR);

        expect(valueAt(getRaidsInProgress(SEVEN_DAYS), hoursBeforeNow(10))).toBe(2);
    });

    it('splits a run across every step it overlaps, whole steps included', () => {
        // 30 minutes into one step, three whole steps, then 15 minutes into the next:
        // a long run must reach every hour it spans, not only the ones it starts and ends in.
        seedRaid(hoursBeforeNow(10) + 30 * 60, 30 * 60 + 3 * HOUR + 15 * 60);

        const series = getRaidsInProgress(SEVEN_DAYS);

        expect([10, 9, 8, 7, 6, 5].map((hours) => valueAt(series, hoursBeforeNow(hours))))
            .toEqual([0.5, 1, 1, 1, 0.25, 0]);
    });

    it('counts only the part of a run inside the window', () => {
        // A run that began before the chart's first step was still in progress during it,
        // so it counts there — but only its overlap, and nothing lands before the window.
        const firstStep = NOW - 7 * 24 * HOUR;
        seedRaid(firstStep - HOUR, HOUR + 30 * 60);

        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(series.points[0]).toEqual({ start: firstStep, end: firstStep + HOUR, total: 0.5, provisional: false });
    });
});

describe('which runs count', () => {
    it('counts Checkpoint Runs and runs nobody finished', () => {
        // Every raid instance counts (All Attempts): checkpoint farms are the activity the
        // site is named for, and a run abandoned partway was still in progress.
        seedRaid(hoursBeforeNow(10), HOUR, { startedFromBeginning: false });
        seedRaid(hoursBeforeNow(10), HOUR, { completedBy: [], incompleteBy: ['p2'] });

        expect(valueAt(getRaidsInProgress(SEVEN_DAYS), hoursBeforeNow(10))).toBe(2);
    });

    it('does not count a PGCR that is not a raid', () => {
        // The chart is Raids in Progress. An activity whose hash is in no raid definition
        // is stored with no raid key and must not lift the line.
        seedRaid(hoursBeforeNow(10), HOUR, { activityHash: NON_RAID_HASH });

        expect(valueAt(getRaidsInProgress(SEVEN_DAYS), hoursBeforeNow(10))).toBe(0);
    });
});

describe('which steps come back', () => {
    it('does not read a counted run that has not ended by "now"', () => {
        // The series says what had ended as of `now`. A report whose end lies after it was
        // not a raid already ended then, even where it overlaps a long-counted step. (The
        // writer would not store one this far ahead; this is a row seen from an earlier now.)
        seedRaid(hoursBeforeNow(10), HOUR);
        getDb().prepare('UPDATE pgcrs SET ended_at = ? WHERE instance_id = ?').run(NOW + HOUR, String(nextInstance - 1));

        expect(valueAt(getRaidsInProgress(SEVEN_DAYS), hoursBeforeNow(10))).toBe(0);
    });

    it('returns hourly steps over the last 7 days, ending at the last step 2 hours old', () => {
        // With NOW on the hour, the window's steps run from exactly 7 days back to the step
        // ending 2 hours ago: 166 of the range's 168 hours. The newer two are absent, not
        // zero — a raid still running there has no PGCR yet, so a zero would be a lie.
        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(series.points).toHaveLength(166);
        expect(series.points[0].start).toBe(NOW - 7 * 24 * HOUR);
        expect(series.points.at(-1)?.end).toBe(hoursBeforeNow(2));
        expect(series).toMatchObject({ from: NOW - 7 * 24 * HOUR, to: NOW, countedUntil: hoursBeforeNow(2), stepSeconds: HOUR });
    });

    it('leaves out a step that ends less than 2 hours ago, even with runs in it', () => {
        // The step ending 1.5 hours before a half-past "now" is not old enough to count, so
        // it is absent even though a finished run sits inside it.
        const now = NOW + HOUR / 2;
        seedRaid(hoursBeforeNow(2), HOUR);
        seedRaid(hoursBeforeNow(3), HOUR);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now });

        expect(series.points.at(-1)).toEqual({ start: hoursBeforeNow(3), end: hoursBeforeNow(2), total: 1, provisional: false });
    });

    it('reports counting as ending where the last counted step ends, not at "now" minus 2 hours', () => {
        // At 59 minutes past, the moment 2 hours ago is 0:59 into a step that is not yet
        // whole, so the last counted step ends 2 h 59 min before "now". The chart shades
        // from `countedUntil`: reported as "now" minus 2 hours, it would leave the 59
        // minutes between the line's end and the shade with neither, and #196's Provisional
        // estimate fills from exactly this boundary.
        const now = NOW + 59 * 60;

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now });

        expect(series.points.at(-1)?.end).toBe(hoursBeforeNow(2));
        expect(series.countedUntil).toBe(hoursBeforeNow(2));
    });

    it('starts at the first whole step inside the window when "now" is mid-step', () => {
        // Steps sit on the clock's hours, so a half-past "now" puts the window's left edge
        // mid-hour and the first point at the next hour — never a step reaching outside it.
        const now = NOW + HOUR / 2;

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now });

        expect(series.from).toBe(now - 7 * 24 * HOUR);
        expect(series.points[0].start).toBe(NOW - 7 * 24 * HOUR + HOUR);
    });
});

const MINUTE = 60;
const DAY = 24 * HOUR;

/** NOW's 3-hour cousin: a whole 3-hour step in the past, so the 30-day grid lines up with it. */
const NOW_3H = Math.floor(Date.now() / 1000 / (3 * HOUR)) * 3 * HOUR - 3 * HOUR;
const TWENTY_FOUR_HOURS = { rangeSeconds: DAY, stepSeconds: 10 * MINUTE, now: NOW };
const THIRTY_DAYS = { rangeSeconds: 30 * DAY, stepSeconds: 3 * HOUR, now: NOW_3H };

describe('each range', () => {
    it('returns 10-minute steps over the last 24 hours, the newest two hours aside', () => {
        // #195's 24h preset: 144 ten-minute steps fit the window, and the 12 ending in the
        // last two hours are not counted yet, so 132 come back.
        const series = getRaidsInProgress(TWENTY_FOUR_HOURS);

        expect(series.stepSeconds).toBe(10 * MINUTE);
        expect(series.points).toHaveLength(132);
        expect(series.points[0].start).toBe(NOW - DAY);
        expect(series.points[1].start).toBe(NOW - DAY + 10 * MINUTE);
        expect(series.points.at(-1)?.end).toBe(hoursBeforeNow(2));
    });

    it('returns 3-hour steps over the last 30 days, the newest whole step 2 hours old last', () => {
        // #195's 30d preset: 240 three-hour steps fit the window. With "now" on a 3-hour
        // boundary the step ending 2 hours ago is not whole yet, so counting ends 3 hours
        // back and 239 come back.
        const series = getRaidsInProgress(THIRTY_DAYS);

        expect(series.stepSeconds).toBe(3 * HOUR);
        expect(series.points).toHaveLength(239);
        expect(series.points[0].start).toBe(NOW_3H - 30 * DAY);
        expect(series.points[1].start).toBe(NOW_3H - 30 * DAY + 3 * HOUR);
        expect(series.countedUntil).toBe(NOW_3H - 3 * HOUR);
    });

    it('splits a run across a 10-minute boundary by its overlap with each step', () => {
        // Four minutes before a boundary and six after: 0.4 of one step and 0.6 of the next.
        const boundary = hoursBeforeNow(10);
        seedRaid(boundary - 4 * MINUTE, 10 * MINUTE);

        const series = getRaidsInProgress(TWENTY_FOUR_HOURS);

        expect(valueAt(series, boundary - 10 * MINUTE)).toBeCloseTo(0.4, 10);
        expect(valueAt(series, boundary)).toBeCloseTo(0.6, 10);
    });

    it('splits a run across a 3-hour boundary by its overlap with each step', () => {
        // An hour either side of a boundary: a third of each 3-hour step.
        const boundary = NOW_3H - 4 * DAY;
        seedRaid(boundary - HOUR, 2 * HOUR);

        const series = getRaidsInProgress(THIRTY_DAYS);

        expect(valueAt(series, boundary - 3 * HOUR)).toBeCloseTo(1 / 3, 10);
        expect(valueAt(series, boundary)).toBeCloseTo(1 / 3, 10);
    });
});

describe('where the data starts', () => {
    beforeEach(() => {
        // These tests are about the oldest stored report, so they choose it themselves.
        resetTestDb();
    });

    it('never under-counts the 30-day window\'s first step after cleanup removed older runs', () => {
        // Prod keeps PGCRs for 720 hours — the 30-day window exactly — and cleanup deletes by
        // *start*. A run that started before the window and ended inside it is gone, so the
        // window's first hours read low. Here a run starts every 3 hours and lasts 6, so 2
        // are in progress at every moment, and the real cleanup removes everything started
        // before the window. The first step drawn must still read 2: it starts the margin
        // after the oldest report left, by when every run in it is one that was kept.
        const from = NOW_3H - 30 * DAY;
        for (let start = from - 12 * HOUR; start <= from + 15 * HOUR; start += 3 * HOUR) {
            seedRaid(start, 6 * HOUR);
        }
        expect(deleteExpiredPGCRBatch(from, 1000).pgcrsDeleted).toBe(4);

        const series = getRaidsInProgress(THIRTY_DAYS);

        expect(DATA_START_MARGIN_SECONDS).toBe(6 * HOUR);
        expect(series.from).toBe(from);
        expect(series.countedFrom).toBe(from + 6 * HOUR);
        expect(series.points[0].start).toBe(from + 6 * HOUR);
        expect(series.points.slice(0, 2).map((point) => point.total)).toEqual([2, 2]);
    });

    it('does not clamp a window whose data reaches back the margin before it', () => {
        // The oldest report exactly 6 hours before the window: every run in its first step
        // could still be stored, so the window starts where it always does.
        seedRaid(NOW - 7 * DAY - 6 * HOUR, HOUR);

        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(series.countedFrom).toBe(NOW - 7 * DAY);
        expect(countedPoints(series)).toHaveLength(166);
    });

    it('starts at the first whole step the margin after the oldest report', () => {
        // The oldest report 5.5 hours before the window: the margin ends half an hour into
        // the window, so the first step is the next whole hour, and nothing before it is
        // returned.
        seedRaid(NOW - 7 * DAY - 5.5 * HOUR, HOUR);

        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(series.countedFrom).toBe(NOW - 7 * DAY + HOUR);
        expect(series.points[0].start).toBe(NOW - 7 * DAY + HOUR);
        expect(countedPoints(series)).toHaveLength(165);
    });

    it('reads the data start from any report, not only raids', () => {
        // Cleanup deletes every PGCR by age, raid or not, so the oldest of any kind marks
        // how far back the stored history goes.
        seedRaid(NOW - 3 * DAY, HOUR, { activityHash: NON_RAID_HASH });

        expect(getRaidsInProgress(SEVEN_DAYS).countedFrom).toBe(NOW - 3 * DAY + 6 * HOUR);
    });

    it('returns no steps, and keeps where counting ends, when the data starts too recently', () => {
        // A database whose oldest report is an hour old has nothing it can count yet. The
        // counted boundary still sits 2 hours back on the step grid, where #196's estimate
        // starts, rather than moving to meet the data.
        seedRaid(hoursBeforeNow(1), 30 * MINUTE);

        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(series.points).toEqual([]);
        expect(series.countedUntil).toBe(hoursBeforeNow(2));
        expect(series.countedFrom).toBe(hoursBeforeNow(2));
    });

    it('does not clamp an empty database', () => {
        // Nothing stored says nothing about where history starts: the window is drawn whole,
        // at zero, as #194 drew it.
        const series = getRaidsInProgress(SEVEN_DAYS);

        expect(series.countedFrom).toBe(NOW - 7 * DAY);
        expect(series.points).toHaveLength(166);
        expect(series.points.every((point) => point.total === 0)).toBe(true);
    });
});

/**
 * The Provisional estimate (#196). A step less than 2 hours old is not counted but
 * estimated: the raid time already reported, divided by the share of a step's raid time
 * that is usually reported by then (./completeness-curve.ts), learned for that hour of the
 * day from the week before. The history below makes the shares come out by hand.
 *
 * "Now" here is 11:30 UTC on a day 20 days back, so the steps the estimate covers fall in
 * known hours of the day (9 and 10) and every run is long over. Each day of the training
 * week (2 to 7 days before) holds three runs, all hour-aligned:
 *
 * - 09:00-10:00: the whole 09:00 step, reported at once; hour 9's share is 1 at every age.
 * - 10:00-11:00 and 10:45-11:45: 3600 s in the 10:00 step reported at once, and 900 s of
 *   it only 45 minutes after the step ends. Of 4500 s, hour 10's share is 0.8 until then.
 */
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - 20 * DAY;
const HALF_PAST_ELEVEN = MIDNIGHT + 11 * HOUR + 30 * MINUTE;

/** Seconds past the test day's midnight at `hour:minute`. */
function clock(hour: number, minute = 0): number {
    return MIDNIGHT + hour * HOUR + minute * MINUTE;
}

/** The daily runs described above, as `[hour, minute, seconds]` triples. */
function seedTrainingWeek(runs: Array<[number, number, number]>): void {
    for (let day = 2; day <= 7; day++) {
        for (const [hour, minute, seconds] of runs) seedRaid(clock(hour, minute) - day * DAY, seconds);
    }
}

const STANDARD_WEEK: Array<[number, number, number]> = [
    [9, 0, HOUR],
    [10, 0, HOUR],
    [10, 45, HOUR],
];

function provisionalAt(series: RaidsInProgressSeries, start: number) {
    return series.points.find((point) => point.start === start && point.provisional);
}

describe('the Provisional estimate', () => {
    it('runs from where counting ends down to the last step 15 minutes old, flagging each point', () => {
        // At 11:30 the last step 2 hours old ends at 09:00 (counted), the steps ending at
        // 10:00 and 11:00 are 90 and 30 minutes old (estimated), and the one in progress
        // is absent. Every point says which it is.
        seedTrainingWeek(STANDARD_WEEK);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        const tail = series.points.slice(-3);
        expect(tail.map((point) => [point.end, point.provisional])).toEqual([
            [clock(9), false],
            [clock(10), true],
            [clock(11), true],
        ]);
        expect(series.points.filter((point) => point.provisional)).toHaveLength(2);
        expect(series.countedUntil).toBe(clock(9));
        expect(series.provisionalUntil).toBe(clock(11));
    });

    it('estimates a step as its reported raid time over the share reported by then', () => {
        // 09:00 holds half an hour of one raid, reported at once; its hour's share is 1, so
        // the estimate is the count. 10:00 holds the same half hour, but hour 10 reports only
        // 80% of its time by 30 minutes after the step: 0.5 / 0.8.
        seedTrainingWeek(STANDARD_WEEK);
        seedRaid(clock(9), 30 * MINUTE);
        seedRaid(clock(10), 30 * MINUTE);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(provisionalAt(series, clock(9))?.total).toBeCloseTo(0.5, 10);
        expect(provisionalAt(series, clock(10))?.total).toBeCloseTo(0.625, 10);
    });

    it('gives each hour of the day its own estimate from the same partial count', () => {
        // Same raid time reported in two steps, each read 30 minutes after it ends (09:00 at
        // 10:30, 10:00 at 11:30), and two different answers, because the hours' runs differ:
        // hour 9's share is 1 and hour 10's is 0.8. Divided by one curve for every hour, the
        // same partial count at the same age would give the same estimate. (The training week
        // is the same at both nows: both bounds move by an hour and no run is near either.)
        seedTrainingWeek(STANDARD_WEEK);
        seedRaid(clock(9), 30 * MINUTE);
        seedRaid(clock(10), 30 * MINUTE);

        const ninth = provisionalAt(getRaidsInProgress({ ...SEVEN_DAYS, now: clock(10, 30) }), clock(9))?.total;
        const tenth = provisionalAt(getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN }), clock(10))?.total;

        expect(ninth).toBeCloseTo(0.5, 10);
        expect(tenth).toBeCloseTo(0.625, 10);
    });

    it('counts a run still going at the 15-minute cutoff only up to the cutoff', () => {
        // 10:50 to 11:20 has ended by 11:30, but only its 10 minutes inside the 10:00 step
        // are in that step; its 20 minutes in 11:00 belong to a step too recent to draw.
        seedTrainingWeek(STANDARD_WEEK);
        seedRaid(clock(10, 50), 30 * MINUTE);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(provisionalAt(series, clock(10))?.total).toBeCloseTo(10 / 60 / 0.8, 10);
    });

    it('does not read a run that has not ended by "now"', () => {
        // A report ending after "now" is not a raid already ended. (The writer would not
        // store one this far ahead; this is a row seen from an earlier now.)
        seedTrainingWeek(STANDARD_WEEK);
        seedRaid(clock(10), HOUR);
        getDb().prepare('UPDATE pgcrs SET ended_at = ? WHERE instance_id = ?').run(HALF_PAST_ELEVEN + HOUR, String(nextInstance - 1));

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(provisionalAt(series, clock(10))?.total).toBe(0);
    });

    it('returns nothing for a step less than 15 minutes old, and the step at exactly 15', () => {
        // The step ending at 11:00 is 14 minutes 59 seconds old at 11:14:59 and 15 minutes
        // old at 11:15:00.
        seedTrainingWeek(STANDARD_WEEK);

        const early = getRaidsInProgress({ ...SEVEN_DAYS, now: clock(11, 15) - 1 });
        const exact = getRaidsInProgress({ ...SEVEN_DAYS, now: clock(11, 15) });

        expect(early.points.at(-1)?.end).toBe(clock(10));
        expect(exact.points.at(-1)?.end).toBe(clock(11));
        expect(exact.provisionalUntil).toBe(clock(11));
    });

    it('counts a step that is exactly 2 hours old and estimates one a second younger', () => {
        // The step ending at 10:00: counted at 12:00:00, still an estimate at 11:59:59.
        seedTrainingWeek(STANDARD_WEEK);

        const counted = getRaidsInProgress({ ...SEVEN_DAYS, now: clock(12) });
        const estimated = getRaidsInProgress({ ...SEVEN_DAYS, now: clock(12) - 1 });

        expect(counted.points.find((point) => point.end === clock(10))?.provisional).toBe(false);
        expect(estimated.points.find((point) => point.end === clock(10))?.provisional).toBe(true);
    });

    it('applies the same cutoffs at every step size', () => {
        // At 12:45 the counted boundary and the 15-minute cutoff fall on each grid: 10:40 to
        // 12:30 in 10-minute steps (11 estimates), 10:00 to 12:00 in hours (2), 09:00 to
        // 12:00 in 3-hour steps (1). No estimated step is under 15 minutes or 2 hours old.
        seedTrainingWeek(STANDARD_WEEK);
        const now = clock(12, 45);
        const cases = [
            { rangeSeconds: DAY, stepSeconds: 10 * MINUTE, counted: clock(10, 40), until: clock(12, 30), estimates: 11 },
            { rangeSeconds: 7 * DAY, stepSeconds: HOUR, counted: clock(10), until: clock(12), estimates: 2 },
            { rangeSeconds: 30 * DAY, stepSeconds: 3 * HOUR, counted: clock(9), until: clock(12), estimates: 1 },
        ];

        for (const { rangeSeconds, stepSeconds, counted, until, estimates } of cases) {
            const series = getRaidsInProgress({ rangeSeconds, stepSeconds, now });
            const estimated = series.points.filter((point) => point.provisional);

            expect(series.countedUntil, `${stepSeconds}s counted boundary`).toBe(counted);
            expect(series.provisionalUntil, `${stepSeconds}s cutoff`).toBe(until);
            expect(estimated, `${stepSeconds}s estimates`).toHaveLength(estimates);
            expect(estimated[0].start, `${stepSeconds}s first estimate`).toBe(counted);
            expect(estimated.at(-1)?.end, `${stepSeconds}s last estimate`).toBe(until);
            expect(series.points.filter((point) => !point.provisional).at(-1)?.end).toBe(counted);
        }
    });

    it('estimates nothing for a step whose hour reports none of its time by then', () => {
        // Every training run is the late one, so hour 10 reports nothing by 30 minutes: no
        // share to divide by. Its step is left out rather than drawn at infinity, and the
        // line ends where the last estimate does.
        seedTrainingWeek([[10, 45, HOUR]]);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(series.points.at(-1)?.end).toBe(clock(10));
        expect(series.points.at(-1)?.provisional).toBe(true);
        expect(series.provisionalUntil).toBe(clock(10));
    });

    it('ends the estimate at the first step with no share, rather than skipping over it', () => {
        // Shares are per hour of the day, so a middle step can have none while a later one
        // has some. Here every training run from 09:00 lasts until 11:45, 105 minutes past
        // the 09:00 step's end: hour 9 reports nothing by 90 minutes. Hour 10 reports a
        // third of its time by 30 minutes (a 10:00-10:30 run). At 11:30 the 09:00 step has
        // no estimate, so the 10:00 step after it is not drawn either: the dashed line is
        // one unbroken run, and the shade starts where it stops.
        seedTrainingWeek([
            [9, 0, 165 * MINUTE],
            [10, 0, 30 * MINUTE],
        ]);
        seedRaid(clock(10), 30 * MINUTE);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(series.points.some((point) => point.provisional)).toBe(false);
        expect(series.points.at(-1)?.end).toBe(clock(9));
        expect(series.provisionalUntil).toBe(clock(9));
    });

    it('estimates nothing when there is no history to learn from', () => {
        // An empty week has no curve. The series is the counted one, ending where it did
        // before #196, and the cutoff sits at the counted boundary.
        seedRaid(clock(10), HOUR);

        const series = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(series.points.some((point) => point.provisional)).toBe(false);
        expect(series.points.at(-1)?.end).toBe(clock(9));
        expect(series.provisionalUntil).toBe(series.countedUntil);
    });

    it('leaves counted values as they were', () => {
        // Adding the estimate must not move a counted step: a run in a counted hour reads
        // the same whether or not there is a curve.
        seedRaid(clock(7), 30 * MINUTE);
        const without = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });
        seedTrainingWeek(STANDARD_WEEK);
        const withCurve = getRaidsInProgress({ ...SEVEN_DAYS, now: HALF_PAST_ELEVEN });

        expect(valueAt(without, clock(7))).toBe(0.5);
        expect(valueAt(withCurve, clock(7))).toBe(0.5);
    });
});

describe('the per-raid split (#198)', () => {
    const ALL = ['last_wish', 'vault_of_glass', 'salvations_edge'];

    it('splits each step between the raids that ran in it, and the parts add up to the total', () => {
        // Three raids overlapping at different depths, so a split that credited every run to
        // one raid, or lost a partial step, would disagree with the literals below.
        seedRaid(hoursBeforeNow(10), HOUR, { raidKey: 'last_wish' });
        seedRaid(hoursBeforeNow(10) + 15 * 60, HOUR / 2, { raidKey: 'vault_of_glass' });
        seedRaid(hoursBeforeNow(10), 2 * HOUR, { raidKey: 'vault_of_glass' });
        seedRaid(hoursBeforeNow(9), HOUR / 4, { raidKey: 'salvations_edge' });

        const series = getRaidsInProgress({ ...SEVEN_DAYS, raidKeys: ALL });

        const at = (hours: number) => series.points.find((point) => point.start === hoursBeforeNow(hours))!;
        expect(at(10).raids).toEqual({ last_wish: 1, vault_of_glass: 1.5, salvations_edge: 0 });
        expect(at(9).raids).toEqual({ last_wish: 0, vault_of_glass: 1, salvations_edge: 0.25 });
        expect(at(8).raids).toEqual({ last_wish: 0, vault_of_glass: 0, salvations_edge: 0 });
        for (const point of countedPoints(series)) {
            const sum = Object.values(point.raids!).reduce((a, b) => a + b, 0);
            expect(sum, `step at ${point.start}`).toBeCloseTo(point.total, 9);
        }
    });

    it('returns exactly the raids asked for, a raid that never ran as 0, and none when none are asked for', () => {
        seedRaid(hoursBeforeNow(10), HOUR, { raidKey: 'last_wish' });
        seedRaid(hoursBeforeNow(10), HOUR, { raidKey: 'vault_of_glass' });

        const asked = getRaidsInProgress({ ...SEVEN_DAYS, raidKeys: ['vault_of_glass', 'kings_fall'] });
        const none = getRaidsInProgress(SEVEN_DAYS);

        const step = asked.points.find((point) => point.start === hoursBeforeNow(10))!;
        expect(step.raids).toEqual({ vault_of_glass: 1, kings_fall: 0 });
        expect(step.total, 'the total still counts the raid not asked for').toBe(2);
        expect(none.points.every((point) => point.raids === undefined)).toBe(true);
    });

    it('carries per-raid values on a Provisional step only for the raids with an estimate, and none when none are asked for', () => {
        // A week of a raid to learn a curve from, so the newest steps are estimated. Asked
        // with a minimum of one run, the raid has an estimate; asked for nothing, no point
        // carries per-raid values at all, estimated or not.
        for (let day = 2; day <= 7; day++) seedRaid(hoursBeforeNow(day * 24 + 3), HOUR, { raidKey: 'last_wish' });
        seedRaid(hoursBeforeNow(1), HOUR / 2, { raidKey: 'last_wish' });

        const asked = getRaidsInProgress({ ...SEVEN_DAYS, raidKeys: ALL, minRaidRuns: 1 });
        const none = getRaidsInProgress(SEVEN_DAYS);

        const estimated = asked.points.filter((point) => point.provisional);
        expect(estimated.length, 'the fixture has an estimated step').toBeGreaterThan(0);
        expect(estimated.every((point) => Object.keys(point.raids ?? {}).join() === 'last_wish')).toBe(true);
        expect(countedPoints(asked).every((point) => point.raids !== undefined)).toBe(true);
        expect(none.points.every((point) => point.raids === undefined)).toBe(true);
    });
});

/**
 * The per-raid Provisional estimate (#199): each raid's estimate scales its own partial count
 * by its own completeness curve, learned from that raid's runs alone. Same clock and shape as
 * the total's tests above: "now" is 11:30, so the estimated steps are 09:00 (90 minutes old)
 * and 10:00 (30 minutes old), and every raid has the training week's daily runs.
 *
 * The raids' runs differ in length so their curves differ:
 *
 * - `last_wish`: 10:00-11:00, a whole step reported at once. Hour 10's share is 1.
 * - `vault_of_glass`: 10:00-11:00 and 10:45-11:45. Of 4500 s in hour 10, 900 s are reported
 *   only 45 minutes after the step, so hour 10's share is 0.8 until then.
 */
describe('the per-raid Provisional estimate (#199)', () => {
    const NOW_11_30 = { ...SEVEN_DAYS, now: HALF_PAST_ELEVEN };
    const ASKED = ['last_wish', 'vault_of_glass', 'kings_fall'];

    /** The training week's daily runs for one raid, as `[hour, minute, seconds]` triples. */
    function seedWeekOf(raidKey: string, runs: Array<[number, number, number]>): void {
        for (let day = 2; day <= 7; day++) {
            for (const [hour, minute, seconds] of runs) seedRaid(clock(hour, minute) - day * DAY, seconds, { raidKey });
        }
    }

    /** The two raids' training weeks described above, whose hour-10 shares are 1 and 0.8. */
    function seedTwoCurves(): void {
        seedWeekOf('last_wish', [[10, 0, HOUR]]);
        seedWeekOf('vault_of_glass', [[10, 0, HOUR], [10, 45, HOUR]]);
    }

    function raidsAt(series: RaidsInProgressSeries, start: number) {
        return provisionalAt(series, start)?.raids;
    }

    it('scales each raid by its own curve, so raids with different run lengths differ as theirs predict', () => {
        seedTwoCurves();
        // The same half hour of each raid in the 10:00 step, read 30 minutes after it ends.
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'last_wish' });
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'vault_of_glass' });

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ASKED, minRaidRuns: 1 });

        const raids = raidsAt(series, clock(10))!;
        // Last Wish reports all of its hour at once: 0.5 / 1. Vault of Glass only 80% of it
        // by then: 0.5 / 0.8.
        expect(raids.last_wish).toBeCloseTo(0.5, 10);
        expect(raids.vault_of_glass).toBeCloseTo(0.625, 10);
        // One curve for both would have given them the same number.
        expect(raids.vault_of_glass).not.toBeCloseTo(raids.last_wish, 3);
    });

    it('gives a raid below the history threshold counted values only, and the raids above it their estimates', () => {
        // Last Wish has 6 training runs (one a day), Vault of Glass 12. At a minimum of 7 the
        // first is too thinly evidenced to scale up and the second is not.
        seedTwoCurves();
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'last_wish' });
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'vault_of_glass' });

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ASKED, minRaidRuns: 7 });

        expect(Object.keys(raidsAt(series, clock(10))!)).toEqual(['vault_of_glass']);
        expect(Object.keys(raidsAt(series, clock(9))!)).toEqual(['vault_of_glass']);
        const counted = countedPoints(series);
        expect(counted.every((point) => Object.keys(point.raids!).join() === ASKED.join())).toBe(true);
        expect(series.points.filter((point) => point.provisional)).toHaveLength(2);
    });

    it('takes a raid at exactly the minimum', () => {
        seedWeekOf('last_wish', [[10, 0, HOUR]]);

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ['last_wish'], minRaidRuns: 6 });

        expect(Object.keys(raidsAt(series, clock(10))!)).toEqual(['last_wish']);
    });

    it('asks for 5,000 runs by default', () => {
        // Eighteen training runs are far short of it: the total is estimated, no raid is.
        seedWeekOf('last_wish', [[9, 0, HOUR], [10, 0, HOUR], [10, 45, HOUR]]);

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ['last_wish'] });

        expect(provisionalAt(series, clock(10))).toBeDefined();
        expect(raidsAt(series, clock(10))).toEqual({});
    });

    it('leaves a raid with no runs in the training week without an estimate, whatever the minimum', () => {
        seedWeekOf('last_wish', [[10, 0, HOUR]]);

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ['last_wish', 'kings_fall'], minRaidRuns: 0 });

        expect(Object.keys(raidsAt(series, clock(10))!)).toEqual(['last_wish']);
    });

    it('does not learn a raid\'s curve from other raids\' runs', () => {
        // Vault of Glass's late-reported hour must not leak into Last Wish: its only runs
        // are whole steps, so its estimate is its partial count whatever else ran.
        seedWeekOf('last_wish', [[10, 0, HOUR]]);
        seedWeekOf('vault_of_glass', [[10, 45, HOUR], [10, 45, HOUR]]);
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'last_wish' });

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ['last_wish'], minRaidRuns: 1 });

        expect(raidsAt(series, clock(10))!.last_wish).toBeCloseTo(0.5, 10);
    });

    it('estimates a raid that ran nothing in the step as 0', () => {
        seedWeekOf('last_wish', [[10, 0, HOUR]]);

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ['last_wish'], minRaidRuns: 1 });

        expect(raidsAt(series, clock(10))!.last_wish).toBe(0);
    });

    it('ends a raid\'s estimate at its first step with no share, even when a later step has one', () => {
        // The total keeps estimating (Last Wish reports its 09:00 hour at once). Of the
        // vault's hour 9 nothing is ever reported by two hours on (a 3.5 hour run), so its
        // 09:00 step has no share; its 10:00 step has one (half of it is reported at once),
        // but a dashed line drawn from 10:00 would be joined across the gap, so it is left out.
        seedWeekOf('last_wish', [[9, 0, HOUR]]);
        seedWeekOf('vault_of_glass', [[9, 0, 3.5 * HOUR], [10, 0, HOUR]]);
        seedRaid(clock(9), 30 * MINUTE, { raidKey: 'last_wish' });
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'vault_of_glass' });

        const series = getRaidsInProgress({ ...NOW_11_30, raidKeys: ['last_wish', 'vault_of_glass'], minRaidRuns: 1 });

        expect(provisionalAt(series, clock(9))).toBeDefined();
        expect(provisionalAt(series, clock(10))).toBeDefined();
        expect(Object.keys(raidsAt(series, clock(9))!)).toEqual(['last_wish']);
        expect(Object.keys(raidsAt(series, clock(10))!)).toEqual(['last_wish']);
    });

    it('does not change the total\'s estimate or the counted values', () => {
        seedTwoCurves();
        seedRaid(clock(10), 30 * MINUTE, { raidKey: 'last_wish' });
        seedRaid(clock(8), 30 * MINUTE, { raidKey: 'vault_of_glass' });

        const plain = getRaidsInProgress(NOW_11_30);
        const split = getRaidsInProgress({ ...NOW_11_30, raidKeys: ASKED, minRaidRuns: 1 });

        const shape = (series: RaidsInProgressSeries) =>
            series.points.map(({ start, end, total, provisional }) => ({ start, end, total, provisional }));
        expect(shape(split)).toEqual(shape(plain));
        expect(split.provisionalUntil).toBe(plain.provisionalUntil);
    });
});

describe('the top raids in range (#198)', () => {
    it('lists up to 3 raids by raid time, most first', () => {
        seedRaid(hoursBeforeNow(20), 3 * HOUR, { raidKey: 'vault_of_glass' });
        seedRaid(hoursBeforeNow(30), 2 * HOUR, { raidKey: 'last_wish' });
        seedRaid(hoursBeforeNow(40), 5 * HOUR, { raidKey: 'kings_fall' });
        seedRaid(hoursBeforeNow(50), HOUR / 2, { raidKey: 'crotas_end' });

        expect(getRaidsInProgress(SEVEN_DAYS).topRaids).toEqual(['kings_fall', 'vault_of_glass', 'last_wish']);
    });

    it('is returned whichever raids were asked for', () => {
        seedRaid(hoursBeforeNow(20), 3 * HOUR, { raidKey: 'vault_of_glass' });

        const asked = getRaidsInProgress({ ...SEVEN_DAYS, raidKeys: ['last_wish'] });

        expect(asked.topRaids).toEqual(['vault_of_glass']);
    });

    it('leaves out a raid with no counted time in range, so there can be fewer than 3', () => {
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'last_wish' });
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'vault_of_glass' });
        // Ended before the window opened: the query never reads it.
        seedRaid(NOW - 7 * 24 * HOUR - 5 * HOUR, HOUR, { raidKey: 'kings_fall' });
        // Inside the window but wholly in the steps not counted yet: read and swept, so the
        // raid reaches the ranking with zero counted time, and only the "no time at all" rule
        // keeps it off the list.
        seedRaid(hoursBeforeNow(2), HOUR, { raidKey: 'crotas_end' });

        expect(getRaidsInProgress(SEVEN_DAYS).topRaids).toEqual(['vault_of_glass', 'last_wish']);
    });

    it('breaks a tie in the raid list\'s order, not the order the runs were stored in', () => {
        // last_wish is stored first but listed after salvations_edge and vault_of_glass.
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'last_wish' });
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'vault_of_glass' });
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'salvations_edge' });

        expect(getRaidsInProgress(SEVEN_DAYS).topRaids).toEqual(['salvations_edge', 'vault_of_glass', 'last_wish']);
    });

    it('puts a tied raid key the raid list does not name after the raids it does', () => {
        // A key no RAID_DEFINITIONS entry names (a raid stored before manifest.ts learned it).
        // Stored first and alphabetically first, so only the "unnamed keys go last" rule puts
        // it behind last_wish on the same raid time.
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'aaa_unlisted_raid' });
        seedRaid(hoursBeforeNow(20), HOUR, { raidKey: 'last_wish' });

        expect(getRaidsInProgress(SEVEN_DAYS).topRaids).toEqual(['last_wish', 'aaa_unlisted_raid']);
    });

    it('ranks by the time inside the counted window, not the length of the run', () => {
        // A long run that mostly began before the window has the shorter overlap.
        const firstStep = NOW - 7 * 24 * HOUR;
        seedRaid(firstStep - 3 * HOUR, 4 * HOUR, { raidKey: 'kings_fall' });
        seedRaid(hoursBeforeNow(20), 2 * HOUR, { raidKey: 'last_wish' });

        expect(getRaidsInProgress(SEVEN_DAYS).topRaids).toEqual(['last_wish', 'kings_fall']);
    });

    it('does not rank by raid time that is not counted yet', () => {
        // Ended within the last 2 hours: a Provisional step's time, which no per-raid line shows.
        seedRaid(hoursBeforeNow(2), HOUR + HOUR / 2, { raidKey: 'kings_fall' });
        seedRaid(hoursBeforeNow(20), HOUR / 2, { raidKey: 'last_wish' });

        expect(getRaidsInProgress(SEVEN_DAYS).topRaids).toEqual(['last_wish']);
    });
});
