import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers/db';
import { initializeSchema } from '../../src/lib/db/schema';

/**
 * The index the crawler's cold pick walks. An index changes no result, so no test of
 * `getPlayersInColdBucket` can tell whether it is there: without it the pick scans and sorts
 * every player each cycle, on the event loop the active-session poll shares (ADR 0005). Its
 * existence, the retirement of `idx_players_priority`, and the plan are the spec.
 */
function indexColumns(name: string): string[] {
    return testDb()
        .prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
        .all(name)
        .map((row) => (row as { name: string }).name);
}

describe('the cold pick index', () => {
    it('is created on players as (last_attempt_at)', () => {
        expect(indexColumns('idx_players_last_attempt')).toEqual(['last_attempt_at']);
    });

    it('leaves a fresh Tracker without idx_players_priority', () => {
        expect(indexColumns('idx_players_priority')).toEqual([]);
    });

    it('drops idx_players_priority and builds the new index when a Tracker that has the old one is opened', () => {
        const db = testDb();
        db.exec('DROP INDEX IF EXISTS idx_players_last_attempt');
        db.exec('CREATE INDEX idx_players_priority ON players(priority DESC, last_crawled_at ASC)');

        initializeSchema(db);

        expect(indexColumns('idx_players_priority')).toEqual([]);
        expect(indexColumns('idx_players_last_attempt')).toEqual(['last_attempt_at']);
    });

    it('serves the cold pick in index order, with no temp B-tree for ORDER BY', () => {
        const db = testDb();
        // Mirrors getPlayersInColdBucket's SQL in src/lib/db/queries.ts.
        const plan = db.prepare(`
            EXPLAIN QUERY PLAN
            SELECT p.membership_id AS membershipId,
                   p.membership_type AS membershipType,
                   p.display_name AS displayName,
                   p.bungie_global_display_name AS bungieGlobalDisplayName,
                   p.last_crawled_at AS lastCrawledAt
            FROM players p
            WHERE p.is_active = 1
              AND (p.last_seen_at IS NULL OR p.last_seen_at < ?)
              AND (p.next_eligible_at IS NULL OR p.next_eligible_at <= unixepoch())
              AND p.membership_id NOT IN (SELECT value FROM json_each(?))
            ORDER BY p.last_attempt_at ASC
            LIMIT ?
        `).all(1_000_000, '[]', 10) as { detail: string }[];
        const details = plan.map((r) => r.detail).join('\n');

        expect(details).toContain('idx_players_last_attempt');
        // Matches the partial sort too: the old plan said 'USE TEMP B-TREE FOR LAST TERM OF ORDER BY'.
        expect(details).not.toContain('TEMP B-TREE');
    });
});
