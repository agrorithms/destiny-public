/**
 * The GoS 10k Archive's global range filter — the half of it that needs no database.
 *
 * What lives here: what a URL is allowed to ask for, and what a milestone preset
 * resolves to against the Archive's own span. Both are pure functions over their
 * arguments, which is why they are here and not in ./queries.ts.
 *
 * What deliberately does *not* live here: the translation between the two expressions
 * of a range — the dates a Clear Number range spans, the Clear Numbers a date range
 * contains. That is arithmetic over the data rather than over the URL, it is computed
 * server-side per #87, and it lives in ./queries.ts where the "all SQL the app serves
 * lives in one query module per database" rule puts it.
 *
 * **One control, two modes, never combined.** Because Clear Number is defined by period
 * ascending (ADR 0008), a Clear Number range *is* a date range. ANDing them together
 * could only ever produce an empty intersection that looks like a broken page, so a URL
 * carrying both is malformed rather than resolved in either mode's favour.
 *
 * Everything below degrades rather than throws. A hand-edited or truncated link must
 * render the whole Archive, not an error and not an empty page.
 */

import { isoToUnix } from '@/lib/utils/helpers';

/** The URL parameters the control reads and writes. Both modes, four names, no overlap. */
export const RANGE_PARAMS = {
    fromDate: 'from',
    toDate: 'to',
    clearFrom: 'clearFrom',
    clearTo: 'clearTo',
} as const;

/** Where the control lives, and therefore where every range link points. */
export const ARCHIVE_ROUTE = '/gos10k';

/**
 * What the URL asked for, after structural validation and before the Archive has been
 * consulted. `malformed` and `none` both render the unfiltered page; they are separate
 * because only one of them is worth telling the reader about.
 */
export type ArchiveRangeRequest =
    | { kind: 'none' }
    | { kind: 'malformed' }
    | { kind: 'dates'; fromDate: string; toDate: string }
    | { kind: 'clears'; clearFrom: number; clearTo: number };

/**
 * The Archive's own extent. Read from the data by getArchiveSpan() — never from the
 * clock, which is what makes a preset resolve to the same range in 2031 as it does
 * today against a dataset that stopped moving in 2026.
 */
export interface ArchiveSpan {
    firstRunAt: number | null;
    lastRunAt: number | null;
    /** `MAX(clear_number)` — 10,000 in production, 346 in the fixture. */
    maxClearNumber: number;
}

/**
 * The first and last Run of an Archive that has Runs: {@link ArchiveSpan} with its
 * empty-Archive case ruled out. What the timeline's drag clamps its dates to (#115).
 */
export interface ArchiveRunSpan {
    firstRunAt: number;
    lastRunAt: number;
}

/**
 * The span's Runs, or null for an Archive with none. getArchiveDb() will not open an
 * empty Archive, so in practice this is never null — but a caller that assumed so would
 * take the page down for a reason that has nothing to do with it.
 */
export function archiveRunSpan(span: ArchiveSpan): ArchiveRunSpan | null {
    if (span.firstRunAt === null || span.lastRunAt === null) return null;
    return { firstRunAt: span.firstRunAt, lastRunAt: span.lastRunAt };
}

/** Next hands searchParams through as strings, repeated strings, or nothing at all. */
type SearchParamValue = string | string[] | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = /^\d+$/;

/**
 * A repeated parameter is a hand-edited link; there is no sensible "first one wins".
 *
 * Exported because this page has a second parser — the Helper board's view state in
 * `src/app/gos10k/helper-board-view.ts` — and two controls on one URL reading a
 * repeated key by different rules is a disagreement nothing would catch. It was
 * briefly two functions of the same name with different answers.
 */
export function singleSearchParam(value: SearchParamValue): string | undefined {
    if (Array.isArray(value)) return undefined;
    return value;
}

/**
 * True for a `YYYY-MM-DD` that names a day that exists. The round-trip is the check:
 * `2022-02-30` parses in some engines and slides silently to March 2nd, and a filter
 * that quietly moves is worse than one that is ignored.
 */
