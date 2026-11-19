import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSessionPoll } from '@/lib/db/queries';
import { buildWriteRequest, type WriteRequestOptions } from '../helpers/build-write-request';
import { testDb } from '../helpers/db';
import { withDbQuiesced } from '../helpers/db-quiesce';
import { seedActiveSession, seedPlayer } from '../helpers/seed';
import { installWriteRouteEnv } from './write-route-setup';

installWriteRouteEnv();

/**
 * POST /api/players/profile-viewed: the one request a profile view sends to ask the crawler to
 * look (ADR 0010). Ids only; it writes no session row and no player row, ever. These tests drive
 * the route handler against a real SQLite file and read the queue back as the crawler would.
 *
 * The route's limiters are module state, so each test loads a fresh copy of the route.
 */

const VIEWED = '4611686018488900001';
const MATE = '4611686018488900002';

type Post = (body: Record<string, unknown> | string, options?: WriteRequestOptions) => Promise<Response>;

async function loadRoute(env: Record<string, string> = {}): Promise<Post> {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    const { POST } = await import('@/app/api/players/profile-viewed/route');
    return (body, options) => POST(buildWriteRequest('/api/players/profile-viewed', body, options));
}

function queued(): string[] {
    return (testDb().prepare('SELECT membership_id FROM session_poll_requests ORDER BY membership_id').all() as
        { membership_id: string }[]).map((r) => r.membership_id);
}

/** A known player the crawler is holding off: their profile was private when it last looked. */
function seedPrivacyBackoff(membershipId: string) {
    seedPlayer(membershipId, 'Private#0001', 1);
    testDb().prepare('UPDATE players SET session_privacy_backoff = 1, next_session_eligible_at = unixepoch() + 3600 WHERE membership_id = ?').run(membershipId);
}

function counts() {
    const db = testDb();
    const n = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { sessions: n('active_sessions'), players: n('players') };
}

let post: Post;
beforeEach(async () => {
    post = await loadRoute();
});

describe('what is enqueued', () => {
    it('queues one poll request for a viewed player', async () => {
        const response = await post({ membershipId: VIEWED, membershipType: 3 });
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ queued: true });
        expect(queued()).toEqual([VIEWED]);
    });

    it('queues two with a teammate', async () => {
        const response = await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: MATE, membershipType: 1 } });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([VIEWED, MATE]);
        const row = testDb().prepare('SELECT membership_type FROM session_poll_requests WHERE membership_id = ?').get(MATE);
        expect(row).toEqual({ membership_type: 1 });
    });

    it('queues a teammate who is also the viewed player once', async () => {
        await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: VIEWED, membershipType: 3 } });
        expect(queued()).toEqual([VIEWED]);
    });

    it('rejects a body naming more than one teammate and queues nothing', async () => {
        const mate = { membershipId: MATE, membershipType: 3 };
        const other = { membershipId: '4611686018488900003', membershipType: 3 };
        const asList = await post({ membershipId: VIEWED, membershipType: 3, teammate: [mate, other] });
        expect(asList.status).toBe(400);
        const several = await post({ membershipId: VIEWED, membershipType: 3, teammates: [mate, other] });
        expect(several.status).toBe(400);
        expect(await several.json()).toEqual({ error: 'At most one teammate' });
        expect(queued()).toEqual([]);
    });

    it('treats a teammates list of one as an unknown field, and queues only the viewed player', async () => {
        const response = await post({ membershipId: VIEWED, membershipType: 3, teammates: [{ membershipId: MATE, membershipType: 3 }] });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([VIEWED]);
    });

    it('treats a null teammate as none', async () => {
        const response = await post({ membershipId: VIEWED, membershipType: 3, teammate: null });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([VIEWED]);
    });

    it('accepts ids with stray whitespace, queued trimmed', async () => {
        const response = await post({ membershipId: ` ${VIEWED} `, membershipType: 3, teammate: { membershipId: `${MATE}\n`, membershipType: 3 } });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([VIEWED, MATE]);
    });

    it('ignores fields beyond the ids and stores them nowhere', async () => {
        const response = await post({
            membershipId: VIEWED, membershipType: 3, displayName: 'Anything#0000', profile: { x: 1 },
            teammate: { membershipId: MATE, membershipType: 3, displayName: 'Other#1111' },
        });
        expect(response.status).toBe(202);
        const dump = JSON.stringify(testDb().prepare('SELECT * FROM session_poll_requests').all());
        expect(dump).not.toContain('Anything');
        expect(dump).not.toContain('Other#1111');
        expect(counts()).toEqual({ sessions: 0, players: 0 });
    });

    it('writes no session row and no player row, for a viewed player nobody tracks', async () => {
        await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: MATE, membershipType: 3 } });
        expect(counts()).toEqual({ sessions: 0, players: 0 });
    });

    it('marks a listed session for re-verify instead of queueing it, and still adds no row', async () => {
        seedActiveSession(VIEWED);
        const before = counts();
        const response = await post({ membershipId: VIEWED, membershipType: 3 });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([]);
        expect(counts()).toEqual(before);
        const row = testDb().prepare('SELECT reverify_requested_at FROM active_sessions WHERE membership_id = ?').get(VIEWED) as
            { reverify_requested_at: number | null };
        expect(row.reverify_requested_at).not.toBeNull();
    });
});

