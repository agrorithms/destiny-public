import { describe, expect, it } from 'vitest';
import {
    ESTIMATE_TAIL,
    activitySlots,
    slotAtFraction,
    slotCentreFraction,
    tooltipText,
    type ActivitySlot,
} from './activity-tooltips';
import type { OffsetOf } from './activity-time';

/**
 * What the Raid Activity tooltips say and which step a pointer is over (#197). Worked out on
 * the server and handed to the browser as plain data, the way /gos10k's are: the number and
 * the wording are decided here, and only the clock window is finished in the browser, from the
 * step's two timestamps, because the server cannot know the reader's time zone.
 *
 * Every expected string is written out by hand from the inputs.
 */

const HOUR = 3600;
const DAY = 24 * HOUR;
// Sat 17 Oct 2026, 00:00 UTC.
const MIDNIGHT = 1792195200;
const KATHMANDU: OffsetOf = () => 345;

const point = (start: number, seconds: number, total: number, provisional = false) => ({
    start,
    end: start + seconds,
    total,
    provisional,
});

describe('the tooltip for a step', () => {
    it('says the average number of raids in progress, rounded, and the step\'s window in UTC', () => {
        const [slot] = activitySlots([point(MIDNIGHT, HOUR, 1828.4)]);

        expect(tooltipText(slot, null)).toBe('1,828 average raids in progress, Sat 17 Oct, 00:00–01:00 UTC');
    });

    it('says "raid" for an average that rounds to one, and counts a quiet step as zero', () => {
        const slots = activitySlots([point(MIDNIGHT, HOUR, 0.6), point(MIDNIGHT + HOUR, HOUR, 1.4), point(MIDNIGHT + 2 * HOUR, HOUR, 0)]);

        expect(slots.map((slot) => tooltipText(slot, null).split(',')[0])).toEqual([
            '1 average raid in progress',
            '1 average raid in progress',
            '0 average raids in progress',
        ]);
    });

    it('calls a Provisional step an estimate that is still arriving', () => {
        const [slot] = activitySlots([point(MIDNIGHT, HOUR, 1903.6, true)]);

        expect(ESTIMATE_TAIL).toBe('estimate, still arriving');
        expect(tooltipText(slot, null)).toBe('1,904 average raids in progress, Sat 17 Oct, 00:00–01:00 UTC · estimate, still arriving');
    });

    it('says nothing of estimates for a counted step', () => {
        const [slot] = activitySlots([point(MIDNIGHT, HOUR, 5)]);

        expect(tooltipText(slot, null)).not.toContain('estimate');
    });

    it('shows the window on the reader\'s clock, without the UTC suffix', () => {
        const slots = activitySlots([point(MIDNIGHT, HOUR, 1828.4), point(MIDNIGHT, HOUR, 1903.6, true)]);

        expect(tooltipText(slots[0], KATHMANDU)).toBe('1,828 average raids in progress, Sat 17 Oct, 05:45–06:45');
        expect(tooltipText(slots[1], KATHMANDU)).toBe(
            '1,904 average raids in progress, Sat 17 Oct, 05:45–06:45 · estimate, still arriving'
        );
    });

    it('words the window for each range\'s step: 10 minutes, an hour, 3 hours', () => {
        const slots = activitySlots([point(MIDNIGHT, 600, 7), point(MIDNIGHT, HOUR, 7), point(MIDNIGHT, 3 * HOUR, 7)]);

        expect(slots.map((slot) => tooltipText(slot, null).split(', ').slice(-1)[0])).toEqual([
            '00:00–00:10 UTC',
            '00:00–01:00 UTC',
            '00:00–03:00 UTC',
        ]);
    });

    it('names the weekday a 3-hour window ends on when it crosses the reader\'s midnight', () => {
        // 16:00–19:00 UTC on Friday is 21:45 Friday to 00:45 Saturday in Kathmandu.
        const [slot] = activitySlots([point(MIDNIGHT - 8 * HOUR, 3 * HOUR, 12)]);

        expect(tooltipText(slot, KATHMANDU)).toBe('12 average raids in progress, Fri 16 Oct, 21:45–Sat 00:45');
    });

    it('says the same once the slots have crossed to the browser as JSON', () => {
        // The server hands the slots to a client component, which serialises them: a slot that
        // carried anything JSON drops (a Date, a function) would finish a different sentence.
        const slots = activitySlots([point(MIDNIGHT, HOUR, 3.2, true), point(MIDNIGHT + HOUR, HOUR, 1828.4)]);
        const sent: ActivitySlot[] = JSON.parse(JSON.stringify(slots));

        expect(sent.map((slot) => tooltipText(slot, KATHMANDU))).toEqual(slots.map((slot) => tooltipText(slot, KATHMANDU)));
        expect(sent.map((slot) => tooltipText(slot, null))).toEqual([
            '3 average raids in progress, Sat 17 Oct, 00:00–01:00 UTC · estimate, still arriving',
            '1,828 average raids in progress, Sat 17 Oct, 01:00–02:00 UTC',
        ]);
    });
});

