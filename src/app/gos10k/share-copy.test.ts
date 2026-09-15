import { describe, expect, it } from 'vitest';
import { formatClearTimeShare } from './duration-copy';
import { formatShare } from './share-copy';

/**
 * The page's one percentage rule. Its rounding, `.0` and `NaN` cases are pinned through
 * the presence strip's name in ./duration-copy.test.ts, where they were first written;
 * this file pins that the two names are one function, and the case the class split (#94)
 * brought with it.
 */
describe('formatShare', () => {
    it('is the function the presence strip renders its share with', () => {
        expect(formatClearTimeShare).toBe(formatShare);
    });

    it('keeps a small class share visible', () => {
        // Production's unknown class: 167 of 79,168 characters. A whole-number rule prints
        // 0%, which says nobody brought one.
        expect(formatShare(167 / 79168)).toBe('0.2%');
        expect(formatShare(34821 / 79168)).toBe('44%');
    });
});
