import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { resetTestDb, testDb } from '../helpers/db';
import { bungieEnvelope } from '../helpers/bungie-profile-builder';
import { buildPGCR, NON_RAID_HASH, RAID_HASH } from '../helpers/pgcr-builder';
import { seedRun } from '../helpers/seed';

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

// Each wait is bounded by real 100ms gaps between batches plus the work in them,
// so vi.waitFor's default 1s leaves little headroom on a loaded CI machine.
const WAIT = { timeout: 5000 };

let scanner: Scanner;

/** Every instance id the scanner asked Bungie for, in request order. */
let requested: bigint[];

/** Records what the scanner prints and still prints it. The log wording is part of the spec. */
let consoleLog: MockInstance<typeof console.log>;

function loggedLines(): string[] {
    return consoleLog.mock.calls.map(([line]) => String(line));
}

/**
 * Answers the PGCR endpoint the way Bungie does: a PGCR for an id that exists
 * (a non-raid one, so nothing is written to the database) and DestinyPGCRNotFound
 * for anything else. `answer` replaces that for the ids it returns a response for.
 */
function stubBungie(
    exists: (instanceId: bigint) => boolean,
    answer: (instanceId: bigint) => Response | undefined = () => undefined
): void {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const match = url.match(/\/PostGameCarnageReport\/(\d+)\//);
        if (!match) {
            throw new Error(`Scanner test stub only answers the PGCR endpoint, got ${url}`);
        }

        const instanceId = BigInt(match[1]);
        requested.push(instanceId);

        const answered = answer(instanceId);
        if (answered) {
            return answered;
        }

        const body = exists(instanceId)
            ? bungieEnvelope(buildPGCR({ instanceId: match[1], activityHash: NON_RAID_HASH }))
            : bungieEnvelope(undefined, {
                ErrorCode: 1653,
                ErrorStatus: 'DestinyPGCRNotFound',
                Message: 'The activity you are looking for was not found.',
            });

        return new Response(JSON.stringify(body), { status: 200 });
    });
}

/** The raid PGCR Bungie would send for an id; the scanner stores it. */
function raidResponse(instanceId: bigint): Response {
    const pgcr = buildPGCR({ instanceId: instanceId.toString(), activityHash: RAID_HASH });
    return new Response(JSON.stringify(bungieEnvelope(pgcr)), { status: 200 });
}

