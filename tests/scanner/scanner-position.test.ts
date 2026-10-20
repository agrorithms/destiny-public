import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb, testDb } from '../helpers/db';
import { buildPGCR, NON_RAID_HASH } from '../helpers/pgcr-builder';

type Scanner = typeof import('@/lib/scanner');

/**
 * Drives the real scanner — startScanner/stopScanner, its real loop and timers —
 * against the per-file test database, with only `fetch` stubbed.
 *
 * The scanner keeps its missed-id set and run state at module level, so every test
 * gets a fresh copy of the module. Settings are shrunk so a run takes milliseconds:
 * one worker keeps the request order deterministic, and a high per-key rate means
 * the limiter never sleeps.
 */

const BATCH_SIZE = 5;

const SCANNER_CONFIG = {
    apiKeys: ['test-scanner-key'],
    requestsPerSecond: 10_000,
    batchSize: BATCH_SIZE,
    workers: 1,
    pauseOnCatchupMs: 5,
    maxConsecutiveMisses: BATCH_SIZE,
};

let scanner: Scanner;

/** Every instance id the scanner asked Bungie for, in request order. */
let requested: bigint[];

/**
 * Answers the PGCR endpoint the way Bungie does: a PGCR for an id that exists
 * (a non-raid one, so nothing is written to the database) and DestinyPGCRNotFound
 * for anything else.
 */
function stubBungie(exists: (instanceId: bigint) => boolean): void {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const match = url.match(/\/PostGameCarnageReport\/(\d+)\//);
        if (!match) {
            throw new Error(`Scanner test stub only answers the PGCR endpoint, got ${url}`);
        }

        const instanceId = BigInt(match[1]);
        requested.push(instanceId);

        const body = exists(instanceId)
            ? {
                Response: buildPGCR({ instanceId: match[1], activityHash: NON_RAID_HASH }),
                ErrorCode: 1,
                ErrorStatus: 'Success',
                ThrottleSeconds: 0,
                Message: 'Ok',
            }
            : {
                ErrorCode: 1653,
                ErrorStatus: 'DestinyPGCRNotFound',
                ThrottleSeconds: 0,
                Message: 'The activity you are looking for was not found.',
            };

        return new Response(JSON.stringify(body), { status: 200 });
    });
}

/** Writes the stored Scanner Position the way scripts/discover.ts does. */
function writeScannerPosition(position: bigint): void {
    testDb().prepare(`
        INSERT INTO crawler_state (key, value, updated_at)
        VALUES ('scanner_position', ?, unixepoch())
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = unixepoch()
    `).run(position.toString());
}

beforeEach(async () => {
    resetTestDb();
    vi.resetModules();
    scanner = await import('@/lib/scanner');
    requested = [];
});

afterEach(async () => {
    // Wait for the loop to actually exit. Its timers would otherwise keep writing
    // to the database the next test is about to reset.
    scanner.stopScanner();
    await vi.waitFor(() => expect(scanner.isScannerRunning()).toBe(false), { timeout: 2000 });
});

describe('scanner position', () => {
    // Discovery (scripts/discover.ts) catches a scanner that has fallen far behind by
    // writing a higher scanner_position while the scanner runs; the scanner's
    // "Position jump detected" block adopts it. That jump is intended behaviour and
    // stays until #174 decides otherwise — this pins it so the position fix in #176
    // can't remove it by accident.
    it('adopts a higher stored position written while it runs', async () => {
        const start = BigInt('17000000000');
        const jumpTo = start + BigInt(1000);
        writeScannerPosition(start);
        // Every id exists, so no misses queue up and no retry pass re-requests old ids.
        stubBungie(() => true);

        await scanner.startScanner(SCANNER_CONFIG);
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(BATCH_SIZE));
        expect(requested[0]).toBe(start + BigInt(1));

        const jumpIndex = requested.length;
        const lastBeforeJump = requested[jumpIndex - 1];
        writeScannerPosition(jumpTo);

        // Two full batches past the jump, so there is something to check after it.
        await vi.waitFor(() => expect(requested).toContain(jumpTo + BigInt(2 * BATCH_SIZE)));

        const afterJump = requested.slice(jumpIndex);
        const resumeAt = afterJump.indexOf(jumpTo + BigInt(1));
        expect(resumeAt).toBeGreaterThanOrEqual(0);

        // A batch already in flight when the write landed finishes first: whatever
        // precedes the resume is the rest of that batch and nothing more.
        const inFlightTail = afterJump.slice(0, resumeAt);
        expect(inFlightTail.length).toBeLessThan(BATCH_SIZE);
        expect(inFlightTail).toEqual(inFlightTail.map((_, i) => lastBeforeJump + BigInt(i + 1)));

        // From the resume on, nothing between the old position and the written one.
        expect(afterJump.slice(resumeAt).every((id) => id > jumpTo)).toBe(true);
    });
});
