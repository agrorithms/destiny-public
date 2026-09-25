import { monthIndex, monthIndexAt, monthKey } from '@/lib/db/archive/month-keys';
import { SECONDS_PER_DAY, type TimelineBucketSize, type TimelineBucketSlot } from '@/lib/db/archive/timeline-buckets';
import { formatArchiveDayOfMonth, formatArchiveMonth } from './range-copy';

/**
 * Where things sit on the timeline's x-axes (#88, #113), as percentages of their width.
 *
 * There are two axes. The **whole-Archive axis** is every month of the history — 68 in
 * the fixture, 68 in production too. Unfiltered it carries the cumulative line and the
 * monthly bars; under a range it is the overview strip's, and carries the band shading
 * the range ({@link timelineBand}, {@link yearTicks}). The **zoomed axis** is the range's
 * own buckets, days, weeks or months, and only needs its labels placed
 * ({@link zoomedTicks}). The positioning arithmetic is here rather than in the component
 * so that bars, band and labels on one axis are placed by one calculation.
 *
 * **The hover tooltip reads this module in the browser (#114)** — which bucket a pointer
 * is over and where its box goes ({@link slotAt}, {@link slotCentre}, {@link tooltipLeft}) — so it is part of
 * the page's one client bundle. Nothing here, or in what it imports, may reach the
 * database: `@/lib/db/archive/queries` opens better-sqlite3, so anything on this module's
 * import path — ./range-copy.ts included — takes only types from it.
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

/** A label under the zoomed chart, at the position of the boundary it names. */
export interface TimelineTick {
    label: string;
    percent: number;
}

/**
 * The most labels the zoomed axis draws. Six month labels fit a 328px chart with room
 * between them — the widest is `Sept 2022`, en-GB's four-letter September, at about 46px;
 * more would touch on a phone, and the caption beside the chart states the range's two
 * ends in full anyway. The tightest spacing thinning leaves on any monthly axis the
 * Archive can draw is 1/7 of the width, about 47px, so no two labels overlap even then.
 */
export const MAX_ZOOMED_TICKS = 6;

/**
 * No label starts past this point on the zoomed axis. A label runs rightwards from its
 * boundary, and the widest one is about 46px — 14% of a 328px chart — so one starting at
 * 97% ran off the panel. The whole-Archive axis solves the same problem by flipping its
 * last year label ({@link yearTicks}' caller); the zoomed one drops the label instead,
 * because a flipped label would land on the one before it once there are six of them.
 */
export const LAST_ZOOMED_TICK_PERCENT = 85;

/**
 * The shortest monthly axis labelled by year rather than by month.
 *
 * Years only while they are guaranteed to give the axis several labels. The worst case
 * is an axis starting in February, whose first January is eleven slots in: at 48 slots
 * that January, the next and the one after (slots 11, 23 and 35) all fall inside
 * {@link LAST_ZOOMED_TICK_PERCENT} — three labels. The shortest monthly axis is 25
 * months, and year labels there could leave one: February 2021 to February 2023 put
 * January 2022 at 44% and January 2023 at 96%, past the cut-off. Below this, every
 * few months is labelled instead, which a 25-month axis has plenty of.
 */
export const YEAR_LABELS_FROM_MONTHS = 48;

/**
 * The zoomed chart's labels (#113): months under weekly buckets and under monthly ones
 * shorter than {@link YEAR_LABELS_FROM_MONTHS}, years under longer monthly ones, days
 * under daily ones — each at the boundary it names, thinned to at most
 * {@link MAX_ZOOMED_TICKS} and kept clear of the right-hand edge.
 *
 * **No label is pinned to the origin to stand in for a boundary that is not on the
 * axis**, unlike {@link yearTicks}' first year. On the whole Archive that label has six
 * months of room; on a zoomed axis the first real boundary can be one bucket along, and
 * two labels that close collide at 360px. The caption states where the range begins. A
 * boundary that *is* the origin — the 1st of a monthly axis's first month, a daily
 * axis's first day — is labelled like any other, because the thinning keeps the next
 * label a stride away from it.
 *
 * Positioned by slot, like the bars: a boundary's slot index plus how far through that
 * slot it falls, over the number of slots. Weeks and days are uniform, so that is time;
 * months are not, and the bars treat every month as one slot, so the labels must too.
 */