export function isCalendarDate(value: string): boolean {
    if (!ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && formatArchiveDate(parsed.getTime() / 1000) === value;
}

/** `YYYY-MM-DD` for a unix timestamp, in UTC — the Archive stores `period` in UTC. */
export function formatArchiveDate(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** The first instant of a `YYYY-MM-DD`, UTC. */
export function startOfArchiveDay(date: string): number {
    return isoToUnix(`${date}T00:00:00.000Z`);
}

/**
 * The last instant of a `YYYY-MM-DD`, UTC. Inclusive: a reader who types the same date
 * in both boxes means that whole day, and a range ending at midnight would drop it.
 */
export function endOfArchiveDay(date: string): number {
    return isoToUnix(`${date}T23:59:59.999Z`);
}

/**
 * Reads a range request out of Next's `searchParams`.
 *
 * Everything not structurally valid is `malformed`, and every caller renders that as
 * the whole Archive. In particular a *truncated* pair is malformed rather than treated
 * as an open-ended range: "clears 9,001 onwards" is a fourth thing the control cannot
 * express or round-trip, and inventing it here would put the page in a state the
 * control could not draw.
 */
export function parseArchiveRangeRequest(
    searchParams: Record<string, SearchParamValue>
): ArchiveRangeRequest {
    const fromDate = singleSearchParam(searchParams[RANGE_PARAMS.fromDate]);
    const toDate = singleSearchParam(searchParams[RANGE_PARAMS.toDate]);
    const clearFrom = singleSearchParam(searchParams[RANGE_PARAMS.clearFrom]);
    const clearTo = singleSearchParam(searchParams[RANGE_PARAMS.clearTo]);

    const asksForDates = RANGE_PARAMS.fromDate in searchParams || RANGE_PARAMS.toDate in searchParams;
    const asksForClears =
        RANGE_PARAMS.clearFrom in searchParams || RANGE_PARAMS.clearTo in searchParams;

    if (!asksForDates && !asksForClears) return { kind: 'none' };
    // Mutually exclusive by construction in the control — each mode is its own GET form,
    // so a browser submits one pair or the other. A URL carrying both is not a state the
    // page has, and picking a winner would silently apply a filter nobody asked for.
    if (asksForDates && asksForClears) return { kind: 'malformed' };

    if (asksForDates) {
        if (!fromDate || !toDate) return { kind: 'malformed' };
        if (!isCalendarDate(fromDate) || !isCalendarDate(toDate)) return { kind: 'malformed' };
        if (fromDate > toDate) return { kind: 'malformed' };
        return { kind: 'dates', fromDate, toDate };
    }

    if (!clearFrom || !clearTo) return { kind: 'malformed' };
    // Digits only: `parseInt` would accept `1.5`, `-5` and `12abc` and quietly filter to
    // something the reader did not ask for.
    if (!DIGITS.test(clearFrom) || !DIGITS.test(clearTo)) return { kind: 'malformed' };
    const from = Number(clearFrom);
    const to = Number(clearTo);
    // Clear Numbers start at 1. A range asking for 0 is out of the Archive's own
    // vocabulary, not merely out of its bounds.
    if (from < 1 || to < 1 || from > to) return { kind: 'malformed' };
    return { kind: 'clears', clearFrom: from, clearTo: to };
}

/**
 * The URL a request writes back — the same parameters manual selection submits, which
 * is what makes a preset a link rather than a second filtering mechanism, and what
 * makes any view shareable by copying the address bar.
 */
export function archiveRangeHref(
    request: ArchiveRangeRequest,
    /**
     * A panel's own parameters, appended after the range's.
     *
     * Here rather than left to the caller because the alternative is string surgery on
     * this function's return value — `base.includes('?') ? '&' : '?'` — which is how a
     * second, subtly different opinion about URL assembly gets into the page. The range
     * always writes first, so a shared link reads range-then-panel however it was built.
     */
    extra?: URLSearchParams
): string {
    const params = new URLSearchParams();

    if (request.kind === 'dates') {
        params.set(RANGE_PARAMS.fromDate, request.fromDate);
        params.set(RANGE_PARAMS.toDate, request.toDate);
    } else if (request.kind === 'clears') {
        params.set(RANGE_PARAMS.clearFrom, String(request.clearFrom));
        params.set(RANGE_PARAMS.clearTo, String(request.clearTo));
    }

    for (const [key, value] of extra ?? []) {
        params.append(key, value);
    }

    const query = params.toString();
    return query ? `${ARCHIVE_ROUTE}?${query}` : ARCHIVE_ROUTE;
}

/**
 * How a preset is anchored. Data rather than a callback, so the committed list below
 * reads as a list and every entry is resolved by the same audited arithmetic.
 *
 * Every anchor is relative to the Archive's first or last Run. None of them can be
 * relative to the clock: this dataset is frozen, so "the final year" means the final
 * year *of the data*. Anchored to `Date.now()` it drifts a day every day and eventually
 * selects nothing — see #71 for the same bug on the Tracker's test helpers.
 */
type PresetAnchor =
    | { kind: 'first-clears'; count: number }
    | { kind: 'final-clears'; count: number }
    | { kind: 'first-years'; years: number }
    | { kind: 'final-years'; years: number };

export interface MilestonePreset {
    id: string;
    label: string;
    anchor: PresetAnchor;
}

/**
 * The committed list. Destiny season boundaries are out of scope for Phase 1 (#81) and
 * are a later data-only addition here: a season is `{ kind: 'dates' }` with two fixed
 * dates, which is the same mechanism with a different anchor.
 */
export const MILESTONE_PRESETS: readonly MilestonePreset[] = [
    { id: 'first-thousand', label: 'The first thousand', anchor: { kind: 'first-clears', count: 1000 } },
    { id: 'final-thousand', label: 'The final thousand', anchor: { kind: 'final-clears', count: 1000 } },
    { id: 'first-year', label: 'The first year', anchor: { kind: 'first-years', years: 1 } },
    { id: 'final-year', label: 'The final year', anchor: { kind: 'final-years', years: 1 } },
];

/**
 * A preset resolved against the Archive: the request only, never a finished link.
 *
 * There was an `href` here until #112. The page's tabs mean a link has to carry the tab
 * as well as the range, which this module knows nothing about, so the one caller builds
 * its links with `archiveTabHref(preset.request, tab)` instead. A tab-less `href` left
 * lying here was a link that would silently drop the reader onto Overview.
 */
export interface ResolvedMilestonePreset extends MilestonePreset {
    request: ArchiveRangeRequest;
}

/** Shifts a `YYYY-MM-DD` by whole years and days, in UTC, staying a calendar date. */
function shiftDate(date: string, years: number, days: number): string {
    const shifted = new Date(`${date}T00:00:00Z`);
    shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return formatArchiveDate(shifted.getTime() / 1000);
}

/**
 * Resolves every preset against the Archive's span.
 *
 * Clamped to the span in both directions, so a preset is a live link on any dataset:
 * against the 346-clear fixture "the first thousand" is the whole Archive rather than a
 * link that selects nothing, and "the first year" cannot end after the last Run.
 *
 * An empty Archive resolves to no presets at all. getArchiveDb() will not open one, so
 * this is unreachable in production — but a preset list that threw would take the page
 * down for a reason that has nothing to do with presets.
 */
export function resolveMilestonePresets(span: ArchiveSpan): ResolvedMilestonePreset[] {
    if (span.firstRunAt === null || span.lastRunAt === null || span.maxClearNumber < 1) return [];

    const firstDate = formatArchiveDate(span.firstRunAt);
    const lastDate = formatArchiveDate(span.lastRunAt);

    return MILESTONE_PRESETS.map((preset) => {
        const request = resolveAnchor(preset.anchor, span, firstDate, lastDate);
        return { ...preset, request };
    });
}

function resolveAnchor(
    anchor: PresetAnchor,
    span: ArchiveSpan,
    firstDate: string,
    lastDate: string
): ArchiveRangeRequest {
    switch (anchor.kind) {
        case 'first-clears':
            return {
                kind: 'clears',
                clearFrom: 1,
                clearTo: Math.min(anchor.count, span.maxClearNumber),
            };
        case 'final-clears':
            return {
                kind: 'clears',
                clearFrom: Math.max(1, span.maxClearNumber - anchor.count + 1),
                clearTo: span.maxClearNumber,
            };
        case 'first-years': {
            // Inclusive of the first Run's own day, so the window is a whole year rather
            // than a year and a day: 2020-07-04 through 2021-07-03.
            const end = shiftDate(firstDate, anchor.years, -1);
            return { kind: 'dates', fromDate: firstDate, toDate: end > lastDate ? lastDate : end };
        }
        case 'final-years': {
            // Symmetric with 'first-years': inclusive of the last Run's own day, so the
            // window is a whole year rather than a year and a day.
            const start = shiftDate(lastDate, -anchor.years, 1);
            return {
                kind: 'dates',
                fromDate: start < firstDate ? firstDate : start,
                toDate: lastDate,
            };
        }
    }
}