/** How many times the scanner has asked for an id, this request included. */
function timesRequested(instanceId: bigint): number {
    return requested.filter((id) => id === instanceId).length;
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

function readScannerPosition(): bigint | null {
    const row = testDb().prepare(
        "SELECT value FROM crawler_state WHERE key = 'scanner_position'"
    ).get() as { value: string } | undefined;
    return row ? BigInt(row.value) : null;
}

/** `count` consecutive instance ids starting at `first`. */
function idRange(first: bigint, count: number): bigint[] {
    return Array.from({ length: count }, (_, i) => first + BigInt(i));
}

beforeEach(async () => {
    resetTestDb();
    vi.resetModules();
    scanner = await import('@/lib/scanner');
    requested = [];
    consoleLog = vi.spyOn(console, 'log');
});

afterEach(async () => {
    // Wait for the loop to actually exit. Its timers would otherwise keep writing
    // to the database the next test is about to reset.
    scanner.stopScanner();
    await vi.waitFor(() => expect(scanner.isScannerRunning()).toBe(false), WAIT);
    vi.restoreAllMocks();
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
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(BATCH_SIZE), WAIT);
        expect(requested[0]).toBe(start + BigInt(1));

        const jumpIndex = requested.length;
        const lastBeforeJump = requested[jumpIndex - 1];
        writeScannerPosition(jumpTo);

        // Two full batches past the jump, so there is something to check after it.
        await vi.waitFor(() => expect(requested).toContain(jumpTo + BigInt(2 * BATCH_SIZE)), WAIT);

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

// The Scanner Position only lands on an id confirmed to exist (#176): one that came
// back from Bungie or was already stored. Before that rule, every batch moved it to
// the batch's last id whatever came back, so during Bungie maintenance — no new ids
// being issued — it stepped one batch past the Leading Edge per catch-up cycle and
// ended up tens of thousands of ids ahead.
describe('scanner position at the leading edge', () => {
    it('stays put when every id in the batch is not found', async () => {
        const start = BigInt('17000000000');
        writeScannerPosition(start);
        stubBungie(() => false);

        await scanner.startScanner(SCANNER_CONFIG);

        // Over many cycles, the position holds and the same batch is asked for again
        // each time.
        const cycles = 12;
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(cycles * BATCH_SIZE), WAIT);

        expect(readScannerPosition()).toBe(start);
        const sameBatch = idRange(start + BigInt(1), BATCH_SIZE);
        expect(requested.slice(0, cycles * BATCH_SIZE)).toEqual(
            Array.from({ length: cycles }, () => sameBatch).flat()
        );
    });

    it('stops on the last id that exists and resumes just after it', async () => {
        const start = BigInt('17000000000');
        // Mid-batch: the first batch is start+1..start+5, and only the first three exist.
        const lastExisting = start + BigInt(3);
        writeScannerPosition(start);
        stubBungie((id) => id <= lastExisting);

        await scanner.startScanner(SCANNER_CONFIG);
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(2 * BATCH_SIZE), WAIT);

        expect(readScannerPosition()).toBe(lastExisting);
        expect(requested.slice(BATCH_SIZE, 2 * BATCH_SIZE)).toEqual(
            idRange(lastExisting + BigInt(1), BATCH_SIZE)
        );
    });

    // The crawler stores PGCRs it finds through player histories, often for ids the
    // scanner hasn't reached yet. scanSinglePGCR skips those without asking Bungie
    // and reports them as not_raid, so the position can land on one. That is safe:
    // a stored PGCR came from Bungie, so its id exists and can't be past the Leading
    // Edge. So stored ids can only move the position onto ids that exist.
    it('stops on an id already stored, without asking Bungie for it', async () => {
        const start = BigInt('17000000000');
        // Mid-batch: the first batch is start+1..start+5, and only start+3 is stored.
        const stored = start + BigInt(3);
        seedRun({ instanceId: stored.toString() });
        writeScannerPosition(start);
        stubBungie(() => false);

        await scanner.startScanner(SCANNER_CONFIG);
        // Four requests for the first batch (start+3 is skipped), five for the next.
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(2 * BATCH_SIZE - 1), WAIT);

        expect(readScannerPosition()).toBe(stored);
        expect(requested).not.toContain(stored);
        expect(requested.slice(BATCH_SIZE - 1, 2 * BATCH_SIZE - 1)).toEqual(
            idRange(stored + BigInt(1), BATCH_SIZE)
        );
    });
});

