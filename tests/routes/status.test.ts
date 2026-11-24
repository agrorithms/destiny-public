import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/status/route';
import { resetTestDb, testDb } from '../helpers/db';
import { nowSec, seedRun } from '../helpers/seed';

/**
 * GET /api/status's health verdict: the crawl heartbeat, the session heartbeat, and (ADR 0011)
 * Scanner Lag. Each test sets one signal stale or fresh and leaves the others healthy, so the
 * verdict can only have come from the signal under test. Real SQLite, no mocks.
 */

function setState(key: string, ageSec: number): void {
    testDb()
        .prepare(
            `INSERT INTO crawler_state (key, value, updated_at) VALUES (?, 'x', ?)
             ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`
        )
        .run(key, nowSec() - ageSec);
}

/** One scanner-stored raid that ended `lagSec` ago. */
function seedScannerRaid(lagSec: number): void {
    seedRun({
        instanceId: '9001',
        source: 'scanner',
        period: nowSec() - lagSec - 1800,
        completedBy: ['4611000000000001'],
    });
}

async function verdict() {
    const response = await GET();
    return { http: response.status, body: await response.json() };
}

beforeEach(() => {
    resetTestDb();
    setState('heartbeat', 10);
    setState('session_heartbeat', 10);
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('Scanner Lag', () => {
    it('is degraded when the newest scanner raid ended longer ago than the default 900s', async () => {
        seedScannerRaid(1000);
        const { http, body } = await verdict();
        expect(http).toBe(503);
        expect(body.status).toBe('degraded');
        expect(body.scannerLagStale).toBe(true);
        expect(body.secondsSinceScannerRaid).toBeGreaterThanOrEqual(1000);
    });

    it('is ok when the newest scanner raid ended inside the threshold', async () => {
        seedScannerRaid(100);
        const { http, body } = await verdict();
        expect(http).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.scannerLagStale).toBe(false);
    });

    it('is ok when the scanner has stored nothing (a fresh start)', async () => {
        const { http, body } = await verdict();
        expect(http).toBe(200);
        expect(body.status).toBe('ok');
        expect(body.secondsSinceScannerRaid).toBeNull();
        expect(body.scannerLagStale).toBe(false);
    });

    it('is not rescued by newer crawler rows', async () => {
        seedScannerRaid(1000);
        seedRun({ instanceId: '9002', source: 'crawler', period: nowSec() - 1900, completedBy: ['4611000000000002'] });
        expect((await verdict()).body.status).toBe('degraded');
    });

    it('treats a lag exactly at the threshold as ok and one second more as degraded', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
            setState('heartbeat', 10);
            setState('session_heartbeat', 10);
            seedScannerRaid(900);
            expect((await verdict()).body.status).toBe('ok');
            vi.setSystemTime(new Date('2026-11-24T12:00:01Z'));
            setState('heartbeat', 10);
            setState('session_heartbeat', 10);
            expect((await verdict()).body.status).toBe('degraded');
        } finally {
            vi.useRealTimers();
        }
    });

    it('honours SCANNER_LAG_THRESHOLD_SEC', async () => {
        seedScannerRaid(100);
        vi.stubEnv('SCANNER_LAG_THRESHOLD_SEC', '50');
        expect((await verdict()).body.status).toBe('degraded');
        vi.stubEnv('SCANNER_LAG_THRESHOLD_SEC', '5000');
        expect((await verdict()).body.status).toBe('ok');
    });
});

describe('session heartbeat (unchanged by Scanner Lag)', () => {
    it('is degraded when the session heartbeat is older than 900s', async () => {
        setState('session_heartbeat', 1000);
        const { http, body } = await verdict();
        expect(http).toBe(503);
        expect(body.sessionHeartbeatStale).toBe(true);
    });

    it('is ok when the session heartbeat is fresh', async () => {
        const { http, body } = await verdict();
        expect(http).toBe(200);
        expect(body.sessionHeartbeatStale).toBe(false);
    });

    it('is ok when no poll has ever completed', async () => {
        testDb().prepare("DELETE FROM crawler_state WHERE key = 'session_heartbeat'").run();
        const { http, body } = await verdict();
        expect(http).toBe(200);
        expect(body.secondsSinceSessionHeartbeat).toBeNull();
    });
});

describe('crawl heartbeat (unchanged by Scanner Lag)', () => {
    it('is degraded when the crawl heartbeat is older than 5 minutes', async () => {
        setState('heartbeat', 400);
        expect((await verdict()).http).toBe(503);
    });
});
