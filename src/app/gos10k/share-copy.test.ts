import { describe, expect, it } from 'vitest';
import { formatShare } from './share-copy';

/**
 * The page's one percentage rule (#89, #94).
 *
 * Both panels that print a share read this one function — the presence strip's share of
 * the clears' time and the class split's share of the characters — so the rule is pinned
 * here once rather than per panel. The presence-strip figures below were written against
 * #89 and moved with the function when the class split made it the second caller; they
 * stay because they are the reference figures a reader checks the page against.
 */
describe('formatShare', () => {
    it('renders one decimal, so the reference figure reads as itself', () => {
        // Production is 91.55%. Rounded to a whole number that prints 92% against #81's
        // "roughly 91%", and a reader checking the page against the spec sees a
        // disagreement that is only a rounding choice. The fixture is 494,153 / 539,209.
        expect(formatShare(0.915507234335085)).toBe('91.6%');
        expect(formatShare(494153 / 539209)).toBe('91.6%');
    });

    it('drops the decimal on an exact figure', () => {
        expect(formatShare(1)).toBe('100%');
        expect(formatShare(0)).toBe('0%');
    });

    it('shows an impossible share rather than clamping it away', () => {
        // Presence over 100% of a Run is a data fault. Clamped, it would render as a
        // clean 100% and nobody would look; unclamped, the page says something is wrong.
        expect(formatShare(1.04)).toBe('104%');
    });

    it('never renders NaN for a range with no clears', () => {
        // November 2020 is 0 of 0 seconds. The panel guards on the clear count, but a
        // formatter that can print `NaN%` is the one place that guard is not visible.
        expect(formatShare(Number.NaN)).toBe('—');
    });

    it('keeps a small class share visible', () => {
        // Production's unknown class: 167 of 79,168 characters. A whole-number rule prints
        // 0%, which says nobody brought one.
        expect(formatShare(167 / 79168)).toBe('0.2%');
        expect(formatShare(34821 / 79168)).toBe('44%');
    });
});
