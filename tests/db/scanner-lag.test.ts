import { beforeEach, describe, expect, it } from 'vitest';
import { getNewestScannerRaidEndedAt } from '@/lib/db/queries';
import { getStatusStats } from '@/lib/system-stats';
import { resetTestDb } from '../helpers/db';
import { nowSec, seedRun } from '../helpers/seed';

/**
 * Scanner Lag (CONTEXT.md, ADR 0011): how long ago the newest raid the *scanner* stored ended.
 * The read has to ignore every other source, because after an outage the History Crawl keeps
 * storing newer raids and would otherwise make a stopped scanner look healthy.
 *
 * seedRun derives ended_at = period + activityDurationSeconds, so each run's end time is
 * period + DURATION here.
 */

const DURATION = 1800;
const endedAt = (period: number) => period + DURATION;

/** Raids seeded so far in this file; gives each one a distinct instance id and player. */
let seededRuns = 0;

/** One raid stored by `source` that ended at endedAt(period). */
function seedEndingAt(source: string, period: number): void {
    seededRuns += 1;
    seedRun({
        instanceId: `${9000 + seededRuns}`,
        source,
        period,
        activityDurationSeconds: DURATION,
        completedBy: [`46110000000000${seededRuns}`],
    });
}

beforeEach(() => {
    resetTestDb();
});

describe('getNewestScannerRaidEndedAt', () => {
    it('returns the newest ended_at among scanner-stored raids', () => {
        seedEndingAt('scanner', 1_000_000);
        seedEndingAt('scanner', 3_000_000);
        seedEndingAt('scanner', 2_000_000);
        expect(getNewestScannerRaidEndedAt()).toBe(endedAt(3_000_000));
    });

    it('ignores crawler, discovery and verify rows newer than the newest scanner row', () => {
        seedEndingAt('scanner', 1_000_000);
        seedEndingAt('crawler', 5_000_000);
        seedEndingAt('discover', 6_000_000); // the PM2 discovery process (src/lib/discovery/snowball.ts)
        seedEndingAt('discover backscan', 6_500_000); // scripts/discover.ts
        seedEndingAt('verify', 7_000_000);
        expect(getNewestScannerRaidEndedAt()).toBe(endedAt(1_000_000));
    });

    it('returns null when only other sources have stored raids', () => {
        seedEndingAt('crawler', 5_000_000);
        expect(getNewestScannerRaidEndedAt()).toBeNull();
    });

    it('returns null for an empty Tracker', () => {
        expect(getNewestScannerRaidEndedAt()).toBeNull();
    });
});

describe('getStatusStats().secondsSinceScannerRaid', () => {
    it('is the age in whole seconds of the newest scanner-stored raid', () => {
        seedEndingAt('scanner', nowSec() - 1000 - DURATION);
        const lag = getStatusStats().secondsSinceScannerRaid;
        expect(lag).toBeGreaterThanOrEqual(1000);
        expect(lag).toBeLessThanOrEqual(1002);
    });

    it('measures from the scanner row, not a newer crawler row', () => {
        seedEndingAt('scanner', nowSec() - 5000 - DURATION);
        seedEndingAt('crawler', nowSec() - 10 - DURATION);
        expect(getStatusStats().secondsSinceScannerRaid).toBeGreaterThanOrEqual(5000);
    });

    it('is null when the scanner has stored nothing', () => {
        expect(getStatusStats().secondsSinceScannerRaid).toBeNull();
    });
});
