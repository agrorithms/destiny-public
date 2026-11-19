import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollRequestLimits } from './poll-request-limits';

// The two limits on "profile viewed" requests. Time-dependent, so fake timers throughout.
const T0 = new Date('2026-08-03T12:00:00Z').getTime();

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('the global limit', () => {
    it('allows 60 attempts a minute by default and refuses the 61st', () => {
        const limits = createPollRequestLimits({});
        for (let i = 0; i < 60; i++) expect(limits.isOverGlobalLimit()).toBe(false);
        expect(limits.isOverGlobalLimit()).toBe(true);
    });

    it('opens again when the minute is over', () => {
        const limits = createPollRequestLimits({});
        for (let i = 0; i < 61; i++) limits.isOverGlobalLimit();
        vi.advanceTimersByTime(60_000);
        expect(limits.isOverGlobalLimit()).toBe(false);
    });

    it('takes its limit from ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN', () => {
        const limits = createPollRequestLimits({ ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN: '2' });
        expect(limits.isOverGlobalLimit()).toBe(false);
        expect(limits.isOverGlobalLimit()).toBe(false);
        expect(limits.isOverGlobalLimit()).toBe(true);
    });

    it('reads an unreadable or negative value as the default of 60', () => {
        for (const raw of ['abc', '-5', '']) {
            const limits = createPollRequestLimits({ ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN: raw });
            for (let i = 0; i < 60; i++) expect(limits.isOverGlobalLimit()).toBe(false);
            expect(limits.isOverGlobalLimit()).toBe(true);
        }
    });

    it('refuses every attempt when the knob is 0', () => {
        const limits = createPollRequestLimits({ ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN: '0' });
        expect(limits.isOverGlobalLimit()).toBe(true);
    });
});

describe('the per-player cooldown', () => {
    it('is not running for a player never accepted', () => {
        expect(createPollRequestLimits({}).isCoolingDown('3:1')).toBe(false);
    });

    it('runs for 300 seconds by default, for that player only', () => {
        const limits = createPollRequestLimits({});
        limits.recordAccepted('3:1');
        expect(limits.isCoolingDown('3:1')).toBe(true);
        expect(limits.isCoolingDown('3:2')).toBe(false);
        vi.advanceTimersByTime(299_000);
        expect(limits.isCoolingDown('3:1')).toBe(true);
        vi.advanceTimersByTime(1_000);
        expect(limits.isCoolingDown('3:1')).toBe(false);
    });

    it('takes its length from ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC', () => {
        const limits = createPollRequestLimits({ ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC: '10' });
        limits.recordAccepted('3:1');
        vi.advanceTimersByTime(10_000);
        expect(limits.isCoolingDown('3:1')).toBe(false);
    });

    it('reads an unreadable value as the default of 300 seconds', () => {
        const limits = createPollRequestLimits({ ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC: 'soon' });
        limits.recordAccepted('3:1');
        vi.advanceTimersByTime(299_000);
        expect(limits.isCoolingDown('3:1')).toBe(true);
    });
});
