import { describe, expect, it } from 'vitest';
import {
    formatMeanDuration,
    formatMedianDuration,
    formatPresenceHours,
    formatPresenceShare,
    formatRunDuration,
} from './duration-copy';

/**
 * The Archive's one duration formatter (#91).
 *
 * It exists because two panels render the same column — the fastest-clears list and
 * #92's median speed board — and a second implementation is how `453` ends up on one
 * and `7:33` on the other. The tests below are therefore about the *rendering rule*
 * rather than about arithmetic: each expectation is a duration this Archive actually
 * contains, written out the way a reader of a raid time expects to see it.
 */

describe('formatting a run duration', () => {
    it('renders a sub-hour duration as minutes and seconds', () => {
        // 453s is the fastest Pinned Full Clear in the production Archive (#81's
        // reference figures) and the number #91 names in its acceptance criteria. It is
        // the worked example the whole formatter exists to get right.
        expect(formatRunDuration(453)).toBe('7:33');
        // The fixture Archive's own fastest clear, so the panel test and this one are
        // reading the same rule.
        expect(formatRunDuration(676)).toBe('11:16');
    });

    it('pads the seconds so durations line up in a column', () => {
        // Without the pad this reads '7:3', which is not a time.
        expect(formatRunDuration(423)).toBe('7:03');
        expect(formatRunDuration(60)).toBe('1:00');
    });

    it('grows an hours field rather than counting past sixty minutes', () => {
        // 18820s is the slowest Pinned Full Clear in the fixture. '313:40' would be
        // technically true and unreadable.
        expect(formatRunDuration(18820)).toBe('5:13:40');
        expect(formatRunDuration(3600)).toBe('1:00:00');
        // The minutes pad only matters once there is an hours field to its left.
        expect(formatRunDuration(3660)).toBe('1:01:00');
    });

    it('renders the boundaries rather than something clever', () => {
        expect(formatRunDuration(0)).toBe('0:00');
        expect(formatRunDuration(59)).toBe('0:59');
        expect(formatRunDuration(3599)).toBe('59:59');
    });
});

describe('formatting a median clear duration', () => {
    it('rounds the half-second an even clear count produces', () => {
        // A median over an even number of clears is the mean of the two middle ones, so
        // 725.5 is a real value the query returns (#92's top fixture row, 18 clears).
        // formatRunDuration floors, which would silently render it as the lower of the
        // two middles on every even-count row — the plausible wrong number this
        // codebase cares about. Rounding is the decision, made here once.
        expect(formatMedianDuration(725.5)).toBe('12:06');
        expect(formatMedianDuration(731)).toBe('12:11');
    });

    it('renders a whole-second median exactly as any other duration', () => {
        // An odd clear count is a real clear's own duration, so the two formatters must
        // not disagree about it: this is the same rule, reached through the wrapper.
        expect(formatMedianDuration(763)).toBe(formatRunDuration(763));
        expect(formatMedianDuration(1039)).toBe('17:19');
    });
});

describe('formatting a Helper\'s presence in hours', () => {
    it('renders tens of hours to one decimal', () => {
        // The fixture's top row: 104,118 seconds alongside him across 98 clears. The
        // same number through formatRunDuration reads `28:55:18`, which looks like one
        // absurdly long raid rather than a season of them.
        expect(formatPresenceHours(104118)).toBe('28.9 h');
        expect(formatPresenceHours(3600)).toBe('1.0 h');
    });

    it('separates a real nothing from a rounded something', () => {
        // Both are reachable on the show-all view. `0 h` is a Helper who left before he
        // arrived — clear 102's pharaloover#4706 is exactly this — and `<0.1 h` is a
        // Helper who was there, briefly. Rendering both as `0.0 h` would say the same
        // thing about two different rows.
        expect(formatPresenceHours(0)).toBe('0 h');
        expect(formatPresenceHours(1)).toBe('<0.1 h');
        expect(formatPresenceHours(359)).toBe('<0.1 h');
        expect(formatPresenceHours(360)).toBe('0.1 h');
    });

    it('clamps a negative to zero rather than rendering it', () => {
        // Unreachable through the query, which floors each Run's overlap at zero — the
        // clamp is here for the same reason formatRunDuration has one.
        expect(formatPresenceHours(-1)).toBe('0 h');
    });
});

describe('formatting an average clear duration', () => {
    it('rounds rather than floors, as a median does', () => {
        // The presence strip's averages are totals divided by a clear count, so they are
        // fractional on almost every range. The fixture's average clear is 539,209 / 346
        // = 1,558.41 seconds.
        expect(formatMeanDuration(539209 / 346)).toBe('25:58');
        expect(formatMeanDuration(1558.5)).toBe('25:59');
        expect(formatMeanDuration(1558)).toBe(formatRunDuration(1558));
    });
});

describe('formatting his share of the clears', () => {
    it('renders one decimal, so the reference figure reads as itself', () => {
        // Production is 91.55%. Rounded to a whole number that prints 92% against #81's
        // "roughly 91%", and a reader checking the page against the spec sees a
        // disagreement that is only a rounding choice. The fixture is 494,153 / 539,209.
        expect(formatPresenceShare(0.915507234335085)).toBe('91.6%');
        expect(formatPresenceShare(494153 / 539209)).toBe('91.6%');
    });

    it('renders the whole Run as 100%, never more', () => {
        expect(formatPresenceShare(1)).toBe('100%');
        expect(formatPresenceShare(1.2)).toBe('100%');
    });

    it('never renders NaN for a range with no clears', () => {
        // November 2020 is 0 of 0 seconds. The panel guards on the clear count, but a
        // formatter that can print `NaN%` is the one place that guard is not visible.
        expect(formatPresenceShare(Number.NaN)).toBe('—');
        expect(formatPresenceShare(0)).toBe('0%');
    });
});
