import { beforeEach, describe, expect, it } from 'vitest';
import {
    claimSessionPollRequests,
    deleteSessionPollRequests,
    recordSessionCheck,
    requestSessionPoll,
} from '@/lib/db/queries';
import { resetTestDb, testDb } from '../helpers/db';
import { nowSec, seedActiveSession, seedPlayer } from '../helpers/seed';

/**
 * Poll requests (#9002): a player id the crawler should look at on its next active-session
 * cycle. A request for a player with no session row waits in a capped queue; a request for a
 * player who has a row marks that row due for re-verify instead, so it costs no queue space.
 * Nothing sends requests yet (#9003 adds the route), so this file drives the query functions.
 */

const PLAYER_ID = '4611686018488930001';
const OTHER_ID = '4611686018488930002';
// The default of ACTIVE_SESSION_POLL_REQUEST_QUEUE_MAX.
const QUEUE_MAX = 200;

function checkedAt(membershipId: string): number {
    return (testDb()
        .prepare('SELECT checked_at FROM active_sessions WHERE membership_id = ?')
        .get(membershipId) as { checked_at: number }).checked_at;
}

function pendingIds(): string[] {
    return claimSessionPollRequests(QUEUE_MAX + 10).map((r) => r.membershipId);
}

function fillQueue(count: number): void {
    for (let i = 0; i < count; i++) {
        expect(requestSessionPoll(`46116860184889${String(i).padStart(5, '0')}`, 3)).toBe('accepted');
    }
}

beforeEach(() => {
    resetTestDb();
});

describe('requestSessionPoll', () => {
    it('queues a player with no session row, with the membership type it was given', () => {
        expect(requestSessionPoll(PLAYER_ID, 2)).toBe('accepted');

        expect(claimSessionPollRequests(10)).toEqual([{ membershipId: PLAYER_ID, membershipType: 2 }]);
    });

    it('leaves one pending request when the same player is requested twice', () => {
        requestSessionPoll(PLAYER_ID, 3);
        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');

        expect(pendingIds()).toEqual([PLAYER_ID]);
    });

    it('refuses a request once the queue holds its cap, and the caller can tell', () => {
        fillQueue(QUEUE_MAX);

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('queue_full');
        expect(pendingIds()).toHaveLength(QUEUE_MAX);
        expect(pendingIds()).not.toContain(PLAYER_ID);
    });

    it('accepts a request one short of the cap', () => {
        fillQueue(QUEUE_MAX - 1);

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
        expect(pendingIds()).toHaveLength(QUEUE_MAX);
    });

    it('still accepts a repeat of a pending request when the queue is full', () => {
        fillQueue(QUEUE_MAX - 1);
        requestSessionPoll(PLAYER_ID, 3);

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
    });

    it('marks a player who has a session row instead of queueing them, even with the queue full', () => {
        fillQueue(QUEUE_MAX);
        seedActiveSession(PLAYER_ID);

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
        expect(pendingIds()).not.toContain(PLAYER_ID);
    });

    it('leaves the marked row\'s last-checked time alone', () => {
        // Aged, so a mark that rewrote checked_at to "now" would show.
        seedActiveSession(PLAYER_ID, { ageSeconds: 120 });
        const before = checkedAt(PLAYER_ID);

        requestSessionPoll(PLAYER_ID, 3);
        requestSessionPoll(PLAYER_ID, 3);

        expect(checkedAt(PLAYER_ID)).toBe(before);
    });

    it('declines a player in session privacy backoff and queues nothing', () => {
        seedPlayer(PLAYER_ID, 'Hidden', 1);
        recordSessionCheck(PLAYER_ID, 'privacy');

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('privacy_backoff');
        expect(pendingIds()).toEqual([]);
    });

    it('declines a player in privacy backoff who has a session row', () => {
        seedPlayer(PLAYER_ID, 'Hidden', 1);
        recordSessionCheck(PLAYER_ID, 'privacy');
        seedActiveSession(PLAYER_ID);

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('privacy_backoff');
    });

    it('accepts a player in offline backoff: a request bypasses it', () => {
        seedPlayer(PLAYER_ID, 'Away', 1);
        recordSessionCheck(PLAYER_ID, 'offline');

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
        expect(pendingIds()).toEqual([PLAYER_ID]);
    });

    it('accepts a once-private player whose later check found them offline', () => {
        seedPlayer(PLAYER_ID, 'Away', 1);
        recordSessionCheck(PLAYER_ID, 'privacy');
        recordSessionCheck(PLAYER_ID, 'offline');

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
    });

    it('accepts a once-private player whose later check found them online', () => {
        seedPlayer(PLAYER_ID, 'Back', 1);
        recordSessionCheck(PLAYER_ID, 'privacy');
        recordSessionCheck(PLAYER_ID, 'online');

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
    });

    it('accepts a private player whose privacy backoff has run out', () => {
        seedPlayer(PLAYER_ID, 'Hidden', 1);
        recordSessionCheck(PLAYER_ID, 'privacy');
        testDb().prepare('UPDATE players SET next_session_eligible_at = ? WHERE membership_id = ?').run(nowSec() - 1, PLAYER_ID);

        expect(requestSessionPoll(PLAYER_ID, 3)).toBe('accepted');
    });
});

describe('claimSessionPollRequests', () => {
    it('returns the oldest requests first, up to the limit, and leaves them pending until deleted', () => {
        requestSessionPoll(PLAYER_ID, 3);
        requestSessionPoll(OTHER_ID, 3);
        requestSessionPoll('4611686018488930003', 3);
        // Same-second requests keep their arrival order; make the age explicit anyway.
        testDb().prepare('UPDATE session_poll_requests SET requested_at = ? WHERE membership_id = ?').run(nowSec() - 60, OTHER_ID);

        expect(claimSessionPollRequests(2).map((r) => r.membershipId)).toEqual([OTHER_ID, PLAYER_ID]);
        expect(claimSessionPollRequests(2).map((r) => r.membershipId)).toEqual([OTHER_ID, PLAYER_ID]);

        deleteSessionPollRequests([OTHER_ID, PLAYER_ID]);
        expect(pendingIds()).toEqual(['4611686018488930003']);
    });

    it('keeps arrival order among requests made in the same second', () => {
        const ids = ['4611686018488930009', '4611686018488930005', '4611686018488930007'];
        for (const id of ids) requestSessionPoll(id, 3);
        testDb().prepare('UPDATE session_poll_requests SET requested_at = ?').run(nowSec());

        expect(pendingIds()).toEqual(ids);
    });

    it('drops a request whose player has since gone into privacy backoff', () => {
        seedPlayer(PLAYER_ID, 'Hidden', 1);
        requestSessionPoll(PLAYER_ID, 3);
        requestSessionPoll(OTHER_ID, 3);
        recordSessionCheck(PLAYER_ID, 'privacy');

        expect(claimSessionPollRequests(10).map((r) => r.membershipId)).toEqual([OTHER_ID]);
        expect(pendingIds()).toEqual([OTHER_ID]);
    });

    it('turns a request whose player has since gained a session row into a mark', () => {
        requestSessionPoll(PLAYER_ID, 3);
        seedActiveSession(PLAYER_ID, { ageSeconds: 120 });
        const before = checkedAt(PLAYER_ID);

        expect(claimSessionPollRequests(10)).toEqual([]);
        expect(checkedAt(PLAYER_ID)).toBe(before);
    });

    it('returns nothing for a limit of zero', () => {
        requestSessionPoll(PLAYER_ID, 3);

        expect(claimSessionPollRequests(0)).toEqual([]);
    });
});