describe('what is refused', () => {
    it('400s an id that is not 1 to 20 digits, for the viewed player and the teammate', async () => {
        for (const bad of ['', 'abc', '12a', '1'.repeat(21), '-5', ' ']) {
            expect((await post({ membershipId: bad, membershipType: 3 })).status).toBe(400);
            expect((await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: bad, membershipType: 3 } })).status).toBe(400);
        }
        expect((await post({ membershipId: 4611686018488900001, membershipType: 3 })).status).toBe(400);
        expect((await post({ membershipType: 3 })).status).toBe(400);
        const response = await post({ membershipId: 'abc', membershipType: 3 });
        expect(await response.json()).toEqual({ error: 'Invalid membershipId or membershipType' });
        expect(queued()).toEqual([]);
    });

    it('400s an unknown membership type, for the viewed player and the teammate', async () => {
        for (const bad of [0, 4, 42, 'x', null]) {
            expect((await post({ membershipId: VIEWED, membershipType: bad })).status).toBe(400);
            expect((await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: MATE, membershipType: bad } })).status).toBe(400);
        }
        expect(queued()).toEqual([]);
    });

    it('400s a teammate that is not an object', async () => {
        for (const bad of ['x', 7, true]) {
            const response = await post({ membershipId: VIEWED, membershipType: 3, teammate: bad });
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({ error: 'Invalid teammate' });
        }
        expect(queued()).toEqual([]);
    });

    it('400s a body that is not JSON, or JSON that is not an object', async () => {
        const notJson = await post('{not json');
        expect(notJson.status).toBe(400);
        expect(await notJson.json()).toEqual({ error: 'Invalid JSON body' });
        for (const raw of ['null', '7', '"text"', '[]']) expect((await post(raw)).status).toBe(400);
        expect(queued()).toEqual([]);
    });

    it('403s a foreign origin, no origin, and no page token, queueing nothing', async () => {
        const body = { membershipId: VIEWED, membershipType: 3 };
        const foreign = await post(body, { origin: 'https://evil.example.com' });
        expect(foreign.status).toBe(403);
        expect(await foreign.json()).toEqual({ error: 'Forbidden' });
        expect((await post(body, { origin: null })).status).toBe(403);
        expect((await post(body, { omitToken: true })).status).toBe(403);
        expect(queued()).toEqual([]);
    });

    it('answers 503 during database maintenance', async () => {
        const response = await withDbQuiesced(() => post({ membershipId: VIEWED, membershipType: 3 }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ queued: false, reason: 'maintenance' });
    });
});

describe('a failure that is not maintenance', () => {
    it('answers 500 and queues nothing', async () => {
        const db = testDb();
        db.exec('ALTER TABLE session_poll_requests RENAME TO session_poll_requests_away');
        let response: Response;
        try {
            response = await post({ membershipId: VIEWED, membershipType: 3 });
        } finally {
            db.exec('ALTER TABLE session_poll_requests_away RENAME TO session_poll_requests');
        }
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'Internal server error' });
        expect(queued()).toEqual([]);
    });
});