// The missed-id set holds ids worth asking for again later. A miss below the last
// confirmed id in a batch is a real gap — Bungie issued later ids, so this one may
// just not be available yet — and is queued for the retry pass. A miss past it is
// not queued: the position stops at the confirmed id, so the next forward batch
// scans it again anyway. Queuing those as well is what grew the set by a full batch
// per cycle at the Leading Edge.
//
// These tests observe the set through the ids fetch is asked for. Every catch-up
// pause retries whatever is queued, before the next forward batch, so a queued id
// shows up as a request out of forward order. Each test has one confirmed id in its
// first batch, so the forward batches after it start just past that id.
describe('missed ids', () => {
    const start = BigInt('17000000000');

    // Five-id batches of: gap, confirmed, then misses. The first batch ends on three
    // misses, so its catch-up pause fires.
    const gapId = start + BigInt(1);
    const confirmed = start + BigInt(2);
    const pauseAfterThreeMisses = { ...SCANNER_CONFIG, maxConsecutiveMisses: 3 };

    it('retries a miss below the last id that exists at the next catch-up pause', async () => {
        writeScannerPosition(start);
        stubBungie((id) => id === confirmed);

        await scanner.startScanner(pauseAfterThreeMisses);
        await vi.waitFor(() => expect(requested.length).toBeGreaterThan(BATCH_SIZE), WAIT);

        expect(requested[BATCH_SIZE]).toBe(gapId);
    });

    // Nothing is stored past the position here, so it stays put and every batch comes
    // back empty. A set that only ran when the position moved would never be retried.
    it('keeps retrying a miss while the position is stopped', async () => {
        writeScannerPosition(start);
        stubBungie((id) => id === confirmed);

        await scanner.startScanner(pauseAfterThreeMisses);
        await vi.waitFor(() => expect(timesRequested(gapId)).toBeGreaterThanOrEqual(3), WAIT);

        expect(readScannerPosition()).toBe(confirmed);
    });

    it('does not queue misses past the last id that exists', async () => {
        // The first id exists and the four after it don't, so the first catch-up pause
        // has only those four to queue. Queued, they would be asked for before the
        // next forward batch, and the forward batches below would no longer line up.
        const firstId = start + BigInt(1);
        writeScannerPosition(start);
        stubBungie((id) => id === firstId);

        await scanner.startScanner({ ...SCANNER_CONFIG, maxConsecutiveMisses: 4 });
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(3 * BATCH_SIZE), WAIT);

        expect(readScannerPosition()).toBe(firstId);
        const nextBatch = idRange(firstId + BigInt(1), BATCH_SIZE);
        expect(requested.slice(BATCH_SIZE, 3 * BATCH_SIZE)).toEqual([...nextBatch, ...nextBatch]);
    });
});

// A catch-up pause only says the batch ended on misses. That is what an Id Hole looks
// like too, so the line must not claim the Leading Edge: that wording hid a 55-hour
// stall. The retry line is there to report raids recovered, so a pass that found none
// stays quiet.
describe('catch-up pause log lines', () => {
    const start = BigInt('17000000000');
    const firstGap = start + BigInt(1);
    const secondGap = start + BigInt(2);
    const confirmed = start + BigInt(3);
    const pauseAfterTwoMisses = { ...SCANNER_CONFIG, maxConsecutiveMisses: 2 };

    const retryLines = () => loggedLines().filter((line) => line.includes('Retry complete'));

    it('reports the misses and the wait, not the Leading Edge', async () => {
        writeScannerPosition(start);
        stubBungie(() => false);

        await scanner.startScanner(SCANNER_CONFIG);
        await vi.waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(2 * BATCH_SIZE), WAIT);

        expect(loggedLines()).toContain('[SCANNER] 5 consecutive misses, pausing 0.005s');
        expect(loggedLines().filter((line) => line.includes('Leading Edge'))).toEqual([]);
    });

    it('reports a retry pass that recovers a raid, with how many ids it retried', async () => {
        writeScannerPosition(start);
        // Both gaps miss on the first ask. On the second, one is a raid and one still misses.
        stubBungie(
            (id) => id === confirmed,
            (id) => (id === firstGap && timesRequested(id) > 1 ? raidResponse(id) : undefined)
        );

        await scanner.startScanner(pauseAfterTwoMisses);
        await vi.waitFor(() => expect(timesRequested(secondGap)).toBeGreaterThanOrEqual(3), WAIT);

        // Only the first pass recovered a raid, so the later ones add no line.
        expect(retryLines()).toEqual([
            '[SCANNER] 🔄 Retry complete: 1 raids found of 2 retried. 1 still missing. Set size: 1',
        ]);
        expect(scanner.getScannerStats().totalRaidsFound).toBe(1);
    });

    it('logs nothing for a retry pass that recovers no raid', async () => {
        writeScannerPosition(start);
        // One gap keeps missing. The other turns out to exist but isn't a raid, which
        // settles it and is still no raid recovered.
        stubBungie((id) => id === confirmed || (id === firstGap && timesRequested(id) > 1));

        await scanner.startScanner(pauseAfterTwoMisses);
        await vi.waitFor(() => expect(timesRequested(secondGap)).toBeGreaterThanOrEqual(3), WAIT);

        expect(timesRequested(firstGap)).toBe(2);
        expect(retryLines()).toEqual([]);
    });
});
