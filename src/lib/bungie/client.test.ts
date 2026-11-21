import { afterEach, describe, expect, it, vi } from 'vitest';
import { bungieEnvelope } from '../../../tests/helpers/bungie-profile-builder';
import { BungieAPIError, BungieClient, diffRequestCounts, type RequestCounts } from './client';

/**
 * Mocked at the fetch boundary only — never at our own module boundaries.
 * Stubbing `getPGCR` would test the stub; stubbing `fetch` tests the response
 * handling that actually decides whether a raid gets ingested or dropped.
 *
 * `request()` does no retrying. What it does is classify a failure and, when
 * Bungie signals throttling, pause the shared per-key rate limiter — because the
 * throttle applies to the key, not to the one request that happened to see it.
 * These tests cover that classification and that dispatch.
 */

const PGCR_BODY = {
    Response: { activityDetails: { instanceId: '123' } },
    ErrorCode: 1,
    ErrorStatus: 'Success',
    Message: 'Ok',
    ThrottleSeconds: 0,
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
}

/** High RPS so ordinary spacing never interferes with what a test is asserting. */
function makeClient(): BungieClient {
    return new BungieClient('test-api-key', 1000);
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('successful responses', () => {
    it('returns the parsed payload', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(PGCR_BODY)));

        const result = await makeClient().getPGCR('123');

        expect(result.Response.activityDetails.instanceId).toBe('123');
    });

    it('authenticates with the API key header', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PGCR_BODY));
        vi.stubGlobal('fetch', fetchMock);

        await makeClient().getPGCR('123');

        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers['X-API-Key']).toBe('test-api-key');
    });

    it('requests the PGCR from the stats host', async () => {
        // PGCRs live on stats.bungie.net, not www.bungie.net. Getting this wrong
        // fails every ingestion path at once.
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PGCR_BODY));
        vi.stubGlobal('fetch', fetchMock);

        await makeClient().getPGCR('123');

        expect(String(fetchMock.mock.calls[0][0])).toContain(
            'stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/123/'
        );
    });
});

describe('Bungie-level errors', () => {
    it('raises a typed error carrying Bungie\'s own code and status', async () => {
        // The type matters: isBungieSystemDisabledError is instanceof-based, so a
        // generic Error here would stop the crawler ever pausing for maintenance.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({
                    Response: null,
                    ErrorCode: 5,
                    ErrorStatus: 'SystemDisabled',
                    Message: 'This system is temporarily disabled.',
                    ThrottleSeconds: 0,
                })
            )
        );

        const error = await makeClient().getPGCR('123').catch((e) => e);

        expect(error).toBeInstanceOf(BungieAPIError);
        expect(error.errorCode).toBe(5);
        expect(error.errorStatus).toBe('SystemDisabled');
    });

    it('raises an untyped error for a plain HTTP failure', async () => {
        // A 5xx is not a Bungie-level error — the body may not even be JSON — so it
        // must not masquerade as one.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response('<html>gateway timeout</html>', { status: 504 }))
        );

        const error = await makeClient().getPGCR('123').catch((e) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(BungieAPIError);
        expect(error.message).toContain('504');
    });

    it('survives a non-JSON error body without masking the failure', async () => {
        // Cloudflare serves HTML error pages. The 1672 inspection parses the body,
        // so it must swallow the parse failure and still throw.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(new Response('<!DOCTYPE html><h1>502</h1>', { status: 502 }))
        );

        await expect(makeClient().getPGCR('123')).rejects.toThrow(/502/);
    });
});

describe('throttle handling pauses the whole key', () => {
    it('defers the next request after Bungie reports a throttle', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ ...PGCR_BODY, ThrottleSeconds: 4 }))
        );
        const client = makeClient();

        await client.getPGCR('123');

        const second = trackSettled(client.getPGCR('456'));
        await vi.advanceTimersByTimeAsync(3999);
        expect(second.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(20);
        expect(second.settled).toBe(true);
    });

    it('honours Retry-After on an HTTP 429', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('rate limited', { status: 429, headers: { 'Retry-After': '7' } })
            )
        );
        const client = makeClient();

        await client.getPGCR('123').catch(() => {});

        const second = trackSettled(client.getPGCR('456').catch(() => {}));
        await vi.advanceTimersByTimeAsync(6999);
        expect(second.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(20);
        expect(second.settled).toBe(true);
    });

    it('falls back to a five second pause when 429 omits Retry-After', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        const client = makeClient();

        await client.getPGCR('123').catch(() => {});

        const second = trackSettled(client.getPGCR('456').catch(() => {}));
        await vi.advanceTimersByTimeAsync(4999);
        expect(second.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(20);
        expect(second.settled).toBe(true);
    });

    it('imposes its own backoff for a game-server throttle, which reports no duration', async () => {
        // ErrorCode 1672 arrives as a 503 with ThrottleSeconds: 0. Bungie tells us
        // to back off without saying how long, so retrying immediately would just
        // earn another 503. Default self-imposed pause is 2s.
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({ ErrorCode: 1672, ErrorStatus: 'DestinyThrottledByGameServer', ThrottleSeconds: 0 }),
                    { status: 503 }
                )
            )
        );
        const client = makeClient();

        await client.getPGCR('123').catch(() => {});

        const second = trackSettled(client.getPGCR('456').catch(() => {}));
        await vi.advanceTimersByTimeAsync(1999);
        expect(second.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(20);
        expect(second.settled).toBe(true);
    });
});

