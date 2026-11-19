import { expect, test } from './support/test-fixtures';
import { SPOOFED_ORIGIN, writeHeaders } from './support/write-request';
import { buildActiveProfile } from '../tests/helpers/bungie-profile-builder';
import { getActiveSessionContainingPlayer, getPlayerIdentity } from '../src/lib/db/queries';
import { ANY_AGE_SECONDS } from './support/seed-world';

/**
 * The players API's write surface, exercised over real HTTP against the running server.
 *
 * Since #9001 a browser never writes session or identity data to the Tracker. One client-write
 * route is left, `queue-crawl`, which takes ids and asks the crawler to look; the routes that
 * took a posted Bungie profile or posted player names are gone. This spec proves both halves:
 *
 *   - the request-authenticity guard (issue #24) still sits on `queue-crawl`: a positive
 *     control, a spoofed origin, no origin and no referer, no page token;
 *   - the poll-request route, `profile-viewed` (#9003), sits behind the same guard and the
 *     middleware's per-address bucket;
 *   - a POST to either retired path is answered 404 or 405 and leaves no row behind.
 *
 * Why over HTTP: src/lib/http/request-auth.test.ts covers the guard's logic and
 * tests/routes/queue-crawl.test.ts its 403 branch, but neither goes through the HTTP stack.
 * middleware.ts matches `/api/players/:path*` and its rate limiter runs *before* the route's
 * guard, so every negative asserts the body, not just the status: `{error:'Forbidden'}` is
 * what tells the guard's 403 apart from middleware's 429. See issue #66.
 *
 * Every request goes through APIRequestContext, not a page. The `test` import is still the
 * fixtures one, per the suite-wide convention; its network guard is an `auto` fixture that
 * depends on `page`, so a page is created per test and nothing routes through it.
 */

// Namespace prefix 85 (81 = active-sessions-cap, 82 = player-names, 83 = profile-live-card,
// 84 = profile-roster-names), per the convention in docs/e2e-coverage.md §2.
const CONTROL_ID = '4611686018488500001';
const RETIRED_PROFILE_ID = '4611686018488500002';
const RETIRED_IDENTITY_ID = '4611686018488500003';
const POLL_ID = '4611686018488500004';

// A well-formed body on the negatives too. The guard runs before request.json(), so an
// empty body would 403 either way, but if the guard were ever deleted a valid body makes the
// test fail as a successful write rather than as a 400 that reads like a body problem.
const queueCrawlBody = { membershipId: CONTROL_ID, membershipType: 3 };

test.describe('players API write guard over HTTP', () => {
    // The positive control. Without it a 403 proves nothing: a typo'd path or a guard that
    // rejects everything would read as green. Asserts the body, not just "not 403": the
    // cooldown branch answers 200 with {queued:false}, which did nothing at all.
    test('valid origin and token: the crawl request is queued', async ({ request }) => {
        const response = await request.post('/api/players/queue-crawl', {
            headers: writeHeaders({ ip: '85.0.0.1' }),
            data: queueCrawlBody,
        });

        expect(response.status()).toBe(202);
        expect(await response.json()).toEqual({ queued: true });
    });

    test('spoofed origin is rejected by the guard, not by middleware', async ({ request }) => {
        const response = await request.post('/api/players/queue-crawl', {
            headers: writeHeaders({ origin: SPOOFED_ORIGIN, ip: '85.0.0.2' }),
            data: queueCrawlBody,
        });

        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });
    });

    // APIRequestContext sends no Origin of its own, so omitting it also leaves Referer unset:
    // the both-headers-absent case isSameOrigin() falls through to. A scripted client does this.
    test('no origin and no referer is rejected', async ({ request }) => {
        const response = await request.post('/api/players/queue-crawl', {
            headers: writeHeaders({ origin: null, ip: '85.0.0.3' }),
            data: queueCrawlBody,
        });

        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });
    });

    // Also the check on the pin itself: verifyPageToken() fails open when no
    // PAGE_TOKEN_SECRET reaches the server, and a tokenless request would then be allowed
    // through. See E2E_PAGE_TOKEN_SECRET in e2e/support/fixture-db.ts.
    test('valid origin with no page token is rejected', async ({ request }) => {
        const response = await request.post('/api/players/queue-crawl', {
            headers: writeHeaders({ omitToken: true, ip: '85.0.0.4' }),
            data: queueCrawlBody,
        });

        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });
    });

    // The poll request route (#9003) sits behind the same guard. The positive control is
    // profile-poll-request.spec.ts, where a real page's request is answered 202.
    test('profile-viewed: a spoofed origin, no origin and no page token are each rejected by the guard', async ({ request }) => {
        const body = { membershipId: POLL_ID, membershipType: 3 };
        const cases = [
            writeHeaders({ origin: SPOOFED_ORIGIN, ip: '85.0.0.7' }),
            writeHeaders({ origin: null, ip: '85.0.0.7' }),
            writeHeaders({ omitToken: true, ip: '85.0.0.7' }),
        ];
        for (const headers of cases) {
            const response = await request.post('/api/players/profile-viewed', { headers, data: body });
            expect(response.status()).toBe(403);
            expect(await response.json()).toEqual({ error: 'Forbidden' });
        }
    });

    // Covered by the middleware's `players-read` bucket like every /api/players/ route: 60 a
    // minute per address, answered before the route runs. Bad ids keep the first 60 requests
    // from queueing anything; the 61st is middleware's 429, whose body is not the route's.
    test('profile-viewed: the 61st request in a minute from one address is cut off by the middleware', async ({ request }) => {
        const headers = writeHeaders({ ip: '85.0.0.8' });
        const statuses: number[] = [];
        for (let i = 0; i < 61; i++) {
            const response = await request.post('/api/players/profile-viewed', { headers, data: { membershipId: 'x', membershipType: 3 } });
            statuses.push(response.status());
            if (i === 60) expect(await response.json()).toEqual({ error: 'Too many requests. Please try again shortly.' });
        }
        expect(statuses.slice(0, 60).every((status) => status === 400)).toBe(true);
        expect(statuses[60]).toBe(429);
    });

    // Sent with everything the guard wants (origin, token), so only the route's absence can
    // stop them.
    test('the posted-profile route is gone and stores nothing', async ({ request }) => {
        const response = await request.post('/api/players/active-session-update', {
            headers: writeHeaders({ ip: '85.0.0.5' }),
            data: {
                membershipId: RETIRED_PROFILE_ID,
                membershipType: 3,
                profileResponse: buildActiveProfile({ membershipId: RETIRED_PROFILE_ID, bungieGlobalDisplayName: 'Retired85' }),
            },
        });

        expect([404, 405]).toContain(response.status());
        expect(getActiveSessionContainingPlayer(RETIRED_PROFILE_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(getPlayerIdentity(RETIRED_PROFILE_ID)).toBeNull();
    });

    test('the posted-identity route is gone and stores nothing', async ({ request }) => {
        const response = await request.post('/api/players/identity', {
            headers: writeHeaders({ ip: '85.0.0.6' }),
            data: {
                membershipId: RETIRED_IDENTITY_ID,
                membershipType: 3,
                bungieGlobalDisplayName: 'Retired85',
                bungieGlobalDisplayNameCode: 8503,
            },
        });

        expect([404, 405]).toContain(response.status());
        expect(getPlayerIdentity(RETIRED_IDENTITY_ID)).toBeNull();
    });
});
