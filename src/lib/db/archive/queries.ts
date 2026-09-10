import { getArchiveDb } from './index';
import { formatBungieDisplayName } from '../queries';
import { PINNED_FULL_CLEAR, DISJUNCTIVE_FULL_CLEAR } from './predicates';
import {
    endOfArchiveDay,
    formatArchiveDate,
    startOfArchiveDay,
    type ArchiveRangeRequest,
    type ArchiveSpan,
} from './range';

/**
 * All SQL for the GoS 10k Archive. One query module per database — the Tracker's is
 * ../queries.ts over getDb(), this one is over getArchiveDb(), and the two are never
 * joined. Keeping them apart is not style: ../queries.ts is ~1,700 lines over an
 * implicit connection, and a second database mixed into it would make "which database
 * is this function reading" a per-function question.
 *
 * Three hazards in this data have their single home here. Read them before adding a
 * query; each one produces a plausible wrong number rather than an error.
 */

/**
 * Nesspo#9781 — the player whose history this Archive is. Every Run row is one of his
 * runs, so `gos_10k_runs.completed` means *he* finished, while
 * `gos_10k_pgcr_players.completed` means whichever player that row is finished. The
 * two are different questions and the column names do not say so.
 */
export const SUBJECT_MEMBERSHIP_ID = '4611686018437585442';

/**
 * HAZARD 1 — 217 (instance, player) pairs have more than one row in
 * `gos_10k_pgcr_players`, because a player can bring several characters to one raid.
 * Anything counting runs through that table must COUNT(DISTINCT instance_id) or it
 * silently inflates. This is the single most likely bug in the feature.
 *
 * HAZARD 2 — 174 player rows have a NULL `bungie_global_display_name_code`. Format
 * names through formatBungieDisplayName() (../queries.ts), which already implements
 * the fallback ladder. Do not write a second display rule; `Name#Code` in full, always.
 *
 * HAZARD 3 — the full-clear predicates, in ./predicates.ts and re-exported below.
 * See their own comments; each one carries "and the subject finished it" inside it.
 */

/**
 * The three named full-clear rules live in ./predicates.ts and are re-exported here, so
 * that `@/lib/db/archive/queries` stays the one import for anything reading this
 * database. They are defined next door only because the build script and the fixture
 * extractor must import the pinned rule without pulling in a connection — see that
 * file's header and ADR 0008.
 */
export { PINNED_FULL_CLEAR, DISJUNCTIVE_FULL_CLEAR, STARTED_FROM_BEGINNING } from './predicates';

/**
 * ------------------------------------------------------------------------------------
 * The global range filter (#87)
 * ------------------------------------------------------------------------------------
 *
 * A range reaches this module as an {@link ArchiveRangeRequest} — already validated
 * against the URL's grammar by ./range.ts, and not yet compared to the data. Resolving
 * it is what needs the database, and it is two separate jobs:
 *
 * 1. **Bounds.** Every panel below filters on `r.period`, in both modes. A Clear Number
 *    range *is* a date range (Clear Number is the ordinal by period ascending, ADR
 *    0008), so resolving it to period bounds once is what makes the equivalence
 *    criterion true by construction rather than by two parallel WHERE clauses that have
 *    to be kept agreeing.
 * 2. **The other expression.** The control renders the inactive mode's reading of the
 *    active range as read-only text: the dates a Clear Number range spans, the Clear
 *    Numbers a date range contains. That is the most informative thing on the control —
 *    a thousand clears is four months in one era and two years in another — and it is
 *    computed here, server-side, rather than in the browser.
 */

/**
 * A range the page can actually render: the bounds every panel filters on, plus both
 * expressions of the same window for the control to display.
 */
export interface ResolvedArchiveRange {
    /** `all` is the whole Archive — including every request that degraded to it. */
    mode: 'all' | 'dates' | 'clears';
    /** Inclusive `period` bounds, or null for unbounded. What the panels filter on. */
    periodFrom: number | null;
    periodTo: number | null;
    /** The range's date expression, `YYYY-MM-DD`, for the control to render. */
    dateFrom: string | null;
    dateTo: string | null;
    /** Its Clear Number expression, or null when the window holds no clears at all. */
    clearFrom: number | null;
    clearTo: number | null;
    /** The URL asked for a range and it was not applied; the page says so. */
    degraded: boolean;
}

