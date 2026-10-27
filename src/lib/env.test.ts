import { afterEach, describe, expect, it, vi } from 'vitest';
import { envCount, envMs, envSeconds } from './env';

/**
 * The positive-integer env knobs. A knob that is unset, empty, zero, negative or not a number
 * falls back: a typo in an env file must not turn a threshold into 0 or NaN.
 */
const NAME = 'DFF_TEST_KNOB';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe.each([
    ['envCount', envCount],
    ['envSeconds', envSeconds],
    ['envMs', envMs],
])('%s', (_name, read) => {
    it('reads a positive integer', () => {
        vi.stubEnv(NAME, '6');

        expect(read(NAME, 5000)).toBe(6);
    });

    it('falls back when the variable is unset or empty', () => {
        expect(read(NAME, 5000)).toBe(5000);
        vi.stubEnv(NAME, '');
        expect(read(NAME, 5000)).toBe(5000);
    });

    it('falls back on zero, a negative number and text', () => {
        for (const value of ['0', '-3', 'many']) {
            vi.stubEnv(NAME, value);
            expect(read(NAME, 5000), value).toBe(5000);
        }
    });

    it('reads the digits of a number with a tail, as parseInt does', () => {
        vi.stubEnv(NAME, '12abc');

        expect(read(NAME, 5000)).toBe(12);
    });
});

/**
 * The Raid Activity page reads `ACTIVITY_MIN_RAID_RUNS` with no fallback of its own, so the
 * query's `MIN_RAID_CURVE_RUNS` stays the threshold's one default (#199): unset or unreadable
 * must come back `undefined`, never a number the page made up.
 */
describe('envCount with no fallback of its own', () => {
    it('reads the variable when it is a positive integer', () => {
        vi.stubEnv(NAME, '6');

        expect(envCount(NAME, undefined)).toBe(6);
    });

    it('leaves the default to the code it is handed to when the variable is unset or unreadable', () => {
        expect(envCount(NAME, undefined)).toBeUndefined();
        for (const value of ['', '0', 'many']) {
            vi.stubEnv(NAME, value);
            expect(envCount(NAME, undefined), value).toBeUndefined();
        }
    });
});
