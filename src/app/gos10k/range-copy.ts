import type { ResolvedArchiveRange } from '@/lib/db/archive/queries';

/**
 * How the Archive page says a date and how it names the window a panel is counting.
 *
 * Shared by the page and the range control so that "clears 103–143" is phrased once.
 * Every panel states the population it counts (#81), and after #87 that population has
 * a range attached — a panel heading that said "Who helped most" with no window would
 * be the same sentence for the whole Archive and for one February.
 */

/** A `YYYY-MM-DD` or a raw period, as a reader reads it. Fixed en-GB, like the header. */
export function formatArchiveDay(date: string | null): string {
    if (date === null) return 'unknown';
    return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
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

/** `clears 103–143`, or the honest answer when the window holds none. */
export function formatClearNumberRange(range: ResolvedArchiveRange): string {
    if (range.clearFrom === null || range.clearTo === null) return 'no full clears';
    if (range.clearFrom === range.clearTo) return `clear ${range.clearFrom.toLocaleString()}`;
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