/**
 * The unfiltered range, for callers with no URL to read — the share card, and the
 * existing tests. Deliberately not the resolution of a `none` request: it states no
 * dates and no Clear Numbers, because filling those in would mean a database read for
 * a caller that only wants "do not filter".
 */
export const UNFILTERED_ARCHIVE_RANGE: ResolvedArchiveRange = {
    mode: 'all',
    periodFrom: null,
    periodTo: null,
    dateFrom: null,
    dateTo: null,
    clearFrom: null,
    clearTo: null,
    degraded: false,
};

/**
 * The Archive's own extent, read from the data.
 *
 * Separate from {@link getArchiveOverview} because it is the one figure set that must
 * *not* obey the range: the header states the whole Archive's span, and the milestone
 * presets are anchored to it. A preset anchored to `Date.now()` instead drifts a day
 * every day against a frozen dataset and eventually selects nothing (#71's bug class).
 */
export function getArchiveSpan(): ArchiveSpan {
    return getArchiveDb().prepare(`
        SELECT
            MIN(r.period) AS firstRunAt,
            MAX(r.period) AS lastRunAt,
            COALESCE(MAX(r.clear_number), 0) AS maxClearNumber
        FROM gos_10k_runs r
    `).get() as ArchiveSpan;
}

/**
 * Turns a URL's range request into the range the page renders.
 *
 * **Nothing here throws, and nothing renders an empty page.** A request that selects no
 * Runs at all — clears 9,001–10,000 against a 346-clear fixture, dates before the
 * Archive begins — degrades to the whole Archive with `degraded` set, because a page
 * filtered to nothing reads as broken rather than as an answer. A request that only
 * *overruns* the Archive is clamped instead: "clears 340 onwards" has a real answer and
 * throwing the reader's intent away would be worse than trimming it.
 *
 * A date range holding Runs but no clears is neither — it is held as asked, with a null
 * Clear Number expression, because "44 Runs, no full clears" is a true and interesting
 * answer that the control states in words.
 */
export function resolveArchiveRange(request: ArchiveRangeRequest): ResolvedArchiveRange {
    const db = getArchiveDb();

    if (request.kind === 'none' || request.kind === 'malformed') {
        return wholeArchive(request.kind === 'malformed');
    }

    if (request.kind === 'clears') {
        // Both bounds come from the ranked Runs themselves, so an over-wide request is
        // clamped by the data rather than by arithmetic against MAX(clear_number).
        //
        // The bounds are the two Runs' own instants, not their whole days: clears
        // 104–105 means those two clears, not the thirteen that share 2022-02-01. The
        // consequence is that the *date* expression this returns is the days the range
        // spans, and retyping those two dates into the date form — which is necessarily
        // day-granular — can select a clear or two either side. That is a property of
        // dates, not a disagreement between the modes: both still resolve to one pair of
        // period bounds, and both still filter every panel the same way. The control's
        // copy says "span" for this reason, and
        // tests/db/archive-range.test.ts pins the case on a day carrying 13 clears.
        const bounds = db.prepare(`
            SELECT
                MIN(r.period) AS periodFrom,
                MAX(r.period) AS periodTo,
                MIN(r.clear_number) AS clearFrom,
                MAX(r.clear_number) AS clearTo
            FROM gos_10k_runs r
            WHERE r.clear_number BETWEEN ? AND ?
        `).get(request.clearFrom, request.clearTo) as {
            periodFrom: number | null;
            periodTo: number | null;
            clearFrom: number | null;
            clearTo: number | null;
        };

        if (bounds.periodFrom === null || bounds.periodTo === null) return wholeArchive(true);

        return {
            mode: 'clears',
            periodFrom: bounds.periodFrom,
            periodTo: bounds.periodTo,
            dateFrom: formatArchiveDate(bounds.periodFrom),
            dateTo: formatArchiveDate(bounds.periodTo),
            clearFrom: bounds.clearFrom,
            clearTo: bounds.clearTo,
            degraded: false,
        };
    }

    const periodFrom = startOfArchiveDay(request.fromDate);
    const periodTo = endOfArchiveDay(request.toDate);
    const contained = db.prepare(`
        SELECT
            COUNT(*) AS runs,
            MIN(r.clear_number) AS clearFrom,
            MAX(r.clear_number) AS clearTo
        FROM gos_10k_runs r
        WHERE r.period >= ? AND r.period <= ?
    `).get(periodFrom, periodTo) as {
        runs: number;
        clearFrom: number | null;
        clearTo: number | null;
    };

    // No Runs at all, rather than no clears: every panel would report zero and the page
    // would look broken. A window holding Runs is kept even when it holds no clears.
    if (contained.runs === 0) return wholeArchive(true);

    return {
        mode: 'dates',
        periodFrom,
        periodTo,
        dateFrom: request.fromDate,
        dateTo: request.toDate,
        clearFrom: contained.clearFrom,
        clearTo: contained.clearTo,
        degraded: false,
    };
}

