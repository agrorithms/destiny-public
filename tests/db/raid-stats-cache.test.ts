import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../../src/lib/cache/swr-cache';
import { RAID_STATS_MISS_PAUSE_MS, readRaidStatsFrame, readRaidStatsScope } from '../../src/lib/cache/raid-stats-cache';
import { resetTestDb } from '../helpers/db';
import { seedRun } from '../helpers/seed';
import { VOG_MASTER } from '../helpers/pgcr-builder';

/**
 * The Raid Stats board's staged compute (#200, ADR 0006's 2026-11-12 amendment): the frame and
 * each scope are cached apart, so a page that shows one scope computes the frame and that scope
 * only, and a cache miss pauses before its query so the page can stream what is already done.
 *
 * "Not computed" is shown the way a reader would see it: a run seeded after a read is counted by
 * a later read only if that later read ran its own query. A scope the first read had computed
 * and cached would still say what it said before the run was seeded.
 */

beforeEach(() => {
    resetTestDb();
    __resetSwrCacheForTests();
});

afterEach(() => {
    vi.useRealTimers();
});

const RAID = 'salvations_edge';

function seedFullClear(id: string): void {
    seedRun({ instanceId: id, completedBy: [`p${id}`] });
}

function seedCheckpointRun(id: string): void {
    seedRun({ instanceId: id, incompleteBy: [`p${id}`], completed: false, startedFromBeginning: false });
}

function seedUnfinishedFreshRun(id: string): void {
    seedRun({ instanceId: id, incompleteBy: [`p${id}`], completed: false });
}

async function sampleSize(hours: number, scope: 'fullClear' | 'freshRuns' | 'allAttempts'): Promise<number | undefined> {
    const { value } = await readRaidStatsScope(hours, scope);
    return value?.get(RAID)?.sampleSize;
}

describe('the staged compute', () => {
    it('a request for one scope does not compute the other two', async () => {
        seedFullClear('1');
        expect(await sampleSize(168, 'fullClear')).toBe(1);

        seedCheckpointRun('2');
        seedUnfinishedFreshRun('3');

        // Counted, so these two ran now: the Full Clears read had computed neither.
        expect(await sampleSize(168, 'allAttempts')).toBe(3);
        expect(await sampleSize(168, 'freshRuns')).toBe(2);
    });

    it('the frame computes no scope, and no scope the frame', async () => {
        seedFullClear('1');
        expect((await readRaidStatsFrame(168)).value[0].instanceCount).toBe(1);

        seedFullClear('2');
        expect(await sampleSize(168, 'fullClear')).toBe(2);

        seedFullClear('3');
        // The frame is its own entry: cached at one instance, not recomputed by the scope read.
        expect((await readRaidStatsFrame(168)).value[0].instanceCount).toBe(1);
    });

    it('caches each piece: a second read of the same scope is the first one', async () => {
        seedFullClear('1');
        expect(await sampleSize(168, 'fullClear')).toBe(1);

        seedFullClear('2');
        expect(await sampleSize(168, 'fullClear')).toBe(1);
        const second = await readRaidStatsScope(168, 'fullClear');
        expect(second.state).toBe('hit');
    });

    it('keys each piece by its window and its filters', async () => {
        seedFullClear('1');
        expect(await sampleSize(24, 'fullClear')).toBe(1);
        expect((await readRaidStatsFrame(24)).value).toHaveLength(1);

        seedRun({ instanceId: '2', completedBy: ['p2'], activityHash: VOG_MASTER });
        seedFullClear('3');
        expect(await sampleSize(168, 'fullClear')).toBe(2);
        expect((await readRaidStatsFrame(168)).value).toHaveLength(2);

        const master = await readRaidStatsScope(24, 'fullClear', { difficulty: 'master' });
        expect([...master.value!.keys()]).toEqual(['vault_of_glass']);
        expect((await readRaidStatsFrame(24, { difficulty: 'master' })).value.map((row) => row.raidKey)).toEqual(['vault_of_glass']);
    });

    it('answers null, with nothing cached or run, for a scope not computed at this window', async () => {
        seedFullClear('1');
        expect((await readRaidStatsScope(720, 'allAttempts')).value).toBeNull();
        expect((await readRaidStatsScope(720, 'freshRuns')).value).toBeNull();
        expect(await sampleSize(720, 'fullClear')).toBe(1);
    });
});

describe('the pause before a query on a cache miss', () => {
    /** Starts `read` and reports whether it has settled, without awaiting it. */
    function track<T>(read: Promise<T>): { settled: () => boolean; done: Promise<T> } {        let settled = false;
        const done = read.then((value) => {
            settled = true;
            return value;
        });
        return { settled: () => settled, done };
    }

    it('is 100 ms', () => {
        expect(RAID_STATS_MISS_PAUSE_MS).toBe(100);
    });

    const reads: Array<[string, () => Promise<{ state: unknown }>]> = [
        ['the frame', () => readRaidStatsFrame(24)],
        ['a scope', () => readRaidStatsScope(24, 'fullClear')],
    ];

    it.each(reads)('%s waits the pause on a miss, and not at all on a hit', async (_name, read) => {
        seedFullClear('1');
        vi.useFakeTimers();

        const miss = track(read());
        await vi.advanceTimersByTimeAsync(RAID_STATS_MISS_PAUSE_MS - 1);
        expect(miss.settled()).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(miss.settled()).toBe(true);
        expect((await miss.done).state).toBe('miss');

        const hit = track(read());
        await vi.advanceTimersByTimeAsync(0);
        expect(hit.settled()).toBe(true);
        expect((await hit.done).state).toBe('hit');
    });

    it('an uncomputed scope does not wait', async () => {
        vi.useFakeTimers();
        const read = track(readRaidStatsScope(720, 'allAttempts'));
        await vi.advanceTimersByTimeAsync(0);
        expect(read.settled()).toBe(true);
    });
});
