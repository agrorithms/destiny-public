/**
 * How the Archive page renders a run duration.
 *
 * One formatter, deliberately, because two panels render the same column: the
 * fastest-clears list (#91) and the median speed board (#92). The queries return raw
 * seconds — `gos_10k_runs.duration_seconds` is an integer and stays one — so the
 * decision of whether 453 reads as `453`, `7m 33s` or `7:33` is made here and nowhere
 * else. A second implementation is not a style problem; it is how the same number
 * renders two ways on one page.
 *
 * Page-level copy rather than SQL, which is why it sits beside range-copy.ts under
 * src/app/gos10k/ instead of in the query module. It needs no database and no range.
 *
 * **The digits themselves are no longer assembled here.** The Tracker's player profile
 * carried a private `formatDuration` of the same shape, differing only in mapping null
 * to `'N/A'`; #109 collapsed the two into `formatRunDuration` in
 * `src/lib/utils/helpers.ts` — pure, so neither a `'use client'` boundary nor a database
 * connection has to cross the Tracker/Archive split to reach it, the same move
 * ./predicates.ts made when the build script needed a fragment out of a module it could
 * not import.
 *
 * Re-exporting that function rather than re-implementing it is what keeps #91's own
 * criterion true: this file is still the single implementation the Archive page uses,
 * and there is still no way for the fastest-clears list and the median speed board to
 * render the same number two ways. The Archive's *copy decisions* — rounding, hours,
 * the mean/median naming below — stay here, because they are page copy and not
 * arithmetic.
 */

import { formatRunDuration as formatSharedRunDuration } from '@/lib/utils/helpers';

/**
 * `7:33` under an hour, `3:23:54` over it.
 *
 * `m:ss` is how a raid time is spoken, so minutes are unpadded and seconds always are —
 * `7:3` is not a time. Hours appear only when there are some: every Pinned Full Clear
 * worth ranking is minutes long, and a permanently-zero `0:07:33` would be noise on
 * every row to serve the handful of AFK runs at the bottom of the table.
 *
 * The parameter is narrowed back to `number`. The shared function also accepts
 * `null | undefined` for the Tracker's sake, but every duration on this page comes from
 * `gos_10k_runs.duration_seconds`, a NOT NULL integer — a nullish value reaching an
 * Archive column would be a bug, and should fail to typecheck rather than quietly
 * render `N/A` in a ranked table.
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
