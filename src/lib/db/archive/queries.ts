import { getArchiveDb } from './index';
import { formatBungieDisplayName } from '../queries';
import { PINNED_FULL_CLEAR, DISJUNCTIVE_FULL_CLEAR } from './predicates';
import { monthsBetween } from './month-keys';
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
export function resolveArchiveRange(
    request: ArchiveRangeRequest,
    span: ArchiveSpan = getArchiveSpan()
): ResolvedArchiveRange {
    const db = getArchiveDb();

    if (request.kind === 'none' || request.kind === 'malformed') {
        return wholeArchive(span, request.kind === 'malformed');
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

        if (bounds.periodFrom === null || bounds.periodTo === null) return wholeArchive(span, true);

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
    if (contained.runs === 0) return wholeArchive(span, true);

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

/**
 * The unfiltered range, described in both expressions so the control can render it.
 *
 * Takes the span rather than reading it: the page needs the same span for its header and
 * its presets, and re-deriving it here made the most common request — the plain,
 * unfiltered `/gos10k` — run the same aggregate twice.
 */
function wholeArchive(span: ArchiveSpan, degraded: boolean): ResolvedArchiveRange {
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
 *
 * `AND`-prefixed, matching buildRaidFilterClause() on the Tracker side, so it splices
 * onto a query that already has a `WHERE`. The panels that have no other predicate open
 * with `WHERE 1 = 1` for it to attach to: the alternative is a clause builder that has
 * to know each query's other conditions, which is more machinery than four call sites
 * and one optional predicate are worth.
 */
function rangeClause(range: ResolvedArchiveRange): { sql: string; params: number[] } {
    if (range.periodFrom === null || range.periodTo === null) return { sql: '', params: [] };
    return { sql: 'AND r.period >= ? AND r.period <= ?', params: [range.periodFrom, range.periodTo] };
}

/**
 * The four name columns a player row carries, as they come out of a GROUP BY over
 * `gos_10k_pgcr_players p`. Three of them — `displayName`, `bungieGlobalDisplayName`,
 * `bungieGlobalDisplayNameCode` — are what formatBungieDisplayName() reads; the fourth,
 * `membershipType`, rides along for the callers that address a player by platform.
 * Written once because two queries below project them identically and a third will; the
 * same drift argument as ./predicates.ts, one level down.
 *
 * **Each `MAX()` is taken independently, and that is safe only because this dataset is
 * frozen.** In principle a membership whose duplicate character rows disagreed could
 * have its name spliced onto another row's code, rendering a `Name#Code` that never
 * existed. Checked rather than assumed: across all 217 duplicate (instance, membership)
 * pairs in the shipped Archive, zero disagree on `display_name`,
 * `bungie_global_display_name` or `bungie_global_display_name_code`. The Archive cannot
 * gain a row (ADR 0007), so the check cannot go stale — but a *live* table with this
 * shape would need the name columns taken from one chosen row instead.
 */
const PLAYER_NAME_PROJECTION = `
    MAX(p.membership_type)                 AS membershipType,
    MAX(p.display_name)                    AS displayName,
    MAX(p.bungie_global_display_name)      AS bungieGlobalDisplayName,
    MAX(p.bungie_global_display_name_code) AS bungieGlobalDisplayNameCode
`;

/**
 * Distinct people who appeared in at least one of his Runs, excluding him.
 *
 * Its own function rather than a field only {@link getArchiveOverview} can produce: the
 * page header states the *whole Archive's* helper count even while the panels below it
 * are filtered, and reading it off a second full overview meant running every other
 * aggregate in that shape to throw the results away.
 *
 * Joined to the Runs table even unfiltered, so that the filtered and unfiltered readings
 * of "guardians who helped" are the same question asked of two windows.
 */
export function getArchiveHelperCount(
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): number {
    const scope = rangeClause(range);

    const row = getArchiveDb().prepare(`
        SELECT COUNT(DISTINCT p.membership_id) AS n
        FROM gos_10k_pgcr_players p
        JOIN gos_10k_runs r ON r.instance_id = p.instance_id
        WHERE p.membership_id != ? ${scope.sql}
    `).get(SUBJECT_MEMBERSHIP_ID, ...scope.params) as { n: number };

    return row.n;
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

    const helpers = getArchiveHelperCount(range);

    return {
        runs: runs.runs,
        completions: runs.completions ?? 0,
        pinnedFullClears: runs.pinnedFullClears ?? 0,
        disjunctiveFullClears: runs.disjunctiveFullClears ?? 0,
        helpers,
        firstRunAt: runs.firstRunAt,
        lastRunAt: runs.lastRunAt,
    };
}

/**
 * How many rows the Helper board renders before the reader asks for the rest (#90).
 *
 * The board's population is every Helper present for a Pinned Full Clear in the range —
 * 382 in the fixture, several thousand in production — and rendering all of them by
 * default would make the page one enormous table. Twenty-five is enough to answer "who
 * carried this history" while leaving the panels below it reachable by scrolling.
 *
 * Exported because the panel has to name the number it is showing, and because the
 * show-all link is defined as "not this". Distinct from {@link MEDIAN_SPEED_BOARD_ROWS}
 * for the reason stated there: two limits that happen to be counts of different things
 * must not collide on one literal.
 */
export const HELPER_BOARD_ROWS = 25;

export interface ArchiveHelperPresence {
    membershipId: string;
    membershipType: number;
    /** `Name#Code` in full, via formatBungieDisplayName. */
    displayName: string;
    /** Runs of his in range they were present in. Distinct instances, never player rows. */
    runs: number;
    /** Of those, the Pinned Full Clears. Distinct instances, and what the board ranks on. */
    clears: number;
    /**
     * Seconds spent in those clears *alongside him* — the intersection of their interval
     * with his, in each Run, summed. Raw seconds; rendered by formatPresenceHours() in
     * src/app/gos10k/duration-copy.ts.
     */
    secondsWithSubject: number;
    /** Seconds spent in those clears at all, whether or not he was there for them. */
    secondsInRun: number;
}

/**
 * The Helper board (#90) — who actually carried this history.
 *
 * ## The population, and why the two count columns differ
 *
 * A row is a Helper who was present for **at least one Pinned Full Clear in the range**,
 * which is this page's default population (#81) and what the board ranks on. The `runs`
 * column is deliberately wider: it counts every Run of his in the range they were in,
 * clear or not. Presence and success are different things, and a board reading both
 * columns off the clears would render them equal on every row — a tidy-looking number
 * that has quietly stopped saying anything.
 *
 * ## The two time columns
 *
 * Both are computed here rather than in the component, and both come back on every row,
 * because the panel's toggle picks between them rather than re-querying: the ranking is
 * by presence in either case, so switching the column cannot reorder the board.
 *
 * - `secondsWithSubject` — time genuinely overlapping his, the default. For each clear,
 *   the intersection of the Helper's interval with the subject's own interval in that
 *   same Run, floored at zero and summed. A Helper who left before he arrived overlaps
 *   him by nothing, and without the floor that Run contributes a *negative* number to
 *   their total.
 * - `secondsInRun` — their whole time in those Runs, whether he was there or not.
 *
 * The measures were validated against the production data while #81 was specified:
 * across all 79,168 player rows, entry offset plus time played never exceeds the Run's
 * duration, and time played never exceeds it either. About a dozen rows sit at exactly
 * 32,767 in one of those columns, which looks like a clamp in Bungie's own reporting;
 * it is noted rather than special-cased, and the fixture carries none of them.
 *
 * ## Hazard 1, which bites this query twice
 *
 * A person can bring several characters to one raid — 217 (instance, player) pairs in
 * production, 26 in the fixture — and each one is its own row with its own entry offset
 * and time played. The `intervals` CTE collapses those rows to **one interval per
 * (Run, person)**, `MIN(entry)` to `MAX(exit)`, which is what makes both the counts and
 * the durations immune:
 *
 * - counting rows would give a three-character Helper three clears out of one;
 * - summing `time_played_seconds` across rows would double-count the stretches where
 *   two of their characters' intervals overlap, which the fixture contains;
 * - **and the same applies to the subject.** He brought two characters to four Runs, and
 *   in one of them the two intervals overlap. An overlap summed per (Helper row, subject
 *   row) pair counts that stretch twice and can return more time alongside him than the
 *   Helper spent in the Run at all — which is exactly what the first draft of this query
 *   did to the board's top row, by 1,366 seconds, while looking entirely plausible.
 *
 * For a Helper with one character in a Run — every row but 26 in the fixture — the
 * interval's length is `time_played_seconds` exactly, so the collapse changes no figure
 * it does not have to.
 *
 * `limit` is `null` for the show-all view. It reaches SQLite as `-1`, which is that
 * engine's spelling of "no limit"; the alternative is two nearly-identical statements.
 *
 * ## One pass, and the population with it
 *
 * Every column comes out of a single scan of the Range's player rows. `intervals` groups
 * them per (Run, person) once, over *every* Run in the range, carrying whether that Run
 * was a clear; `runs` counts those groups, while `clears` and both time columns count
 * only the ones flagged, and `HAVING` drops a person with none. The first version read
 * the player table three times — clears, names, and all Runs — for identical rows.
 *
 * `population` is `COUNT(*) OVER ()`, which SQLite evaluates before `LIMIT`, so a page
 * of 25 rows still reports every Helper the board could show. It was a second statement
 * restating this one's population rule, which is the drift the "25 of 382" copy and the
 * show-all link would have silently inherited.
 */
export interface ArchiveHelperBoard {
    /** The rows to render — the first `limit` of them, or all of them for `null`. */
    helpers: ArchiveHelperPresence[];
    /** Every Helper the board *could* show in this range, however many rows were asked for. */
    population: number;
}

export function getHelperBoard(
    limit: number | null = HELPER_BOARD_ROWS,
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveHelperBoard {
    const scope = rangeClause(range);

    // Positional parameters, in textual order: the range, the subject's membership twice
    // (the subject CTE, the presence filter), then the limit. `rangeClause` returns `?`s,
    // so named parameters cannot be mixed in without rewriting it.
    const rows = getArchiveDb().prepare(`
        WITH intervals AS (
            SELECT
                p.instance_id                                AS instanceId,
                p.membership_id                              AS membershipId,
                MAX(${PINNED_FULL_CLEAR})                    AS isClear,
                MIN(p.start_seconds)                         AS enteredAt,
                MAX(p.start_seconds + p.time_played_seconds) AS leftAt,
                ${PLAYER_NAME_PROJECTION}
            FROM gos_10k_pgcr_players p
            JOIN gos_10k_runs r ON r.instance_id = p.instance_id
            WHERE 1 = 1 ${scope.sql}
            GROUP BY p.instance_id, p.membership_id
        ),
        subject AS (
            SELECT instanceId, enteredAt, leftAt
            FROM intervals
            WHERE membershipId = ? AND isClear = 1
        ),
        presence AS (
            SELECT
                h.membershipId                              AS membershipId,
                MAX(h.membershipType)                       AS membershipType,
                MAX(h.displayName)                          AS displayName,
                MAX(h.bungieGlobalDisplayName)              AS bungieGlobalDisplayName,
                MAX(h.bungieGlobalDisplayNameCode)          AS bungieGlobalDisplayNameCode,
                COUNT(*)                                    AS runs,
                SUM(h.isClear)                              AS clears,
                SUM(CASE WHEN h.isClear = 1 THEN h.leftAt - h.enteredAt ELSE 0 END)
                                                            AS secondsInRun,
                -- LEFT JOIN and COALESCE rather than an inner join: he is in every Run
                -- of this Archive by construction, and a clear that somehow carried no
                -- row for him should drop that Run's overlap, never the Helper's row.
                -- The subject CTE holds clears only, so a non-clear Run joins nothing and
                -- contributes NULL, which SUM skips.
                COALESCE(SUM(
                    MAX(0, MIN(h.leftAt, s.leftAt) - MAX(h.enteredAt, s.enteredAt))
                ), 0)                                       AS secondsWithSubject
            FROM intervals h
            LEFT JOIN subject s ON s.instanceId = h.instanceId
            WHERE h.membershipId != ?
            GROUP BY h.membershipId
            HAVING SUM(h.isClear) > 0
        )
        SELECT *, COUNT(*) OVER () AS population
        FROM presence
        ORDER BY clears DESC, runs DESC, membershipId
        LIMIT ?
    `).all(
        ...scope.params,
        SUBJECT_MEMBERSHIP_ID,
        SUBJECT_MEMBERSHIP_ID,
        limit ?? -1
    ) as Array<{
        membershipId: string;
        membershipType: number;
        displayName: string | null;
        bungieGlobalDisplayName: string | null;
        bungieGlobalDisplayNameCode: number | null;
        runs: number;
        clears: number;
        secondsInRun: number;
        secondsWithSubject: number;
        population: number;
    }>;

    return {
        helpers: rows.map((row) => ({
            membershipId: row.membershipId,
            membershipType: row.membershipType,
            displayName: formatBungieDisplayName(row),
            runs: row.runs,
            clears: row.clears,
            secondsInRun: row.secondsInRun,
            secondsWithSubject: row.secondsWithSubject,
        })),
        // No rows means no population: the window has nothing to count over.
        population: rows[0]?.population ?? 0,
    };
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

/** One person who was in a Run, named once however many characters they brought. */
export interface ArchiveParticipant {
    membershipId: string;
    /** `Name#Code` in full, via formatBungieDisplayName. */
    displayName: string;
}

export interface ArchiveFastestClear {
    instanceId: string;
    /** Its place among the Pinned Full Clears, 1-based by period ascending (ADR 0008). */
    clearNumber: number;
    /** Raw seconds. Rendered by formatRunDuration() in src/app/gos10k/duration-copy.ts. */
    durationSeconds: number;
    period: number;
    /** Everyone who entered, in the order they arrived. */
    participants: ArchiveParticipant[];
}

/**
 * The fastest Pinned Full Clears in the range — Runs, not players.
 *
 * A board of *players* ranked by personal best was considered and rejected (#91): the
 * six people in the fastest Run would take the top six rows with identical times, which
 * says nothing. The Run is the more interesting object, and naming its fireteam is the
 * point of the panel.
 *
 * Two statements rather than one. A single query joining the players table would return
 * six-plus rows per Run and make `LIMIT 10` mean ten *rows*, which is one and a half
 * Runs; ranking first and then reading the participants of exactly those instances is
 * what keeps the limit denominated in the thing the panel counts. The same distinction
 * bites the Tracker's active-session cap for the same reason (ADR 0001).
 *
 * `COUNT(DISTINCT p.membership_id)` has no equivalent here because the list is not a
 * count — hazard 1 is handled by grouping the participant rows on `membership_id`, so a
 * player who brought three characters to one raid is one chip and not three.
 */
export function getFastestClears(
    limit: number = 10,
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveFastestClear[] {
    const db = getArchiveDb();
    const scope = rangeClause(range);

    // `period, instance_id` after the duration is not decoration: the fixture alone has
    // two clears at 691 seconds and two at 700. Left untied, their order is whatever the
    // query plan produces, and it can differ between two databases for no reason a
    // reader could ever see on the page.
    const runs = db.prepare(`
        SELECT
            r.instance_id       AS instanceId,
            r.clear_number      AS clearNumber,
            r.duration_seconds  AS durationSeconds,
            r.period            AS period
        FROM gos_10k_runs r
        WHERE ${PINNED_FULL_CLEAR} ${scope.sql}
        ORDER BY r.duration_seconds ASC, r.period ASC, r.instance_id ASC
        LIMIT ?
    `).all(...scope.params, limit) as Array<{
        instanceId: string;
        clearNumber: number;
        durationSeconds: number;
        period: number;
    }>;

    if (runs.length === 0) return [];

    // Parameterised `IN` over the instances just ranked. The list is bounded by `limit`
    // and its values came out of this database a statement ago, so this is a small,
    // fully-bound query rather than a second scan of the runs table.
    const placeholders = runs.map(() => '?').join(', ');
    const participantRows = db.prepare(`
        SELECT
            p.instance_id                       AS instanceId,
            p.membership_id                     AS membershipId,
            ${PLAYER_NAME_PROJECTION},
            MIN(p.start_seconds)                AS enteredAt
        FROM gos_10k_pgcr_players p
        WHERE p.instance_id IN (${placeholders})
        GROUP BY p.instance_id, p.membership_id
        ORDER BY p.instance_id, enteredAt ASC, p.membership_id ASC
    `).all(...runs.map((run) => run.instanceId)) as Array<{
        instanceId: string;
        membershipId: string;
        displayName: string | null;
        bungieGlobalDisplayName: string | null;
        bungieGlobalDisplayNameCode: number | null;
        enteredAt: number;
    }>;

    // Entry order, so the person who was there from the first encounter leads the row and
    // whoever arrived at the eighth minute reads as having arrived late. The alternative
    // — alphabetical, or the subject pinned first — throws away the one ordering the data
    // actually carries.
    const byInstance = new Map<string, ArchiveParticipant[]>();
    for (const row of participantRows) {
        let participants = byInstance.get(row.instanceId);
        if (!participants) {
            participants = [];
            byInstance.set(row.instanceId, participants);
        }
        participants.push({
            membershipId: row.membershipId,
            displayName: formatBungieDisplayName(row),
        });
    }

    return runs.map((run) => ({
        ...run,
        participants: byInstance.get(run.instanceId) ?? [],
    }));
}

/**
 * How many Pinned Full Clears a Helper needs inside the active range before their
 * median is worth ranking (#92).
 *
 * **Fifteen, and it was measured rather than picked.** Within clears 9,001–10,000 of the
 * production Archive, 725 Helpers appear, but only 74 have ten or more clears, 51 have
 * fifteen or more and 32 have twenty-five or more. Twenty-five leaves a board of 32
 * candidates on the narrowest filter anyone is likely to use; fifteen keeps the board
 * usable there while still being enough Runs that one good night cannot move a median.
 *
 * Fixed rather than user-adjustable, and that is a rendering decision as much as an
 * editorial one: this page is URL-driven server rendering, so a slider is a full page
 * render per drag tick. The number is exported because the panel has to *state* it —
 * a floor a reader cannot see is indistinguishable from a Helper who is missing.
 */
export const MEDIAN_SPEED_CLEAR_FLOOR = 15;

/**
 * How many rows the median speed board renders.
 *
 * **Also fifteen, and unrelated to the floor above it** — one is a count of Helpers, the
 * other a count of each Helper's clears, and they collide on the same literal by
 * coincidence. Named separately because this repo has been bitten by exactly this shape
 * before: ADR 0001's active-session cap is two limits in two units, and conflating them
 * silently dropped the longest-running raids. A caller passing a bare `15` cannot say
 * which fifteen it meant.
 */
export const MEDIAN_SPEED_BOARD_ROWS = 15;

export interface ArchiveMedianSpeedHelper {
    membershipId: string;
    /** `Name#Code` in full, via formatBungieDisplayName. */
    displayName: string;
    /** Pinned Full Clears in range. Distinct instances, never player rows. */
    clears: number;
    /**
     * Raw seconds, and **fractional for an even clear count** — the mean of the two
     * middle clears, so 18 clears can legitimately return 725.5. Rendered by
     * formatMedianDuration() in src/app/gos10k/duration-copy.ts, which is where the
     * decision to round it is made.
     */
    medianSeconds: number;
}

/**
 * Helpers ranked by their median Pinned Full Clear duration in range — who is
 * consistently fast, as distinct from who had one good night (#92).
 *
 * **Median rather than mean**, because this dataset contains AFK runs: the fixture's
 * slowest clear is over five hours, and one of those in a Helper's 20 runs moves a mean
 * by minutes while leaving a median untouched. The floor is
 * {@link MEDIAN_SPEED_CLEAR_FLOOR} and is what keeps a two-clear player off the top.
 *
 * SQLite has no `median()`, so it is computed the standard way: number each Helper's
 * clears by duration, then average the middle one or two. `position IN ((clears + 1) /
 * 2, (clears + 2) / 2)` is integer division, so an odd count selects one row twice over
 * (both expressions land on the same position, and `IN` is a set) and an even count
 * selects the two either side of the middle. The alternative — reading every (Helper,
 * duration) pair into TypeScript — is ~60,000 rows per request in production for a
 * fifteen-row board.
 *
 * `SELECT DISTINCT (membership, instance, duration)` in the first CTE is hazard 1: a
 * Helper who brought three characters to one raid is one clear with one duration, not
 * three. Counting rows there would inflate a clear count past the floor *and* weight
 * that Run three times in the median.
 *
 * Two statements rather than one, as {@link getFastestClears}: ranking first and reading
 * the names of exactly the memberships that made the board keeps `LIMIT` denominated in
 * Helpers, and keeps the window functions off a query that also has to GROUP BY names.
 */
export function getMedianSpeedBoard(
    limit: number = MEDIAN_SPEED_BOARD_ROWS,
    range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE
): ArchiveMedianSpeedHelper[] {
    const db = getArchiveDb();
    const scope = rangeClause(range);

    // `clears DESC, membershipId` after the median is not decoration: the fixture alone
    // ties two Helpers at 884 seconds on the fifteenth row, so untied it is the query
    // plan that decides which of them a reader sees at all. More clears wins the tie —
    // the board is about consistency, and 61 clears is more evidence of it than 15.
    const ranked = db.prepare(`
        WITH helper_clears AS (
            SELECT DISTINCT
                p.membership_id     AS membershipId,
                r.instance_id       AS instanceId,
                r.duration_seconds  AS durationSeconds
            FROM gos_10k_pgcr_players p
            JOIN gos_10k_runs r ON r.instance_id = p.instance_id
            WHERE p.membership_id != ? AND ${PINNED_FULL_CLEAR} ${scope.sql}
        ),
        ordered AS (
            SELECT
                membershipId,
                durationSeconds,
                ROW_NUMBER() OVER (
                    PARTITION BY membershipId ORDER BY durationSeconds, instanceId
                ) AS position,
                COUNT(*) OVER (PARTITION BY membershipId) AS clears
            FROM helper_clears
        )
        SELECT
            membershipId,
            clears,
            AVG(durationSeconds) AS medianSeconds
        FROM ordered
        WHERE clears >= ? AND position IN ((clears + 1) / 2, (clears + 2) / 2)
        GROUP BY membershipId, clears
        ORDER BY medianSeconds ASC, clears DESC, membershipId ASC
        LIMIT ?
    `).all(
        SUBJECT_MEMBERSHIP_ID,
        ...scope.params,
        MEDIAN_SPEED_CLEAR_FLOOR,
        limit
    ) as Array<{ membershipId: string; clears: number; medianSeconds: number }>;

    if (ranked.length === 0) return [];

    // Parameterised `IN` over the memberships just ranked — bounded by `limit`, and
    // every value came out of this database a statement ago.
    const placeholders = ranked.map(() => '?').join(', ');
    const nameRows = db.prepare(`
        SELECT
            p.membership_id AS membershipId,
            ${PLAYER_NAME_PROJECTION}
        FROM gos_10k_pgcr_players p
        WHERE p.membership_id IN (${placeholders})
        GROUP BY p.membership_id
    `).all(...ranked.map((helper) => helper.membershipId)) as Array<{
        membershipId: string;
        displayName: string | null;
        bungieGlobalDisplayName: string | null;
        bungieGlobalDisplayNameCode: number | null;
    }>;

    const names = new Map(nameRows.map((row) => [row.membershipId, row]));

    return ranked.map((helper) => {
        const name = names.get(helper.membershipId);
        return {
            membershipId: helper.membershipId,
            // A missing name row is unreachable — these memberships came out of this
            // same table one statement ago — and the display ladder's own last rung is
            // the membership id, so there is nothing for a fallback object to add.
            displayName: name ? formatBungieDisplayName(name) : helper.membershipId,
            clears: helper.clears,
            medianSeconds: helper.medianSeconds,
        };
    });
}

/** One calendar month of the Archive's history, whether or not anything happened in it. */
export interface ArchiveTimelineMonth {
    /** `YYYY-MM`, UTC — the same zone `period` and the range filter are in. */
    month: string;
    /** Pinned Full Clears whose Run began in this month. Zero for an empty month. */
    clears: number;
    /** Pinned Full Clears from the Archive's first month through the end of this one. */
    cumulativeClears: number;
}

/**
 * The timeline's data (#88): every calendar month of the Archive, with that month's
 * Pinned Full Clears and the running total through the end of it.
 *
 * **This is the one panel query that takes no range, and that is the ticket's point.**
 * #81: "The filter is global. Every panel obeys it, with one deliberate exception: the
 * timeline always draws the full history and shades the selection." Giving this function
 * a `range` parameter and splicing {@link rangeClause} into it — which is what every
 * panel since #87 does, so it is the shape a reader will reach for — returns a
 * correct-looking chart that has silently truncated six years of history to one February.
 * The shading is the *component's* job, from `periodFrom`/`periodTo` on the resolved
 * range; there is deliberately no argument here through which the data could be narrowed.
 *
 * **The gap-filling is not decoration either.** `GROUP BY strftime('%Y-%m', …)` returns
 * only the months that hold a Run, so a chart drawn straight off it renders a two-year
 * pause as the space between two adjacent bars: an x-axis that is no longer proportional
 * to time and that looks entirely correct. {@link getRunsByYear} is the existing
 * `strftime` precedent and does *not* fill its gaps — it is a table, where a missing year
 * is a missing row rather than a squashed axis — so it is the wrong thing to copy here.
 *
 * The axis is anchored to the Archive's own extent, from the first Run to the last, and
 * never to the clock. A timeline ending at "now" would grow an empty tail every month
 * against a dataset that stopped moving in 2026 (#71's bug class; see the note in
 * docs/progress/gos10k-phase1.md).
 *
 * Months are enumerated in TypeScript rather than by a recursive CTE ({@link monthsBetween}):
 * the sequence is plain integer arithmetic over two `YYYY-MM` strings, and doing it in SQL
 * would mean a date-arithmetic CTE nobody can read for the sake of avoiding a loop over
 * ~68 rows. The resulting month list is *contiguous*, which the timeline's geometry
 * depends on to treat position on the axis as position in time.
 *
 * The axis's two ends come from {@link getArchiveSpan}, defaulted the way
 * {@link resolveArchiveRange} defaults it, so the page can read the span once and hand
 * it to the header, the presets and this chart alike. A second MIN/MAX of `period`
 * spelled out here would be both a second aggregate per request and a second definition
 * of where the Archive starts — and the header stating one extent above a chart drawn to
 * another is a disagreement nothing would catch. **A span is not a range**: it narrows
 * nothing, which is why this is still not the truncation hazard the note above describes.
 */
export function getMonthlyClears(
    span: ArchiveSpan = getArchiveSpan()
): ArchiveTimelineMonth[] {
    const db = getArchiveDb();

    if (span.firstRunAt === null || span.lastRunAt === null) return [];

    // The span's instants reduced to the same UTC month keys the buckets use, so the two
    // cannot disagree about which month a Run at 23:50 on the last of the month belongs
    // to. `formatArchiveDate` is the one UTC `YYYY-MM-DD` spelling in this database's
    // code; a month key is its first seven characters.
    const firstMonth = formatArchiveDate(span.firstRunAt).slice(0, 7);
    const lastMonth = formatArchiveDate(span.lastRunAt).slice(0, 7);

    // `MAX(r.clear_number)` is the cumulative total, read rather than re-derived: the
    // ordinal is ranked over this same predicate by `period` ascending (ADR 0008), so the
    // highest ordinal inside a month *is* the count of Pinned Full Clears through the end
    // of it. Summing `clears` in TypeScript reaches the same number today; it reaches it
    // by a second derivation of the ordinal every other panel reads from the column, and
    // ADR 0008 is explicit that "an ordinal eight call sites re-derive is an ordinal eight
    // call sites can re-derive differently". The failure that buys off: were this
    // predicate ever to drift to the disjunctive rule, a summed line would climb to 10,020
    // while the range filter above it still spoke in clear numbers 1-10,000 — two axes
    // silently disagreeing, both plausible. Reading the column breaks the *bars* instead,
    // visibly, and the test asserts the two halves still agree.
    const buckets = db.prepare(`
        SELECT
            strftime('%Y-%m', r.period, 'unixepoch') AS month,
            COUNT(*) AS clears,
            MAX(r.clear_number) AS lastClearNumber
        FROM gos_10k_runs r
        WHERE ${PINNED_FULL_CLEAR}
        GROUP BY month
    `).all() as Array<{ month: string; clears: number; lastClearNumber: number }>;

    const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));

    let cumulative = 0;
    return monthsBetween(firstMonth, lastMonth).map((month) => {
        const bucket = byMonth.get(month);
        // An empty month carries the previous total forward: nothing happened, so the
        // line is flat across it rather than absent.
        cumulative = bucket?.lastClearNumber ?? cumulative;
        return { month, clears: bucket?.clears ?? 0, cumulativeClears: cumulative };
    });
}

