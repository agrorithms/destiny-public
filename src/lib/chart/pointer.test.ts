import { describe, expect, it } from 'vitest';
import { chartFraction, isMouse, slotAt, slotCentre, tooltipLeft } from './pointer';

/**
 * The pointer arithmetic any hover-and-tap chart needs (#114, #115, moved here by #193).
 *
 * These tests used to sit in src/app/gos10k/timeline-geometry.test.ts. They moved with the
 * helpers so the shared module is tested on its own, without the Archive in sight — the
 * point of #193 is that a Tracker page can use it without importing Archive code.
 */

describe('which pointer is a mouse (#114, #115)', () => {
    // Added by #193: the helper had no test of its own. A mouse hovers and drags; a finger
    // or a pen taps, so this one answer decides which of the two a chart does.
    it('counts a mouse, and nothing else', () => {
        expect(isMouse({ pointerType: 'mouse' })).toBe(true);
        expect(isMouse({ pointerType: 'touch' })).toBe(false);
        expect(isMouse({ pointerType: 'pen' })).toBe(false);
    });
});

describe('the bucket under the pointer (#114)', () => {
    // The main chart's slots are uniform — every bar is one slot, however long its month
    // — so the bucket under the pointer is its fraction of the way across, times the
    // number of slots. The line uses the same answer as the bar beneath it, so the two
    // tooltips always name the same bucket.

    it('picks the slot the pointer is inside', () => {
        // 21 daily slots, as in February 2022's first three weeks.
        expect(slotAt(0, 21)).toBe(0);
        expect(slotAt(0.1, 21)).toBe(2);
        expect(slotAt(0.999, 21)).toBe(20);
    });

    it('gives a boundary to the slot on its right', () => {
        // Halfway across four slots is the start of the third.
        expect(slotAt(0.5, 4)).toBe(2);
    });

    it('keeps a pointer on or past either edge on the end slot', () => {
        // The pointer's last pixel measures as 100% of the width, and a pointer event can
        // land a fraction outside the box: both still mean the end bucket, not no bucket
        // and not a slot that does not exist.
        expect(slotAt(1, 4)).toBe(3);
        expect(slotAt(1.02, 4)).toBe(3);
        expect(slotAt(-0.02, 4)).toBe(0);
    });

    it('finds nothing on a chart with no slots', () => {
        expect(slotAt(0.5, 0)).toBeNull();
    });

    it("anchors the tooltip over the middle of the slot, in the chart's pixels", () => {
        // The third of four slots on a 400px chart spans 200–300px; its middle is 250.
        expect(slotCentre(2, 4, 400)).toBe(250);
        // And it is the slot slotAt() finds there, which is the pairing that matters.
        expect(slotAt(250 / 400, 4)).toBe(2);
    });
});

describe("the tooltip's left edge (#114)", () => {
    // In pixels from the chart's left. Centred over the bucket where there is room, and
    // pushed back inside the chart where there is not: the chart is the page column, so
    // inside it is inside the viewport — at 360px, and at the chart's first and last bars.

    it('centres the tooltip over its bucket when there is room', () => {
        expect(tooltipLeft(164, 100, 328)).toBe(114);
    });

    it("stops at the chart's left edge", () => {
        expect(tooltipLeft(5, 100, 328)).toBe(0);
    });

    it("stops at the chart's right edge", () => {
        expect(tooltipLeft(325, 100, 328)).toBe(228);
    });

    it('starts at the left edge when the tooltip is wider than the chart', () => {
        // Overflow on the right beats overflow on the left, where the start of the text
        // — the bucket's name — would be the part cut off.
        expect(tooltipLeft(50, 400, 328)).toBe(0);
    });
});

describe('the fraction of the way across a chart (#115)', () => {
    it('measures from the chart\'s left edge, and reads past either edge rather than clamping', () => {
        // A 400px chart starting 100px into the viewport. A captured drag goes on
        // reporting past its edges, and slotAt() is what clamps.
        const box = { left: 100, width: 400 };
        expect(chartFraction(300, box)).toBe(0.5);
        expect(chartFraction(60, box)).toBe(-0.1);
        expect(chartFraction(540, box)).toBe(1.1);
    });
});
