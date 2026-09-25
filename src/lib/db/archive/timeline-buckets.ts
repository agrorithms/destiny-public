/**
 * The zoomed timeline's buckets (#113) — how big each bar is, and where each one sits.
 *
 * Unfiltered, the timeline is the whole Archive in calendar months and needs none of this
 * (`getMonthlyClears()` and ./month-keys.ts). Under a range the chart zooms to the range,
 * and a fixed monthly bucket stops working: a three-week range would draw as one bar. So
 * the bucket size follows the range's length, and this module decides it. The one thing
 * the monthly charts take from here is their months' edges ({@link monthSlots}), which a
 * drag across them needs (#115).
 *
 * Here rather than in a UI module for the same reason ./month-keys.ts is: the query
 * decides what a bucket is, and everything downstream reads that decision. Pure and
 * connectionless, like ./predicates.ts and ./range.ts, and it reads no clock — every
 * instant arrives from the resolved range or the Archive's span.
 *
 * Everything is UTC, like `period` and like every date the range filter parses.
 */

import { monthStart } from './month-keys';

export type TimelineBucketSize = 'month' | 'week' | 'day';

/** Shared with the zoomed axis's day labels, which step through the same days. */
export const SECONDS_PER_DAY = 86_400;

/**
 * Days are used up to the longest three calendar months (July to September, 92 days).
 * "Three months" is how the ticket states the threshold, and a reader who selects exactly
 * three calendar months should get the same bars whichever three they pick.
 */
const MOST_DAYS_DRAWN_AS_DAYS = 92;

/**
 * Weeks are used up to the longest two calendar years (two years with a leap day in
 * them, 731 days) — the same reading of the ticket's "about two years" as above.
 */
const MOST_DAYS_DRAWN_AS_WEEKS = 731;

/**
 * The bucket size for a range, from how many UTC calendar days it touches.
 *
 * Calendar days rather than the seconds between the two ends, because a Clear Number
 * range is bounded by two Runs' own instants: late on 1 July to early on 30 September is
 * barely 90 days of seconds but touches the same 92 days as the date range 1 July to
 * 30 September, and the two must draw the same bars.
 *
 * Each threshold is "more than": a range of exactly three calendar months stays in days,
 * and exactly two calendar years stays in weeks.
 */
export function chooseBucketSize(fromSeconds: number, toSeconds: number): TimelineBucketSize {
    const days = dayIndex(toSeconds) - dayIndex(fromSeconds) + 1;
    if (days > MOST_DAYS_DRAWN_AS_WEEKS) return 'month';
    if (days > MOST_DAYS_DRAWN_AS_DAYS) return 'week';
    return 'day';
}

/** One bucket's place in time: `[start, end)` in unix seconds, UTC. */
export interface TimelineBucketSlot {
    start: number;
    /** Exclusive, and always the next slot's `start`: the slots are laid end to end. */
    end: number;
}

/**
 * Every bucket of `size` from the one holding `fromSeconds` to the one holding
 * `toSeconds`, in order, whether or not anything happened in it.
 *
 * Contiguous by construction, like the months `getMonthlyClears()` fills in: an empty
 * bucket keeps its slot, so the space between two bars is time rather than a missing
 * row. The first and last slots can reach past the range — a range starting on a
 * Wednesday still has a week starting on the Monday — and the query counts only the
 * clears inside the range, so a partly covered bucket is a short bar, not a wrong one.
 *
 * Each slot starts at the *start* of its calendar unit and each next one is computed
 * from that start, never by adding a fixed length: months are not a fixed length, and
 * stepping a timestamp by 30 days is how a month is skipped or counted twice.
 */
export function bucketSlots(
    size: TimelineBucketSize,
    fromSeconds: number,
    toSeconds: number
): TimelineBucketSlot[] {
    const slots: TimelineBucketSlot[] = [];
    let start = bucketStart(size, fromSeconds);
    while (start <= toSeconds) {
        const end = nextBucketStart(size, start);
        slots.push({ start, end });
        start = end;
    }
    return slots;
}

/**
 * One slot per `YYYY-MM` key, in the order given (#115): the edges of the whole-Archive
 * chart's and the overview strip's months, which the monthly read keys but never bounds.
 *
 * Built from the keys rather than from the Archive's span, so the slots line up with the
 * bars one for one by construction. A drag across those bars reads the dates it writes
 * off these.
 */
export function monthSlots(months: string[]): TimelineBucketSlot[] {
    return months.map((month) => {
        const start = monthStart(month);
        return { start, end: nextBucketStart('month', start) };
    });
}

/** The start of the bucket an instant falls in. */
function bucketStart(size: TimelineBucketSize, unixSeconds: number): number {
    if (size === 'month') {
        const instant = new Date(unixSeconds * 1000);
        return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1) / 1000;
    }
    const day = dayIndex(unixSeconds);
    if (size === 'day') return day * SECONDS_PER_DAY;
    // Day 0 of the epoch, 1 January 1970, was a Thursday — three days after a Monday —
    // so `(day + 3) % 7` is how many days a day sits after the Monday that starts its week.
    return (day - ((day + 3) % 7)) * SECONDS_PER_DAY;
}

/** The start of the bucket after the one starting at `start`. */
function nextBucketStart(size: TimelineBucketSize, start: number): number {
    if (size === 'month') {
        // `Date.UTC` rolls month 12 over into January of the next year, and the day is
        // the 1st, so there is no day-of-month for the step to overflow from.
        const instant = new Date(start * 1000);
        return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1) / 1000;
    }
    return start + (size === 'week' ? 7 : 1) * SECONDS_PER_DAY;
}

/** Whole UTC days since the epoch. */
function dayIndex(unixSeconds: number): number {
    return Math.floor(unixSeconds / SECONDS_PER_DAY);
}
