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
 * seedRun derives ended_at = period + duration, so each run's end time is period + 1800 here.
 */

const DURATION = 1800;
const endedAt = (period: number) => period + DURATION;

let n = 0;
function seed(source: string, period: number): void {
    n += 1;
    seedRun({ instanceId: `${9000 + n}`, source, period, completedBy: [`46110000000000${n}`] });
}

beforeEach(() => {
    resetTestDb();
});

describe('getNewestScannerRaidEndedAt', () => {
    it('returns the newest ended_at among scanner-stored raids', () => {
        seed('scanner', 1_000_000);
        seed('scanner', 3_000_000);
        seed('scanner', 2_000_000);
        expect(getNewestScannerRaidEndedAt()).toBe(endedAt(3_000_000));
    });

    it('ignores crawler, discovery and verify rows newer than the newest scanner row', () => {
        seed('scanner', 1_000_000);
        seed('crawler', 5_000_000);
        seed('discover backscan', 6_000_000);
        seed('verify', 7_000_000);
        expect(getNewestScannerRaidEndedAt()).toBe(endedAt(1_000_000));
    });

    it('returns null when only other sources have stored raids', () => {
        seed('crawler', 5_000_000);
        expect(getNewestScannerRaidEndedAt()).toBeNull();
    });

    it('returns null for an empty Tracker', () => {
        expect(getNewestScannerRaidEndedAt()).toBeNull();
    });
});

describe('getStatusStats().secondsSinceScannerRaid', () => {
    it('is the age in whole seconds of the newest scanner-stored raid', () => {
        seed('scanner', nowSec() - 1000 - DURATION);
        const lag = getStatusStats().secondsSinceScannerRaid;
        expect(lag).toBeGreaterThanOrEqual(1000);
        expect(lag).toBeLessThanOrEqual(1002);
    });

    it('measures from the scanner row, not a newer crawler row', () => {
        seed('scanner', nowSec() - 5000 - DURATION);
        seed('crawler', nowSec() - 10 - DURATION);
        expect(getStatusStats().secondsSinceScannerRaid).toBeGreaterThanOrEqual(5000);
    });

    it('is null when the scanner has stored nothing', () => {
        expect(getStatusStats().secondsSinceScannerRaid).toBeNull();
    });
});