describe('request counts', () => {
    const OK = bungieEnvelope({});

    function stubOk(): void {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(OK)));
    }

    it('starts at zero in every field', () => {
        expect(makeClient().getRequestCounts()).toEqual({
            activityHistory: 0, pgcr: 0, profileIdsOnly: 0, profileOther: 0, linkedProfiles: 0,
            other: 0, throttled429: 0, throttled1672: 0, throttledBungie: 0,
        });
    });

    it('counts each endpoint on its own', async () => {
        stubOk();
        const client = makeClient();

        await client.getActivityHistory(3, '1', '2', { mode: 4 });
        await client.getActivityHistory(3, '1', '2', { mode: 4 });
        await client.getPGCR('9');
        await client.getLinkedProfiles('1');
        await client.getLinkedProfiles('1');
        await client.getLinkedProfiles('1');
        await client.getManifest();
        await client.searchDestinyPlayerByBungieName('a', 1);

        expect(client.getRequestCounts()).toMatchObject({
            activityHistory: 2, pgcr: 1, linkedProfiles: 3, other: 2,
            profileIdsOnly: 0, profileOther: 0,
        });
    });

    it('splits profile calls: exactly [100] is the id refresh, anything else is the poll', async () => {
        stubOk();
        const client = makeClient();

        await client.getProfile(3, '1', [100]);
        await client.getProfile(3, '1', [100]);
        await client.getProfile(3, '1', [204, 1000]);
        await client.getProfile(3, '1', [100, 200]);
        await client.getProfile(3, '1', [200]);
        await client.getProfile(3, '1', []);

        expect(client.getRequestCounts()).toMatchObject({ profileIdsOnly: 2, profileOther: 4 });
    });

    it('counts a request that fails, in its endpoint and in no throttle bucket', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })));
        const client = makeClient();

        await client.getPGCR('1').catch(() => {});

        expect(client.getRequestCounts()).toMatchObject({
            pgcr: 1, throttled429: 0, throttled1672: 0, throttledBungie: 0,
        });
    });

    it('counts a Bungie-level error that carries no throttle as an ordinary request', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...OK, ErrorCode: 5 })));
        const client = makeClient();

        await client.getPGCR('1').catch(() => {});

        expect(client.getRequestCounts()).toMatchObject({
            pgcr: 1, throttled429: 0, throttled1672: 0, throttledBungie: 0,
        });
    });

    it('counts an HTTP 429 in its endpoint and in the 429 bucket only', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
        const client = makeClient();

        await client.getPGCR('1').catch(() => {});

        expect(client.getRequestCounts()).toMatchObject({
            pgcr: 1, throttled429: 1, throttled1672: 0, throttledBungie: 0,
        });
    });

    it('counts ErrorCode 1672 in its endpoint and in the 1672 bucket only', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ ErrorCode: 1672, ThrottleSeconds: 0 }), { status: 503 })
            )
        );
        const client = makeClient();

        await client.getProfile(3, '1', [204]).catch(() => {});

        expect(client.getRequestCounts()).toMatchObject({
            profileOther: 1, throttled429: 0, throttled1672: 1, throttledBungie: 0,
        });
    });

    it('counts a Bungie ThrottleSeconds in its endpoint and in the Bungie bucket only', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...OK, ThrottleSeconds: 3 })));
        const client = makeClient();

        await client.getLinkedProfiles('1');

        expect(client.getRequestCounts()).toMatchObject({
            linkedProfiles: 1, throttled429: 0, throttled1672: 0, throttledBungie: 1,
        });
    });

    it('keeps instances apart', async () => {
        stubOk();
        const a = makeClient();
        const b = makeClient();

        await a.getPGCR('1');

        expect(a.getRequestCounts().pgcr).toBe(1);
        expect(b.getRequestCounts().pgcr).toBe(0);
    });

    it('hands out a copy: mutating a snapshot does not change the next one', async () => {
        stubOk();
        const client = makeClient();
        await client.getPGCR('1');

        const first = client.getRequestCounts();
        first.pgcr = 99;

        expect(client.getRequestCounts().pgcr).toBe(1);
    });

    it('a minute\'s counts are the later snapshot minus the earlier, in every field', () => {
        const prev: RequestCounts = {
            activityHistory: 1, pgcr: 2, profileIdsOnly: 3, profileOther: 4, linkedProfiles: 5,
            other: 6, throttled429: 7, throttled1672: 8, throttledBungie: 9,
        };
        const next: RequestCounts = {
            activityHistory: 11, pgcr: 12, profileIdsOnly: 13, profileOther: 14, linkedProfiles: 15,
            other: 16, throttled429: 17, throttled1672: 18, throttledBungie: 19,
        };

        expect(diffRequestCounts(prev, next)).toEqual({
            activityHistory: 10, pgcr: 10, profileIdsOnly: 10, profileOther: 10, linkedProfiles: 10,
            other: 10, throttled429: 10, throttled1672: 10, throttledBungie: 10,
        });
    });
});

function trackSettled(promise: Promise<unknown>): { settled: boolean } {
    const state = { settled: false };
    promise.then(
        () => { state.settled = true; },
        () => { state.settled = true; }
    );
    return state;
}