/** The unfiltered range, described in both expressions so the control can render it. */
function wholeArchive(degraded: boolean): ResolvedArchiveRange {
    const span = getArchiveSpan();

    return {
        ...UNFILTERED_ARCHIVE_RANGE,
        dateFrom: span.firstRunAt === null ? null : formatArchiveDate(span.firstRunAt),
        dateTo: span.lastRunAt === null ? null : formatArchiveDate(span.lastRunAt),
        clearFrom: span.maxClearNumber > 0 ? 1 : null,
        clearTo: span.maxClearNumber > 0 ? span.maxClearNumber : null,
        degraded,
    };
}

/**
 * The range clause every panel query below carries, as SQL plus its parameters.
 *
 * One clause, on `r.period`, in both modes — see the note above {@link
 * ResolvedArchiveRange}. Returned with its parameters rather than interpolated: these
 * are the only user-supplied values in this module's SQL.
 */
function rangeClause(range: ResolvedArchiveRange): { sql: string; params: number[] } {
    if (range.periodFrom === null || range.periodTo === null) return { sql: '', params: [] };
    return { sql: 'AND r.period >= ? AND r.period <= ?', params: [range.periodFrom, range.periodTo] };
}

export interface ArchiveOverview {
    /** Every raid instance he entered, completed or not. */
    runs: number;
    /** Runs he personally finished, whatever encounter he joined at. */
    completions: number;
    /** {@link PINNED_FULL_CLEAR} — the headline candidate. */
    pinnedFullClears: number;
    /** {@link DISJUNCTIVE_FULL_CLEAR} — the Tracker-comparable cross-tab. */
    disjunctiveFullClears: number;
    /** Distinct people who appeared in at least one of his runs, excluding him. */
    helpers: number;
    firstRunAt: number | null;
    lastRunAt: number | null;
}

