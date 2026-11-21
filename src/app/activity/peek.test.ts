import { describe, expect, it } from 'vitest';
import { peek, settle } from './peek';

// A warm cache answers within the current turn of the event loop, a cold one after the miss pause
// (src/lib/cache/raid-stats-cache.ts). The page peeks at its two reads after one turn, so a warm
// board renders in the first HTML with no Suspense fallback, and a cold one streams (#200).
describe('peek', () => {
    it('reads a promise that settles within the current turn, chained or not', async () => {
        expect(await peek(Promise.resolve(1).then((x) => x + 1))).toEqual({ state: 'fulfilled', value: 2 });
        const error = new Error('maintenance');
        const rejected = Promise.reject(error);
        expect(await peek(rejected)).toEqual({ state: 'rejected', error });
    });

    it('says pending for a promise waiting on a timer, without waiting for it', async () => {
        const started = Date.now();
        const slow = new Promise((resolve) => setTimeout(() => resolve(1), 100));
        expect(await peek(slow)).toEqual({ state: 'pending' });
        expect(Date.now() - started).toBeLessThan(90);
        await slow;
    });
});

// What the board does with a read that was still pending at the peek (./RaidStatsBoard.tsx): wait
// for it, and get maintenance back as a value to draw, not a throw.
describe('settle', () => {
    it('waits for a promise on a timer, and gives a rejection as a value', async () => {
        const slow = new Promise((resolve) => setTimeout(() => resolve('frame'), 20));
        expect(await settle(slow)).toEqual({ state: 'fulfilled', value: 'frame' });
        const error = new Error('maintenance');
        expect(await settle(Promise.reject(error))).toEqual({ state: 'rejected', error });
    });
});
