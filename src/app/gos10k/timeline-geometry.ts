import { monthIndex, monthIndexAt } from '@/lib/db/archive/month-keys';

/**
 * Where things sit on the timeline's shared x-axis (#88), as percentages of its width.
 *
 * The axis is the Archive's whole history — 68 months in the fixture, 68 in production
 * too — and it is shared by three things drawn on top of each other: the cumulative
 * line, the monthly bars, and the band shading the active range. #88 requires the band
 * to "read across both charts", which is only true if both are positioned by the same
 * arithmetic, so that arithmetic is one module rather than two copies in one component.
 *
 * **The month list is assumed contiguous** — every calendar month from the Archive's
 * first to its last, gaps included, which is exactly what {@link getMonthlyClears} builds.
 * That is what makes position on the axis mean position in time: a list with months
 * missing would still draw, and would draw a two-year pause as the gap between two
 * neighbouring slots. Nothing below breaks on a gapped list, but nothing below can make
 * it proportional either.
 *
 * Pure, and deliberately free of any clock read: every instant here arrives from the
 * database (`period` bounds on the resolved range) or from the month keys the query
 * built out of it. `Date` appears only to take a supplied timestamp apart into its UTC
 * parts — the same thing range-copy.ts does when it formats one. A timeline that asked
 * what today is would grow an empty tail every month against a dataset frozen in 2026.
 */

/**
 * The narrowest band that still reads as a band: one month of the axis.
 *
 * A single day of a six-year history is 0.05% of the axis — about a third of a pixel on
 * a phone. #88 requires the shaded range to stay identifiable at that width, and a band
 * a reader cannot see is indistinguishable from a filter that silently failed to apply,
 * so a narrow selection is widened.
 *
 * **One month rather than a percentage picked by eye**, because the bars underneath it
 * are months: the widened band then shades exactly the bar the selection falls in, which
 * is a sentence a reader can check against the chart. A fixed percentage has no such
 * reading, and the obvious values are worse than they look — 1.5% is *wider* than a month
 * on this 68-month axis, so it would widen almost every range anyone actually picks.
 */
export function minimumBandPercent(months: string[]): number {
    return months.length === 0 ? 0 : 100 / months.length;
}

/** The shaded extent of the active range, as percentages of the axis width. */
export interface TimelineBand {
    startPercent: number;
    endPercent: number;
}

/** A year label under the axis, at the position that year begins. */
export interface TimelineYearTick {
    year: string;
    percent: number;
}

/**
 * The band shading the active range, or null when no range is active.
 *
 * Positioned fractionally *within* a month rather than snapped to month boundaries: on
 * a 68-month axis a whole month is 1.5% of the width, so snapping would make "the first
 * week of February" and "all of February" the same picture.
 */
export function timelineBand(
    months: string[],
    range: { periodFrom: number | null; periodTo: number | null }
): TimelineBand | null {
    if (months.length === 0) return null;
    if (range.periodFrom === null || range.periodTo === null) return null;

    const start = clampPercent(axisPercent(months, range.periodFrom));
    const end = clampPercent(axisPercent(months, range.periodTo));
    const minimum = minimumBandPercent(months);

    if (end - start >= minimum) return { startPercent: start, endPercent: end };

    // Widen rightwards from the selection, then slide the band back inside the chart if
    // that pushed it off the right-hand edge. Widening off the edge is the failure this
    // guards: the Archive's last day is the most likely single-day selection anyone
    // makes, and a band drawn past 100% shades nothing at all.
    const startOfWidened = Math.max(0, Math.min(start, 100 - minimum));
    return { startPercent: startOfWidened, endPercent: startOfWidened + minimum };
}

/**
 * One tick per calendar year the axis covers, each at the position that year starts.
 *
 * The first year lands at the origin, and does so by arithmetic rather than by a special
 * case: the Archive begins in July 2020, so that year's January is six months off the
 * left-hand edge and clamps to zero. The label still belongs on the chart — the leftmost
 * bars *are* 2020 — so it sits where the chart itself begins.
 *
 * Positions come from the month *key*, never from `months.indexOf('2021-01')`: a lookup
 * returns `-1` for any year whose January is not in the list, which is a negative
 * percentage and a label off the left edge. That cannot happen against a contiguous list,
 * which is the only kind {@link getMonthlyClears} produces — but this module is exported,
 * pure, and has no way to enforce the precondition, so the arithmetic is written not to
 * need it.
 */
export function yearTicks(months: string[]): TimelineYearTick[] {
    if (months.length === 0) return [];

    const years = [...new Set(months.map((month) => month.slice(0, 4)))];
    return years.map((year) => ({
        year,
        percent: clampPercent(offsetPercent(months, monthIndex(`${year}-01`))),
    }));
}

/**
 * Where a UTC instant falls on the axis, as a percentage, without clamping.
 *
 * The month index plus how far through that month the instant is, over the number of
 * months on the axis. An instant outside the Archive's extent returns a percentage
 * outside 0–100, which is the caller's to clamp.
 */
function axisPercent(months: string[], unixSeconds: number): number {
    const instant = new Date(unixSeconds * 1000);
    const monthStart = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1);
    const nextMonthStart = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1);
    const throughMonth = (unixSeconds * 1000 - monthStart) / (nextMonthStart - monthStart);

    // The whole index from month-keys, the fraction from here: the month arithmetic has
    // one owner, and how far through a month an instant sits is the only part of this
    // that is about the axis rather than the calendar.
    return offsetPercent(months, monthIndexAt(instant) + throughMonth);
}

/**
 * Where an absolute month index sits on the axis, as a percentage, without clamping.
 *
 * Fractional indices are how an instant *within* a month is positioned, so this is the
 * one place the axis's origin and width are applied — both public functions above go
 * through it, which is what keeps the band and the year ticks on the same scale.
 */
function offsetPercent(months: string[], index: number): number {
    return ((index - monthIndex(months[0])) / months.length) * 100;
}

function clampPercent(percent: number): number {
    return Math.min(100, Math.max(0, percent));
}