describe('which step a pointer is over', () => {
    // A 7-day window to Fri 23 Oct 20:33:16 UTC, opening Fri 16 at 20:33:16: 604,800 s wide.
    // Counting starts at Sat 17 00:00 UTC, 12,404 s in (2.0509% across), with three 1-hour
    // steps, to 3.8 % (12,404 + 10,800 s in).
    const NOW = 1792787596;
    const FROM = NOW - 7 * DAY;
    const slots = activitySlots([point(MIDNIGHT, HOUR, 1), point(MIDNIGHT + HOUR, HOUR, 2), point(MIDNIGHT + 2 * HOUR, HOUR, 3, true)]);
    const at = (fraction: number) => slotAtFraction(fraction, slots, FROM, NOW);

    it('finds the step the pointer is across, by time and not by equal share of the width', () => {
        // Step 0 spans 12,404–16,004 s: fractions 0.020509 to 0.026463. Step 1 ends at
        // 19,604 s, 0.032416; step 2 at 23,204 s, 0.038369.
        expect(at(0.0206)).toBe(0);
        expect(at(0.0264)).toBe(0);
        expect(at(0.0265)).toBe(1);
        expect(at(0.0324)).toBe(1);
        expect(at(0.0325)).toBe(2);
        expect(at(0.0383)).toBe(2);
    });

    it('is over no step before the first or after the last, where the chart is shaded or bare', () => {
        expect(at(0)).toBeNull();
        expect(at(0.0205)).toBeNull();
        expect(at(0.0384)).toBeNull();
        expect(at(0.5)).toBeNull();
        expect(at(1)).toBeNull();
        expect(at(-0.1)).toBeNull();
        expect(at(1.1)).toBeNull();
    });

    it('gives a pointer exactly on the line between two steps to the later one', () => {
        // A 4-hour window from midnight, its three steps starting at 01:00: a quarter of the
        // way across is exactly 01:00, where step 0 begins, and half way is exactly 02:00,
        // where step 0 ends and step 1 begins. A step owns its start and not its end.
        const steps = activitySlots([point(MIDNIGHT + HOUR, HOUR, 1), point(MIDNIGHT + 2 * HOUR, HOUR, 2), point(MIDNIGHT + 3 * HOUR, HOUR, 3)]);

        expect(slotAtFraction(0.25, steps, MIDNIGHT, MIDNIGHT + 4 * HOUR)).toBe(0);
        expect(slotAtFraction(0.5, steps, MIDNIGHT, MIDNIGHT + 4 * HOUR)).toBe(1);
    });

    it('is over no step in a series with none', () => {
        expect(slotAtFraction(0.5, [], FROM, NOW)).toBeNull();
        expect(slotAtFraction(0.0206, [], FROM, NOW)).toBeNull();
    });

    it('puts a step\'s anchor at the middle of its window, where the line draws its vertex', () => {
        // Step 0's middle is 12,404 + 1,800 s in; step 2's is 12,404 + 9,000 s in.
        expect(slotCentreFraction(0, slots, FROM, NOW)).toBeCloseTo(14204 / 604800, 6);
        expect(slotCentreFraction(2, slots, FROM, NOW)).toBeCloseTo(21404 / 604800, 6);
    });
});
