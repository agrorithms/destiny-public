import type { NextResponse } from 'next/server';

export function cacheControl(sMaxAgeSeconds: number, staleWhileRevalidateSeconds: number): string {
    return `public, max-age=0, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}

/**
 * The Archive's cache lifetime — one value feeding both directives, which is the correct
 * shape for a frozen dataset.
 *
 * #95 split this in two for the duration of Phase 1: a temporary
 * `ARCHIVE_BROWSER_MAX_AGE_SECONDS = 60` alongside an unchanged shared 86400, so that a
 * maintainer shipping a panel several times a week did not review yesterday's page. It was
 * two constants rather than one smaller value precisely so the split could be undone without
 * having to re-decide what `s-maxage` should be. Phase 1 has landed, so the split is gone and
 * the shared value it was protecting is what both directives read again.
 *
 * See the 2026-09-04 and 2026-09-08 entries in docs/decisions.md.
 */
const ARCHIVE_MAX_AGE_SECONDS = 86400;

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
    return `public, max-age=${ARCHIVE_MAX_AGE_SECONDS}, s-maxage=${ARCHIVE_MAX_AGE_SECONDS}, immutable`;
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
