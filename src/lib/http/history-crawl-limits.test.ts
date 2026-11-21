import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryCrawlLimits } from './history-crawl-limits';

// The two limits on history-crawl requests that sit in the web process (#9004).
const T0 = new Date('2026-08-03T12:00:00Z').getTime();
const A = { membershipId: '1', membershipType: 3 };
const B = { membershipId: '2', membershipType: 3 };

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('the global limit', () => {
    it('allows 60 attempts a minute by default and refuses the 61st', () => {
        const limits = createHistoryCrawlLimits({});
        for (let i = 0; i < 60; i++) expect(limits.isOverGlobalLimit()).toBe(false);
        expect(limits.isOverGlobalLimit()).toBe(true);
    });

    it('opens again when the minute is over', () => {
        const limits = createHistoryCrawlLimits({});
        for (let i = 0; i < 61; i++) limits.isOverGlobalLimit();
        vi.advanceTimersByTime(60_000);
        expect(limits.isOverGlobalLimit()).toBe(false);
    });

    it('takes its limit from HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN', () => {
        const limits = createHistoryCrawlLimits({ HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN: '2' });
        expect(limits.isOverGlobalLimit()).toBe(false);
        expect(limits.isOverGlobalLimit()).toBe(false);
        expect(limits.isOverGlobalLimit()).toBe(true);
    });

    it('reads an unreadable or negative value as 60', () => {
        for (const raw of ['abc', '-5', '']) {
            const limits = createHistoryCrawlLimits({ HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN: raw });
            for (let i = 0; i < 60; i++) expect(limits.isOverGlobalLimit()).toBe(false);
            expect(limits.isOverGlobalLimit()).toBe(true);
        }
    });

    it('refuses every attempt when the knob is 0', () => {
        expect(createHistoryCrawlLimits({ HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN: '0' }).isOverGlobalLimit()).toBe(true);
    });
});

describe('the per-player cooldown', () => {
    it('runs 120 seconds for the accepted player only, whatever type the id is sent under', () => {
        const limits = createHistoryCrawlLimits({});
        expect(limits.isCoolingDown(A)).toBe(false);
        limits.recordAccepted(A);
        expect(limits.isCoolingDown(A)).toBe(true);
        expect(limits.isCoolingDown({ membershipId: '1', membershipType: 1 })).toBe(true);
        expect(limits.isCoolingDown(B)).toBe(false);
        vi.advanceTimersByTime(119_000);
        expect(limits.isCoolingDown(A)).toBe(true);
        vi.advanceTimersByTime(1_000);
        expect(limits.isCoolingDown(A)).toBe(false);
    });
});
