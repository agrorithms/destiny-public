import { describe, expect, it } from 'vitest';
import { yearBarSegments } from './year-bar';

/**
 * The By year bar's two segments (#111): that year's Full Clears, then every other Run it
 * holds, on the scale the bar already used — the largest year's Runs.
 *
 * Pure and colocated because the two segments are the half of the bar that can be wrong
 * rather than merely ugly: a red segment scaled to the year instead of to the axis still
 * renders as a plausible bar, and it is the combined length a reader compares across rows.
 */
describe('yearBarSegments', () => {
    it('splits a year into its Full Clears and the rest, together its Runs on the shared scale', () => {
        // 2021-shaped: 2,000 Runs of which 1,500 are Full Clears, against a 4,000-Run peak.
        const segments = yearBarSegments({ runs: 2000, fullClears: 1500 }, 4000);

        expect(segments).toEqual({ fullClears: 37.5, rest: 12.5 });
        expect(segments.fullClears + segments.rest).toBe(50);
    });

    it('draws no red for a year whose Runs are all Full Clears', () => {
        expect(yearBarSegments({ runs: 300, fullClears: 300 }, 4000).rest).toBe(0);
    });

    it('is all red for a year with no Full Clears', () => {
        // November 2020's shape as a whole year: one Run, abandoned.
        expect(yearBarSegments({ runs: 1, fullClears: 0 }, 4000)).toEqual({
            fullClears: 0,
            rest: 0.025,
        });
    });

    it('fills the axis for the largest year', () => {
        const segments = yearBarSegments({ runs: 4000, fullClears: 3100 }, 4000);

        expect(segments.fullClears + segments.rest).toBe(100);
    });
});
