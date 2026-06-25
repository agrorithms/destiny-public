/**
 * Tests for the generic SWR cache utility.
 * Run with: npx tsx scripts/test-swr-cache.ts
 *
 * No test framework is wired into this repo (scripts run via tsx), so this is a
 * standalone assert-based runner matching the existing `scripts/` convention.
 */
import assert from 'node:assert/strict';
import { getOrCompute, __resetSwrCacheForTests } from '../src/lib/cache/swr-cache';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    __resetSwrCacheForTests();
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.error(`  ✗ ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

async function main(): Promise<void> {
    console.log('swr-cache tests');

    await test('miss then hit — compute runs once', async () => {
        let calls = 0;
        const compute = () => {
            calls += 1;
            return `v${calls}`;
        };
        const opts = { freshMs: 10_000, staleMs: 20_000 };

        const first = await getOrCompute('k', opts, compute);
        assert.equal(first.state, 'miss');
        assert.equal(first.value, 'v1');

        const second = await getOrCompute('k', opts, compute);
        assert.equal(second.state, 'hit');
        assert.equal(second.value, 'v1');
        assert.equal(calls, 1);
    });

    await test('stale — serves old value then background refresh updates it', async () => {
        let calls = 0;
        const compute = () => {
            calls += 1;
            return `v${calls}`;
        };
        const opts = { freshMs: 200, staleMs: 10_000 };

        await getOrCompute('k', opts, compute); // v1
        await sleep(250); // past fresh, within stale

        const stale = await getOrCompute('k', opts, compute);
        assert.equal(stale.state, 'stale');
        assert.equal(stale.value, 'v1'); // old value served immediately

        await sleep(50); // let the background refresh run (still inside fresh window for v2)
        const after = await getOrCompute('k', opts, compute);
        assert.equal(after.state, 'hit');
        assert.equal(after.value, 'v2');
        assert.equal(calls, 2);
    });

    await test('single-flight — concurrent misses compute once', async () => {
        let calls = 0;
        const compute = async () => {
            calls += 1;
            await sleep(30);
            return `v${calls}`;
        };
        const opts = { freshMs: 10_000, staleMs: 20_000 };

        const [a, b, c] = await Promise.all([
            getOrCompute('k', opts, compute),
            getOrCompute('k', opts, compute),
            getOrCompute('k', opts, compute),
        ]);
        assert.equal(calls, 1);
        assert.equal(a.value, 'v1');
        assert.equal(b.value, 'v1');
        assert.equal(c.value, 'v1');
    });

    await test('serve-stale-on-error — failed background refresh keeps old value', async () => {
        let calls = 0;
        const compute = () => {
            calls += 1;
            if (calls === 1) return 'v1';
            throw new Error('boom');
        };
        const opts = { freshMs: 20, staleMs: 10_000, negativeMs: 5_000 };

        await getOrCompute('k', opts, compute); // v1
        await sleep(40);

        const stale = await getOrCompute('k', opts, compute);
        assert.equal(stale.state, 'stale'); // first stale schedules the (doomed) refresh
        assert.equal(stale.value, 'v1');

        await sleep(30); // background refresh fails, sets negative marker, keeps v1

        const staleErr = await getOrCompute('k', opts, compute);
        assert.equal(staleErr.value, 'v1'); // still serving stale value
        assert.equal(staleErr.state, 'stale-error');
    });

    await test('negative cache — failed miss re-throws and skips compute within window', async () => {
        let calls = 0;
        const err = new Error('db down');
        const compute = () => {
            calls += 1;
            throw err;
        };
        const opts = { freshMs: 10_000, staleMs: 20_000, negativeMs: 5_000 };

        await assert.rejects(getOrCompute('k', opts, compute), /db down/);
        assert.equal(calls, 1);

        // Within the negative window: re-throws the SAME error without computing.
        await assert.rejects(getOrCompute('k', opts, compute), (e: unknown) => e === err);
        assert.equal(calls, 1, 'compute must not run again inside the negative window');
    });

    await test('negative cache — clears after window expires, then recomputes', async () => {
        let calls = 0;
        const compute = () => {
            calls += 1;
            if (calls === 1) throw new Error('transient');
            return 'recovered';
        };
        const opts = { freshMs: 10_000, staleMs: 20_000, negativeMs: 30 };

        await assert.rejects(getOrCompute('k', opts, compute));
        assert.equal(calls, 1);

        await sleep(50); // negative window expires

        const ok = await getOrCompute('k', opts, compute);
        assert.equal(ok.state, 'miss');
        assert.equal(ok.value, 'recovered');
        assert.equal(calls, 2);
    });

    console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
}

void main();
