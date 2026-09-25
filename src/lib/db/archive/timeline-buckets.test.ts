import { describe, expect, it } from 'vitest';
import { bucketSlots, chooseBucketSize, monthSlots } from './timeline-buckets';

/**
 * The zoomed timeline's buckets (#113): how big each bar is, and where each one starts.
 *
 * Pure and colocated. The bucket choice is the half of the zoom that goes wrong silently —
 * a three-week range drawn with monthly buckets is one bar, and it renders perfectly — so
 * each threshold is pinned on both sides of its boundary here.
 */

/** The first instant of a UTC day, in seconds — the shape a date range's `periodFrom` has. */
const startOf = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 1000;
/** The last instant of a UTC day, in seconds — the shape a date range's `periodTo` has. */
const endOf = (iso: string): number => Date.parse(`${iso}T23:59:59.999Z`) / 1000;

describe('choosing the bucket size', () => {
    it('uses days for a range of three calendar months or less', () => {
        // July to September is 92 days, the longest three calendar months there are.
        expect(chooseBucketSize(startOf('2022-07-01'), endOf('2022-09-30'))).toBe('day');
        // The case the ticket names: a three-week range must not collapse into one bar.
        expect(chooseBucketSize(startOf('2022-02-01'), endOf('2022-02-21'))).toBe('day');
    });

    it('uses weeks once a range is longer than three calendar months', () => {
        // 93 days: one day past the longest three-month window.
        expect(chooseBucketSize(startOf('2022-07-01'), endOf('2022-10-01'))).toBe('week');
    });

    it('uses weeks for a range of two calendar years or less', () => {
        // 2023 and 2024 together are 731 days, the longest two calendar years there are.
        expect(chooseBucketSize(startOf('2023-01-01'), endOf('2024-12-31'))).toBe('week');
    });

    it('uses months once a range is longer than two calendar years', () => {
        // 732 days: one day past the longest two-year window.
        expect(chooseBucketSize(startOf('2023-01-01'), endOf('2025-01-01'))).toBe('month');
    });

    it('counts the calendar days a Clear Number range touches, not the seconds between its ends', () => {
        // A Clear Number range is bounded by two Runs' own instants, not by whole days.
        // Late on 1 July to early on 30 September touches the same 92 days as the date
        // range above, and must land on the same side of the boundary.
        const lateOnFirst = Date.parse('2022-07-01T23:00:00Z') / 1000;
        const earlyOnLast = Date.parse('2022-09-30T01:00:00Z') / 1000;
        expect(chooseBucketSize(lateOnFirst, earlyOnLast)).toBe('day');

        const earlyOnNinetyThird = Date.parse('2022-10-01T01:00:00Z') / 1000;
        expect(chooseBucketSize(lateOnFirst, earlyOnNinetyThird)).toBe('week');
    });

    it('uses days for a single-day range', () => {
        expect(chooseBucketSize(startOf('2022-02-14'), endOf('2022-02-14'))).toBe('day');
    });
});

/** A slot's start as the `YYYY-MM-DD` it begins on, so failures read as dates. */
const day = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

describe('the bucket slots', () => {
    it('starts weeks on a Monday, UTC', () => {
        // 2022-02-01 was a Tuesday and 2022-02-20 a Sunday: both belong to the week that
        // began the Monday before them, so the first slot starts in January.
        const slots = bucketSlots('week', startOf('2022-02-01'), endOf('2022-02-20'));

        expect(slots.map((slot) => day(slot.start))).toEqual([
            '2022-01-31', '2022-02-07', '2022-02-14',
        ]);
        expect(day(slots[slots.length - 1].end)).toBe('2022-02-21');
    });

    it('starts a week on the Monday itself, not the one before it', () => {
        const slots = bucketSlots('week', startOf('2022-02-07'), endOf('2022-02-07'));

        expect(slots.map((slot) => day(slot.start))).toEqual(['2022-02-07']);
    });

    it('starts months on the first of the month and lets them be their own length', () => {
        const slots = bucketSlots('month', startOf('2023-12-15'), endOf('2024-03-02'));

        expect(slots.map((slot) => day(slot.start))).toEqual([
            '2023-12-01', '2024-01-01', '2024-02-01', '2024-03-01',
        ]);
        // February 2024 is a leap February: 29 days, not 28 and not a fixed 30.
        expect((slots[2].end - slots[2].start) / 86_400).toBe(29);
    });

    it('gives every day in the range its own slot, empty or not', () => {
        // Nothing here knows which days hold clears, which is the point: an empty day
        // still occupies its place on the axis, so the space between two bars is time.
        const slots = bucketSlots('day', startOf('2022-02-26'), endOf('2022-03-02'));

        expect(slots.map((slot) => day(slot.start))).toEqual([
            '2022-02-26', '2022-02-27', '2022-02-28', '2022-03-01', '2022-03-02',
        ]);
    });

    it('lays the slots end to end, with no gap and no overlap', () => {
        // The geometry positions by slot index, so a slot that ended a second early or
        // late would put an instant in the wrong bar, or in none.
        for (const size of ['month', 'week', 'day'] as const) {
            const slots = bucketSlots(size, startOf('2021-11-17'), endOf('2022-01-09'));
            for (let i = 1; i < slots.length; i += 1) {
                expect(slots[i].start).toBe(slots[i - 1].end);
            }
        }
    });

    it('covers both ends of a Clear Number range bounded by instants', () => {
        const from = Date.parse('2022-02-01T18:30:00Z') / 1000;
        const to = Date.parse('2022-02-03T02:15:00Z') / 1000;
        const slots = bucketSlots('day', from, to);

        expect(slots[0].start).toBeLessThanOrEqual(from);
        expect(slots[slots.length - 1].end).toBeGreaterThan(to);
        expect(slots).toHaveLength(3);
    });
});

describe('the month slots (#115)', () => {
    // The whole-Archive chart and the overview strip are keyed `YYYY-MM` and carry no
    // instants. A drag across them needs each month's edges, one slot per key.

    it('gives each month key its own slot, from its 1st to the next month\'s 1st', () => {
        const slots = monthSlots(['2020-11', '2020-12', '2021-01']);

        expect(slots.map((slot) => day(slot.start))).toEqual(['2020-11-01', '2020-12-01', '2021-01-01']);
        // December's end is January's start, across the year boundary.
        expect(slots.map((slot) => day(slot.end))).toEqual(['2020-12-01', '2021-01-01', '2021-02-01']);
    });

    it('lets February be its own length, leap years included', () => {
        const [leap, common] = monthSlots(['2024-02', '2023-02']);

        expect((leap.end - leap.start) / 86_400).toBe(29);
        expect((common.end - common.start) / 86_400).toBe(28);
    });

    it('gives no slots for no months', () => {
        expect(monthSlots([])).toEqual([]);
    });
});
