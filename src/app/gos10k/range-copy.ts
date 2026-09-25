import type { ResolvedArchiveRange } from '@/lib/db/archive/queries';
import { formatArchiveDate } from '@/lib/db/archive/range';
import type { TimelineBucketSize } from '@/lib/db/archive/timeline-buckets';

/**
 * How the Archive page says a date and how it names the window a panel is counting.
 *
 * Shared by the page and the range control so that "clears 103–143" is phrased once.
 * Every panel states the population it counts (#81), and after #87 that population has
 * a range attached — a panel heading that said "Who helped most" with no window would
 * be the same sentence for the whole Archive and for one February.
 */

/**
 * A `YYYY-MM-DD`, as a reader reads it: `1 Feb 2022`.
 *
 * `timeZone: 'UTC'` on every formatter in this file, and it is load-bearing rather than
 * tidy: `period` is UTC and so is every date the range filter parses, so formatting in
 * the server's local zone would print the previous day for any Run in the small hours —
 * and would print a *different* day on a box in another zone.
 */
export function formatArchiveDay(date: string | null): string {
    if (date === null) return 'unknown';
    // Noon rather than midnight: the instant only has to land inside the right UTC day,
    // and the middle of it is the one that cannot be moved by a rounding surprise.
    return formatUtcDate(new Date(`${date}T12:00:00Z`).getTime(), 'short');
}

/**
 * A `YYYY-MM` bucket key as a reader reads it: `Feb 2022`.
 *
 * Through the same UTC-pinned formatter as every other date on this page, rather than
 * formatting a whole day and stripping the number off the front: a label built by regex
 * is coupled to `en-GB` putting the day first, so changing the locale — or asking for a
 * long month — would quietly produce a wrong label instead of a compile error.
 */
export function formatArchiveMonth(month: string): string {
    // The 15th rather than the 1st: any day inside the month names the same month, and
    // the middle of it cannot be moved across a boundary by a rounding surprise.
    return MONTH_FORMAT.format(new Date(`${month}-15T12:00:00Z`));
}

/**
 * A day without its year, `14 Feb` — the zoomed timeline's day labels (#113).
 *
 * Yearless because it only ever labels an axis of three months or less, whose year the
 * caption beside it already states, and every character counts under a 360px chart.
 */
export function formatArchiveDayOfMonth(unixSeconds: number): string {
    return DAY_OF_MONTH_FORMAT.format(new Date(unixSeconds * 1000));
}

/**
 * One zoomed-timeline bucket named by its start, standing alone (#113, #114): `Feb 2022`,
 * `week of 14 Feb 2022`, or `14 Feb 2022` — the tooltip's label. A week is named by its
 * Monday, and says it is a week, because "14 Feb 2022" alone under a weekly chart reads as
 * the one day.
 */
export function formatTimelineBucketLabel(size: TimelineBucketSize, start: number): string {
    const day = formatArchiveDate(start);
    if (size === 'month') return formatArchiveMonth(day.slice(0, 7));
    if (size === 'week') return `week of ${formatArchiveDay(day)}`;
    return formatArchiveDay(day);
}

/**
 * The same name inside a sentence: "busiest was 40 in `the week of 31 Jan 2022`". Only a
 * week takes the article — a month or a day is already a proper name.
 */
export function formatTimelineBucketInSentence(size: TimelineBucketSize, start: number): string {
    const label = formatTimelineBucketLabel(size, start);
    return size === 'week' ? `the ${label}` : label;
}

/** The long form the header uses for the Archive's own span: `4 July 2020`. */
export function formatArchiveTimestamp(unixSeconds: number | null): string {
    if (unixSeconds === null) return 'unknown';
    return formatUtcDate(unixSeconds * 1000, 'long');
}

/**
 * The two day formatters differ only in how long the month is, so the options that make
 * them UTC-safe are stated once here.
 */
function formatUtcDate(ms: number, month: 'short' | 'long'): string {
    return (month === 'short' ? SHORT_DAY_FORMAT : LONG_DAY_FORMAT).format(new Date(ms));
}

/**
 * Every formatter above, built once. `toLocaleDateString` with options constructs a new
 * `Intl.DateTimeFormat` per call — about 50µs each — and the timeline formats one label
 * per bucket and per axis boundary, a hundred or more per request. Each one pins
 * `timeZone: 'UTC'`, for the reason {@link formatArchiveDay} gives.
 */
const DAY_FORMAT_OPTIONS = { year: 'numeric', day: 'numeric', timeZone: 'UTC' } as const;
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { ...DAY_FORMAT_OPTIONS, month: 'short' });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { ...DAY_FORMAT_OPTIONS, month: 'long' });
const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_OF_MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** `1 Feb 2022 – 21 Feb 2022`, or a single day when both ends are the same. */
export function formatArchiveDayRange(range: ResolvedArchiveRange): string {
    if (range.dateFrom === null || range.dateTo === null) return 'the whole Archive';
    if (range.dateFrom === range.dateTo) return formatArchiveDay(range.dateFrom);
    return `${formatArchiveDay(range.dateFrom)} – ${formatArchiveDay(range.dateTo)}`;
}

/**
 * `clear 9,701` — one Run's place in the 10,000.
 *
 * Named rather than inlined because two callers render it: the range control's own
 * single-clear window, and each row of the fastest-clears list, which ties a record back
 * to that control in the control's own denomination (ADR 0008). Two spellings of the
 * same label on one page is exactly the failure duration-copy.ts exists to prevent.
 */
export function formatClearNumber(clearNumber: number): string {
    return `clear ${clearNumber.toLocaleString()}`;
}

/** `clears 103–143`, or the honest answer when the window holds none. */
export function formatClearNumberRange(range: ResolvedArchiveRange): string {
    if (range.clearFrom === null || range.clearTo === null) return 'no full clears';
    if (range.clearFrom === range.clearTo) return formatClearNumber(range.clearFrom);
    return `clears ${range.clearFrom.toLocaleString()}–${range.clearTo.toLocaleString()}`;
}

/**
 * The window a panel is counting over, for a panel's own copy: "the whole Archive", or
 * the active range in both of its expressions.
 */
export function describeArchiveRange(range: ResolvedArchiveRange): string {
    if (range.mode === 'all') return 'the whole Archive';
    return `${formatClearNumberRange(range)} · ${formatArchiveDayRange(range)}`;
}
