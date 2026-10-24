import { beforeEach, describe, expect, it } from 'vitest';
import { getRaidsInProgress, type RaidsInProgressSeries } from '@/lib/db/queries';
import { resetTestDb } from '../helpers/db';
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

let nextInstance = 1;
/** A raid run from `start` lasting `seconds`; every other field is seedRun's default. */
function seedRaid(start: number, seconds: number, extra: Partial<SeedRunOptions> = {}): void {
    seedRun({ instanceId: String(nextInstance++), period: start, activityDurationSeconds: seconds, completedBy: ['p1'], ...extra });
}

beforeEach(() => {
    resetTestDb();
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

        expect(series.points[0]).toEqual({ start: firstStep, end: firstStep + HOUR, total: 0.5 });
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

        expect(series.points.at(-1)).toEqual({ start: hoursBeforeNow(3), end: hoursBeforeNow(2), total: 1 });
        expect(series.countedUntil).toBe(now - 2 * HOUR);
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
