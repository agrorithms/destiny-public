import { beforeEach, describe, expect, it } from 'vitest';
import { getRaidsInProgress, type RaidsInProgressSeries } from '@/lib/db/queries';
import { resetTestDb } from '../helpers/db';
import { seedRun, type SeedRunOptions } from '../helpers/seed';

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
});
