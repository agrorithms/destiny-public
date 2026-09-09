import type { NextResponse } from 'next/server';

export function cacheControl(sMaxAgeSeconds: number, staleWhileRevalidateSeconds: number): string {
    return `public, max-age=0, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}

/**
 * The Archive's shared-cache lifetime. A frozen dataset's correct value, unchanged, and
 * inert in practice: the route is DYNAMIC at the Cloudflare edge by an accepted decision
 * (docs/decisions.md, 2026-09-04) and no cache rule stores it.
 */
const ARCHIVE_SHARED_MAX_AGE_SECONDS = 86400;

/**
 * TEMPORARY — shortened for active UI iteration on /gos10k (issue #95, spec #81).
 *
 * The correct lifetime for a frozen dataset is long, and 86400 is what this was. But while
 * Phase 1 lands a panel at a time, a day-long *browser* cache means a maintainer ships a
 * change and then reviews yesterday's page. The lever is the lifetime, not the directive:
 * dropping `immutable` would change nothing, because a browser will not revalidate inside
 * `max-age` either way.
 *
 * Deliberately separate from the shared lifetime above, rather than one constant feeding
 * both. #81 scopes this to the browser — "the only lever is the max-age value" — and #95
 * requires that nothing else about the emitted header change. Collapsing the two would
 * quietly move `s-maxage` too.
 *
 * RESTORE to 86400 once the /gos10k UI settles, which collapses this back into the
 * constant above — tracked as the closing action on #80.
 */
const ARCHIVE_BROWSER_MAX_AGE_SECONDS = 60;

/**
 * For the Archive: a frozen, complete dataset whose last row was written before the
 * page existed and that will never gain another. This is the one place on the site
 * where a stale response is not a bug but the correct answer, so it gets a real
 * browser `max-age` and `immutable` rather than the `max-age=0, s-maxage=N` shape the
 * live routes use — there is nothing to revalidate.
 *
 * Setting it here is only half the story. Cloudflare cache rules, which are not in this
 * repo, rewrite what actually reaches the browser: a rule with no Browser TTL falls back
 * to a 4h zone default, which is how /api/live-stats once served max-age=14400 from a
 * repo that had never emitted a non-zero max-age. Check `cf-cache-status` and the header
 * prod returns before trusting this. See docs/decisions.md.
 *
 * `middleware.ts` matches `/gos10k/*` as well as `/gos10k`, so this also sets the header on
 * `/gos10k/opengraph-image` — the share card gets the same lifetimes as the page.
 */
export function archiveCacheControl(): string {
    return `public, max-age=${ARCHIVE_BROWSER_MAX_AGE_SECONDS}, s-maxage=${ARCHIVE_SHARED_MAX_AGE_SECONDS}, immutable`;
}

export function noStore(): string {
    return 'no-store';
}

export function withCache<T extends NextResponse>(response: T, sMaxAgeSeconds: number, staleWhileRevalidateSeconds: number): T {
    response.headers.set('Cache-Control', cacheControl(sMaxAgeSeconds, staleWhileRevalidateSeconds));
    return response;
}

export function withNoStore<T extends NextResponse>(response: T): T {
    response.headers.set('Cache-Control', noStore());
    return response;
}