export function zoomedTicks(size: TimelineBucketSize, slots: TimelineBucketSlot[]): TimelineTick[] {
    if (slots.length === 0) return [];

    const byYear = size === 'month' && slots.length >= YEAR_LABELS_FROM_MONTHS;
    const unit = size === 'day' ? 'day' : byYear ? 'year' : 'month';
    const onAxis = labelBoundaries(unit, slots[0].start, slots[slots.length - 1].end)
        .map((boundary) => ({ label: boundary.label, percent: slotPercent(slots, boundary.at) }))
        .filter((tick) => tick.percent <= LAST_ZOOMED_TICK_PERCENT);

    // Every nth, from the first: evenly spaced, which a cap that kept the first six would
    // not be — those would crowd the left-hand end of the axis and leave the rest bare.
    const stride = Math.ceil(onAxis.length / MAX_ZOOMED_TICKS);
    return onAxis.filter((_, index) => index % stride === 0);
}

/**
 * The instants that get a label on a zoomed axis `[from, to)`, with the label each gets:
 * each January for years, each 1st for months, each day for days.
 */
function labelBoundaries(
    unit: 'year' | 'month' | 'day',
    from: number,
    to: number
): Array<{ at: number; label: string }> {
    const boundaries: Array<{ at: number; label: string }> = [];

    if (unit === 'day') {
        for (let at = from; at < to; at += SECONDS_PER_DAY) {
            boundaries.push({ at, label: formatArchiveDayOfMonth(at) });
        }
        return boundaries;
    }

    // Absolute month indices, month-keys' convention: a year's boundaries are every
    // twelfth index from its January, a month's every index. Stepping indices rather
    // than timestamps means no month length and no day-of-month to overflow from.
    const byYear = unit === 'year';
    const firstIndex = monthIndexAt(new Date(from * 1000));
    const step = byYear ? 12 : 1;
    for (let index = byYear ? firstIndex - (firstIndex % 12) : firstIndex; ; index += step) {
        const key = monthKey(index);
        const at = Date.parse(`${key}-01T00:00:00Z`) / 1000;
        if (at >= to) return boundaries;
        if (at < from) continue;
        boundaries.push({ at, label: byYear ? key.slice(0, 4) : formatArchiveMonth(key) });
    }
}

/**
 * The values of the `data-timeline-part` attribute on the main chart's two SVGs (#114):
 * the server component sets them, the hover wrapper reads them, and the browser spec
 * finds each half by them. Stated once so a misspelling on either side fails `tsc`
 * rather than silently leaving one half without a tooltip.
 */
export type TimelinePart = 'line' | 'bar';

/**
 * Which of `count` slots a pointer `fraction` of the way across the main chart is over,
 * or null when there are none (#114) — the bucket a tooltip describes.
 *
 * By slot, like the bars, so it is one calculation for both the line and the bars: the
 * line's point for a bucket is drawn at its slot's right-hand edge, and the vertex
 * nearest the pointer is half a slot off the bar beneath it. Picking the slot instead
 * means hovering the line and hovering the bar under it always name the same bucket.
 *
 * Clamped to the end slots, because the pointer's last pixel measures as 100% of the
 * width and a pointer event can land a fraction outside the box.
 */
export function slotAt(fraction: number, count: number): number | null {
    if (count === 0) return null;
    return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}

/**
 * Where the tooltip for slot `index` of `count` points, in pixels from the chart's left
 * (#114): the middle of the slot, which is where its bar is drawn. {@link slotAt}'s
 * inverse, here beside it so the two cannot disagree about where a slot is.
 */
export function slotCentre(index: number, count: number, chartWidth: number): number {
    return ((index + 0.5) / count) * chartWidth;
}

/**
 * The tooltip's left edge in pixels from the chart's left (#114): centred over `anchor`
 * where there is room, and slid back inside the chart where there is not.
 *
 * The chart is the page column, so inside the chart is inside the viewport — at 360px
 * and at the chart's first and last bars, which is where a centred box would hang off.
 * A tooltip wider than the chart starts at its left edge: the bucket's name leads the
 * text, and overflow on the right cuts the end of it rather than the start.
 */
export function tooltipLeft(anchor: number, tooltipWidth: number, chartWidth: number): number {
    const furthest = Math.max(0, chartWidth - tooltipWidth);
    return Math.min(furthest, Math.max(0, anchor - tooltipWidth / 2));
}

/** Where an instant sits on a zoomed axis, as a percentage of its width. */
function slotPercent(slots: TimelineBucketSlot[], at: number): number {
    const index = slots.findIndex((slot) => at < slot.end);
    const slot = slots[index];
    return ((index + (at - slot.start) / (slot.end - slot.start)) / slots.length) * 100;
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
