import type { ResolvedArchiveRange } from '@/lib/db/archive/queries';

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

/** The long form the header uses for the Archive's own span: `4 July 2020`. */
export function formatArchiveTimestamp(unixSeconds: number | null): string {
    if (unixSeconds === null) return 'unknown';
    return formatUtcDate(unixSeconds * 1000, 'long');
}

/**
 * The one `toLocaleDateString` call in this file, so the options that make it UTC-safe
 * are stated once. Both public formatters differ only in how long the month is.
 */
function formatUtcDate(ms: number, month: 'short' | 'long'): string {
    return new Date(ms).toLocaleDateString('en-GB', {
        year: 'numeric',
        month,
        day: 'numeric',
        timeZone: 'UTC',
    });
}

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