describe('the limits', () => {
    it('429s the excess over the global limit, whatever mix of addresses it comes from', async () => {
        post = await loadRoute({ ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN: '3' });
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
            const response = await post({ membershipId: `46116860184889100${i}0`, membershipType: 3 }, { ip: `10.1.0.${i}` });
            statuses.push(response.status);
        }
        expect(statuses).toEqual([202, 202, 202, 429, 429]);
        expect(queued()).toHaveLength(3);
        const refused = await post({ membershipId: '4611686018488910099', membershipType: 3 }, { ip: '10.1.0.99' });
        expect(await refused.json()).toEqual({ queued: false, reason: 'rate_limited' });
    });

    it('counts each id as one hit against the global limit', async () => {
        post = await loadRoute({ ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN: '2' });
        await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: MATE, membershipType: 3 } });
        const response = await post({ membershipId: '4611686018488900003', membershipType: 3 });
        expect(response.status).toBe(429);
    });

    it('enqueues nothing for a repeat of the same player inside the cooldown, from any address', async () => {
        await post({ membershipId: VIEWED, membershipType: 3 }, { ip: '10.2.0.1' });
        testDb().prepare('DELETE FROM session_poll_requests').run();
        const response = await post({ membershipId: VIEWED, membershipType: 3 }, { ip: '10.2.0.2' });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ queued: false, reason: 'recently_refreshed' });
        expect(queued()).toEqual([]);
    });

    it('a cooling-down player does not use up the global limit', async () => {
        post = await loadRoute({ ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN: '2' });
        await post({ membershipId: VIEWED, membershipType: 3 });
        for (let i = 0; i < 5; i++) await post({ membershipId: VIEWED, membershipType: 3 });
        const response = await post({ membershipId: MATE, membershipType: 3 });
        expect(response.status).toBe(202);
    });

    it('lets the player in again after the cooldown', async () => {
        await post({ membershipId: VIEWED, membershipType: 3 });
        testDb().prepare('DELETE FROM session_poll_requests').run();
        vi.advanceTimersByTime(301_000);
        const response = await post({ membershipId: VIEWED, membershipType: 3 });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([VIEWED]);
    });

    it('holds the cooldown for a player with no players row, whom the crawler found private', async () => {
        // The crawler consumes the request and, with no players row, writes no backoff. Only the
        // cooldown stops the next view from costing another GetProfile.
        await post({ membershipId: VIEWED, membershipType: 3 });
        testDb().prepare('DELETE FROM session_poll_requests').run();
        const again = await post({ membershipId: VIEWED, membershipType: 3 });
        expect(await again.json()).toEqual({ queued: false, reason: 'recently_refreshed' });
        expect(queued()).toEqual([]);
        expect(counts().players).toBe(0);
    });

    it('429s with the queue full, and does not start a cooldown for the refused player', async () => {
        post = await loadRoute({ ACTIVE_SESSION_POLL_REQUEST_QUEUE_MAX: '1' });
        await post({ membershipId: VIEWED, membershipType: 3 });
        const full = await post({ membershipId: MATE, membershipType: 3 });
        expect(full.status).toBe(429);
        expect(await full.json()).toEqual({ queued: false, reason: 'queue_full' });
        expect(queued()).toEqual([VIEWED]);

        testDb().prepare('DELETE FROM session_poll_requests').run();
        const retry = await post({ membershipId: MATE, membershipType: 3 });
        expect(retry.status).toBe(202);
    });

    it('declines a player in privacy backoff and enqueues nothing', async () => {
        seedPrivacyBackoff(VIEWED);
        expect(requestSessionPoll(VIEWED, 3)).toBe('privacy_backoff');

        const response = await post({ membershipId: VIEWED, membershipType: 3 });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ queued: false, reason: 'privacy_backoff' });
        expect(queued()).toEqual([]);
    });

    it('queues the teammate even when the viewed player is declined', async () => {
        seedPrivacyBackoff(VIEWED);
        const response = await post({ membershipId: VIEWED, membershipType: 3, teammate: { membershipId: MATE, membershipType: 3 } });
        expect(response.status).toBe(202);
        expect(queued()).toEqual([MATE]);
    });
});
