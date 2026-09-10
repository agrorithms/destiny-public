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
 * The Tracker's player profile has a formatter of the same shape, private to
 * PlayerProfileClient.tsx. It is deliberately not imported here: that file is a
 * thousand-line `'use client'` component, and pulling a server component's copy out of
 * it would drag the client boundary across the two databases the repo keeps apart. The
 * duplication is one function and it is named here so a future reader knows it was
 * weighed rather than missed.
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