export function getArchiveOverview(
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveOverview {
    const db = getArchiveDb();
    const scope = rangeClause(range);

    const runs = db.prepare(`
        SELECT
            COUNT(*) AS runs,
            SUM(CASE WHEN r.completed = 1 THEN 1 ELSE 0 END) AS completions,
            SUM(CASE WHEN ${PINNED_FULL_CLEAR} THEN 1 ELSE 0 END) AS pinnedFullClears,
            SUM(CASE WHEN ${DISJUNCTIVE_FULL_CLEAR} THEN 1 ELSE 0 END) AS disjunctiveFullClears,
            MIN(r.period) AS firstRunAt,
            MAX(r.period) AS lastRunAt
        FROM gos_10k_runs r
        WHERE 1 = 1 ${scope.sql}
    `).get(...scope.params) as {
        runs: number;
        completions: number | null;
        pinnedFullClears: number | null;
        disjunctiveFullClears: number | null;
        firstRunAt: number | null;
        lastRunAt: number | null;
    };

    // Joined to the Runs table even unfiltered, so that the filtered and unfiltered
    // readings of "guardians who helped" are the same question asked of two windows.
    const helpers = db.prepare(`
        SELECT COUNT(DISTINCT p.membership_id) AS n
        FROM gos_10k_pgcr_players p
        JOIN gos_10k_runs r ON r.instance_id = p.instance_id
        WHERE p.membership_id != ? ${scope.sql}
    `).get(SUBJECT_MEMBERSHIP_ID, ...scope.params) as { n: number };

    return {
        runs: runs.runs,
        completions: runs.completions ?? 0,
        pinnedFullClears: runs.pinnedFullClears ?? 0,
        disjunctiveFullClears: runs.disjunctiveFullClears ?? 0,
        helpers: helpers.n,
        firstRunAt: runs.firstRunAt,
        lastRunAt: runs.lastRunAt,
    };
}

export interface ArchiveHelper {
    membershipId: string;
    membershipType: number;
    /** `Name#Code` in full, via formatBungieDisplayName. */
    displayName: string;
    /** Runs of his they appeared in. Distinct instances, never player rows. */
    runs: number;
    /** Of those, the ones that were a Pinned Full Clear. */
    fullClears: number;
}

/**
 * The Helpers who show up in most of his runs.
 *
 * `COUNT(DISTINCT r.instance_id)` rather than `COUNT(*)`: hazard 1. A player who
 * brought three characters to one raid has three rows here and is still one run.
 */
export function getTopHelpers(
    limit: number = 25,
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveHelper[] {
    const scope = rangeClause(range);

    const rows = getArchiveDb().prepare(`
        SELECT
            p.membership_id                     AS membershipId,
            MAX(p.membership_type)              AS membershipType,
            MAX(p.display_name)                 AS displayName,
            MAX(p.bungie_global_display_name)   AS bungieGlobalDisplayName,
            MAX(p.bungie_global_display_name_code) AS bungieGlobalDisplayNameCode,
            COUNT(DISTINCT r.instance_id)       AS runs,
            COUNT(DISTINCT CASE WHEN ${PINNED_FULL_CLEAR} THEN r.instance_id END) AS fullClears
        FROM gos_10k_pgcr_players p
        JOIN gos_10k_runs r ON r.instance_id = p.instance_id
        WHERE p.membership_id != ? ${scope.sql}
        GROUP BY p.membership_id
        ORDER BY runs DESC, fullClears DESC, membershipId
        LIMIT ?
    `).all(SUBJECT_MEMBERSHIP_ID, ...scope.params, limit) as Array<{
        membershipId: string;
        membershipType: number;
        displayName: string | null;
        bungieGlobalDisplayName: string | null;
        bungieGlobalDisplayNameCode: number | null;
        runs: number;
        fullClears: number;
    }>;

    return rows.map((row) => ({
        membershipId: row.membershipId,
        membershipType: row.membershipType,
        displayName: formatBungieDisplayName(row),
        runs: row.runs,
        fullClears: row.fullClears,
    }));
}

export interface ArchiveYear {
    year: string;
    runs: number;
    fullClears: number;
}

/**
 * Pinned Full Clears by calendar year, alongside every run he started. The gap between
 * the two columns is the attempt story — checkpoint farms and wipes — which is why
 * both are here rather than only the clears.
 */
export function getRunsByYear(
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveYear[] {
    const scope = rangeClause(range);

    return getArchiveDb().prepare(`
        SELECT
            strftime('%Y', r.period, 'unixepoch') AS year,
            COUNT(*) AS runs,
            SUM(CASE WHEN ${PINNED_FULL_CLEAR} THEN 1 ELSE 0 END) AS fullClears
        FROM gos_10k_runs r
        WHERE 1 = 1 ${scope.sql}
        GROUP BY year
        ORDER BY year
    `).all(...scope.params) as ArchiveYear[];
}

export interface ArchiveClassCount {
    characterClass: string;
    playerRuns: number;
}

/**
 * Class split across every player-run in the Archive.
 *
 * `character_class` is stored as text, which is why this works today — every other
 * cosmetic dimension (weapon, emblem, race, gender) is a manifest hash with no
 * resolution script written yet.
 */
export function getClassDistribution(
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveClassCount[] {
    const scope = rangeClause(range);

    return getArchiveDb().prepare(`
        SELECT
            COALESCE(p.character_class, 'Unknown') AS characterClass,
            COUNT(*) AS playerRuns
        FROM gos_10k_pgcr_players p
        JOIN gos_10k_runs r ON r.instance_id = p.instance_id
        WHERE 1 = 1 ${scope.sql}
        GROUP BY characterClass
        ORDER BY playerRuns DESC
    `).all(...scope.params) as ArchiveClassCount[];
}
