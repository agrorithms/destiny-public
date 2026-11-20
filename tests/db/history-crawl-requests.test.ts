import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueCrawl, requestHistoryCrawl } from '@/lib/db/queries';
import { resetTestDb, testDb } from '../helpers/db';
import { seedCrawlBackoff, seedPlayer } from '../helpers/seed';

/**
 * History-crawl requests (#9004): a profile view asks the crawler to crawl a player's raid
 * history. The queue the browser can fill is capped, counted over the rows a profile view put
 * there; the crawler's own enqueues (a session ending) are never capped.
 */

const ID = '4611686018488950001';
// The default of HISTORY_CRAWL_REQUEST_QUEUE_MAX.
const QUEUE_MAX = 200;

const id = (i: number) => `46116860184889${String(i).padStart(5, '0')}`;
const rows = () => testDb().prepare('SELECT membership_id, source, priority FROM crawl_queue').all();

beforeEach(() => resetTestDb());

describe('requestHistoryCrawl', () => {
    it('queues the player as a profile-view row of normal priority', () => {
        expect(requestHistoryCrawl(ID, 3)).toBe('accepted');
        expect(rows()).toEqual([{ membership_id: ID, source: 'profile-view', priority: 0 }]);
    });

    it('declines a player in crawl backoff and queues nothing', () => {
        seedCrawlBackoff(ID);
        expect(requestHistoryCrawl(ID, 3)).toBe('backing_off');
        expect(rows()).toEqual([]);
    });

    it('queues a player whose backoff has run out', () => {
        seedPlayer(ID, 'Backoff#0001', 1);
        testDb().prepare('UPDATE players SET next_eligible_at = unixepoch() - 5 WHERE membership_id = ?').run(ID);
        expect(requestHistoryCrawl(ID, 3)).toBe('accepted');
    });

    it('refuses at the cap, counting profile-view rows only', () => {
        for (let i = 0; i < QUEUE_MAX; i++) expect(requestHistoryCrawl(id(i), 3)).toBe('accepted');
        expect(requestHistoryCrawl(ID, 3)).toBe('queue_full');
        expect(rows()).toHaveLength(QUEUE_MAX);
    });

    it('reads the cap from HISTORY_CRAWL_REQUEST_QUEUE_MAX', () => {
        process.env.HISTORY_CRAWL_REQUEST_QUEUE_MAX = '2';
        try {
            expect(requestHistoryCrawl(id(1), 3)).toBe('accepted');
            expect(requestHistoryCrawl(id(2), 3)).toBe('accepted');
            expect(requestHistoryCrawl(id(3), 3)).toBe('queue_full');
        } finally {
            delete process.env.HISTORY_CRAWL_REQUEST_QUEUE_MAX;
        }
    });

    it('still accepts a profile view when session_end rows beyond the cap are queued', () => {
        enqueueCrawl(Array.from({ length: QUEUE_MAX + 50 }, (_, i) => ({ membershipId: id(i), membershipType: 3 })), 'session_end', 100);
        expect(requestHistoryCrawl(ID, 3)).toBe('accepted');
    });

    it('answers accepted for a player already queued, even at the cap, and leaves the row as it was', () => {
        for (let i = 0; i < QUEUE_MAX; i++) requestHistoryCrawl(id(i), 3);
        testDb().prepare('UPDATE crawl_queue SET enqueued_at = 5').run();
        expect(requestHistoryCrawl(id(0), 3)).toBe('accepted');
        const row = testDb().prepare('SELECT enqueued_at FROM crawl_queue WHERE membership_id = ?').get(id(0));
        expect(row).toEqual({ enqueued_at: 5 });
    });

    it('does not downgrade a session_end row for the same player', () => {
        enqueueCrawl([{ membershipId: ID, membershipType: 3 }], 'session_end', 100);
        expect(requestHistoryCrawl(ID, 3)).toBe('accepted');
        expect(rows()).toEqual([{ membership_id: ID, source: 'session_end', priority: 100 }]);
    });
});

describe('the crawler enqueues past the cap', () => {
    it('adds session_end rows while the profile-view queue is full', () => {
        for (let i = 0; i < QUEUE_MAX; i++) requestHistoryCrawl(id(i), 3);
        enqueueCrawl([{ membershipId: ID, membershipType: 3 }], 'session_end', 100);
        expect(rows()).toHaveLength(QUEUE_MAX + 1);
    });
});
