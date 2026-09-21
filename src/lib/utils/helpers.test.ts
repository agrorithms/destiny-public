import { describe, expect, it } from 'vitest';
import { formatRunDuration } from './helpers';

/**
 * The one run-duration formatter (#109).
 *
 * It lives here rather than beside either page because both databases render this
 * column: the Archive's fastest-clears list and median speed board, and the Tracker's
 * player profile. Two implementations of `m:ss` is how the same number ends up reading
 * `7:33` on one surface and `453` — or `7:3` — on another.
 *
 * The Archive's rendering rules are already covered by
 * `src/app/gos10k/duration-copy.test.ts`, which now exercises this function through the
 * re-export. What is new here is the nullish branch, which is the Tracker's: before the
 * extraction its `formatDuration` was private and untested, and `'N/A'` for a missing
 * average is a rendering decision a passing suite should notice being changed.
 */

describe('formatting a run duration', () => {
    it('renders a sub-hour duration as unpadded minutes and padded seconds', () => {
        expect(formatRunDuration(453)).toBe('7:33');
        // Without the pad this reads '7:3', which is not a time.
        expect(formatRunDuration(423)).toBe('7:03');
        expect(formatRunDuration(60)).toBe('1:00');
    });

    it('grows an hours field rather than counting past sixty minutes', () => {
        expect(formatRunDuration(18820)).toBe('5:13:40');
        expect(formatRunDuration(3600)).toBe('1:00:00');
        expect(formatRunDuration(3599)).toBe('59:59');
    });

    it('floors a fractional duration and clamps a negative one', () => {
        // The Tracker's avgCompletionSeconds is a SQL AVG() and arrives fractional; the
        // Archive's duration_seconds is an integer column. Flooring is what both sides
        // did before the extraction, so neither rendering moves.
        expect(formatRunDuration(453.9)).toBe('7:33');
        // A formatter that can emit '-1:-1' for a bad row is worse than one reading 0:00.
        expect(formatRunDuration(-5)).toBe('0:00');
        expect(formatRunDuration(0)).toBe('0:00');
    });

    it("renders a missing duration as 'N/A' by default", () => {
        // The Tracker's profile page renders these three columns from LEFT JOINs that
        // can legitimately return no rows. 'N/A' is what it printed before #109 and what
        // it must keep printing.
        expect(formatRunDuration(null)).toBe('N/A');
        expect(formatRunDuration(undefined)).toBe('N/A');
    });

    it('lets a caller choose its own text for a missing duration', () => {
        // The fallback is a parameter rather than a second function so that there is
        // still exactly one place the digits are assembled.
        expect(formatRunDuration(null, '—')).toBe('—');
    });
});
