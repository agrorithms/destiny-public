/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert an ISO date string to a Unix timestamp (seconds)
 */
export function isoToUnix(isoString: string): number {
    return Math.floor(new Date(isoString).getTime() / 1000);
}

/**
 * Get a Unix timestamp (seconds) for N hours ago
 */
export function hoursAgo(hours: number): number {
    return Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
}

/**
 * Format a Unix timestamp to a human-readable string
 */
export function formatTimestamp(unix: number): string {
    return new Date(unix * 1000).toLocaleString();
}

/**
 * Truncate a string to a max length
 */
export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
}

/**
 * A raid run's duration: `7:33` under an hour, `3:23:54` over it (#109).
 *
 * **The one implementation both databases render a run duration through.** The Archive's
 * fastest-clears list and median speed board reach it via
 * `src/app/gos10k/duration-copy.ts`, which re-exports it; the Tracker's player profile
 * imports it directly. Two bodies of this shape is not a style problem — it is how `453`
 * ends up beside `7:33` for the same number, which is the failure #91 was written to
 * prevent and which the Tracker's own private copy quietly reintroduced.
 *
 * It lives in this pure module for the reason `src/lib/db/archive/predicates.ts` does:
 * both call sites are `'use client'`-adjacent and sit on opposite sides of the
 * Tracker/Archive split, so the shared piece has to be importable without dragging a
 * database, a React boundary or a `'use client'` directive along with it.
 *
 * `m:ss` is how a raid time is spoken, so minutes are unpadded and seconds always are —
 * `7:3` is not a time. Hours appear only when there are some: a permanently-zero
 * `0:07:33` would be noise on every row to serve the handful of AFK runs.
 *
 * `fallback` is what a missing duration renders as, and defaults to the Tracker's
 * long-standing `'N/A'`. It is a parameter rather than a second function so the digits
 * are still assembled in exactly one place; the Archive's re-export narrows the
 * parameter back to `number`, because a nullish value reaching an Archive column would
 * be a bug rather than a blank cell.
 */
export function formatRunDuration(
    seconds: number | null | undefined,
    fallback = 'N/A',
): string {
    if (seconds === null || seconds === undefined) return fallback;

    // Floor rather than round, and clamp at zero: the Archive's column is an integer
    // count of seconds and the Tracker's is a SQL AVG(), and a formatter that can emit
    // `-1:-1` for a bad row is worse than one that reads `0:00`.
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
