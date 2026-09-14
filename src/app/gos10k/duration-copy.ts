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
 * **There is a second formatter of this shape in the repo** — a private `formatDuration`
 * in the Tracker's PlayerProfileClient.tsx, differing only in mapping null to `'N/A'`.
 * It is not imported here, and the honest reason is scope rather than architecture: the
 * argument that importing it would drag a `'use client'` boundary across the two
 * databases is true of *that* file but does not rule out the obvious third option, which
 * is extracting a pure `formatDuration` both call — exactly what ./predicates.ts already
 * did when the build script needed a fragment out of a module it could not import.
 *
 * That extraction touches a Tracker feature and #91 is an Archive ticket, so it is left
 * undone and written down instead of argued away. #91's own criterion — one duration
 * implementation shared by this panel and #92's median speed board — is satisfied by
 * this file. Collapsing the Tracker's into it is a follow-up, not a thing this comment
 * should pretend was already decided.
 */

/**
 * `7:33` under an hour, `3:23:54` over it.
 *
 * `m:ss` is how a raid time is spoken, so minutes are unpadded and seconds always are —
 * `7:3` is not a time. Hours appear only when there are some: every Pinned Full Clear
 * worth ranking is minutes long, and a permanently-zero `0:07:33` would be noise on
 * every row to serve the handful of AFK runs at the bottom of the table.
 */
export function formatRunDuration(seconds: number): string {
    // Floor rather than round, and clamp at zero: the column is an integer count of
    // seconds today, and a formatter that can emit `-1:-1` for a bad row is worse than
    // one that reads `0:00`.
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

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

/**
 * A share of the clears' time, as a percentage — the presence strip's headline (#89).
 *
 * A ratio of two durations rather than a duration, and it lives here because both of
 * its inputs are this file's subject. One decimal, because the reference figure is
 * 91.55%: a whole number prints 92% beside a spec that says "roughly 91%", and the
 * disagreement is nothing but a rounding choice. A trailing `.0` is dropped — `100%`,
 * not `100.0%` — because the round figures are exact ones.
 *
 * **Deliberately not clamped.** Presence cannot exceed the Run, and in production it
 * never does; if a data fault ever made it, `104%` on the page is the fault being
 * visible, where a clamp would render it as a clean 100%. `—` for a non-finite share,
 * the 0-of-0 seconds a range with no clears produces: the panel guards on that case
 * first, but a formatter that can print `NaN%` is a guard nobody can see.
 */
export function formatClearTimeShare(share: number): string {
    if (!Number.isFinite(share)) return '—';
    const percent = (share * 100).toFixed(1);
    return `${percent.endsWith('.0') ? percent.slice(0, -2) : percent}%`;
}
