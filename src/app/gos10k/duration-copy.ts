/**
 * How the Archive page renders a duration.
 *
 * One formatter per rendering, deliberately, because panels share columns: the
 * fastest-clears list (#91) and the median speed board (#92) print the same run
 * duration, and a second implementation is how the same number reads `453` on one and
 * `7:33` on the other. Page-level copy rather than SQL, which is why it sits beside
 * range-copy.ts instead of in the query module — it needs no database and no range.
 *
 * The digits are no longer assembled here. #109 collapsed this file's `formatRunDuration`
 * and the Tracker profile's private `formatDuration` (identical but for a null branch)
 * into `src/lib/utils/helpers.ts` — pure, so it crosses the Tracker/Archive split without
 * a database or a `'use client'` boundary, the move ./predicates.ts already made. This
 * file re-exports it, which is what keeps #91's criterion true: still one implementation
 * behind the Archive's panels. The Archive's *copy decisions* — rounding, hours, the
 * mean/median naming — stay below, because they are copy and not arithmetic.
 */

import { formatRunDuration as formatSharedRunDuration } from '@/lib/utils/helpers';

/**
 * `7:33` under an hour, `3:23:54` over it — the shared formatter, narrowed to `number`.
 *
 * It also accepts `null | undefined` for the Tracker's sake. Every duration on this page
 * comes from `gos_10k_runs.duration_seconds`, a NOT NULL integer, so a nullish value
 * reaching an Archive column should fail to typecheck rather than quietly render `N/A`
 * in a ranked table.
 */
export const formatRunDuration: (seconds: number) => string = formatSharedRunDuration;

/**
 * A median clear duration, which is the same rendering rule reached through a rounding
 * decision (#92).
 *
 * The median speed board's query returns a *true* median, so an even clear count gives
 * the mean of the two middle Runs and lands on a half-second: 725.5 is the top row of
 * the fixture board. {@link formatRunDuration} floors, by design — it renders an integer
 * column of real Run durations — so handing it 725.5 would print the lower of the two
 * middles on every even-count row and look exactly like a correct answer.
 *
 * Rounding rather than flooring is therefore stated here, once, and delegated for the
 * formatting itself: the board must not be able to render a duration differently from
 * the fastest-clears list above it.
 */
export function formatMedianDuration(seconds: number): string {
    return formatRunDuration(Math.round(seconds));
}

/**
 * A Helper's presence, in hours (#90).
 *
 * A third rendering of a duration on this page and deliberately not
 * {@link formatRunDuration}: the Helper board's time columns are tens of hours across
 * hundreds of Runs, and `28:55:47` reads as a single very long raid rather than as a
 * total. Hours are the unit #81 asks for — "presence measured in hours as well as in
 * counts" — and one decimal is enough to separate adjacent rows without implying the
 * source data is precise to the second.
 *
 * The two small cases are the ones worth stating. Exactly zero — a Helper who was in
 * the Run but had left before he arrived — renders as `0 h` rather than `0.0 h`,
 * because it is a real nothing rather than a rounded something. Anything under six
 * minutes renders as `<0.1 h`, because `0.0 h` for a Helper who was demonstrably there
 * says the opposite of what the row means. Both are reachable on the show-all view,
 * where the tail of the board is people who appeared once.
 */
export function formatPresenceHours(seconds: number): string {
    const total = Math.max(0, seconds);
    if (total === 0) return '0 h';

    const hours = total / 3600;
    if (hours < 0.1) return '<0.1 h';
    return `${hours.toFixed(1)} h`;
}

/**
 * An average duration — the presence strip's average clear and his average time in one
 * (#89). The same function as {@link formatMedianDuration}, because it is the same
 * rounding decision for the same reason: a total divided by a clear count is fractional,
 * and flooring it would print a plausible second too few. A second name rather than a
 * second body, so the panel does not read as though it rendered a median.
 */
export const formatMeanDuration = formatMedianDuration;
