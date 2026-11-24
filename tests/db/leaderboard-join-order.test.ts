import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type Database from 'better-sqlite3';
import { runLeaderboardRows } from '@/lib/cache/leaderboard-cache';
import { resetTestDb, testDb } from '../helpers/db';

/**
 * The all-raids leaderboard must read `pgcrs` before `pgcr_players`. A join order changes no
 * result, so no leaderboard test can see it: the plan is the spec. With accurate statistics
 * (after `ANALYZE`) the planner would rather walk `pgcr_players` in member order, which made
 * the 720h board 64–78% slower on a copy of prod. `runLeaderboardRows` pins the order with
 * `CROSS JOIN`. See docs/decisions.md, 2026-11-24 ("The cleanup keeps `ANALYZE`…").
 *
 * Unlike the index tests (raids-in-progress-index, cold-bucket-index), this one EXPLAINs the
 * statement `runLeaderboardRows` really prepares rather than a copy of its SQL, so reverting
 * `CROSS JOIN` to `JOIN` turns it red. A database with no statistics, like this one, already
 * plans the unpinned statement `SCAN pp` first.
 */

/** The first plan row that reads table alias `alias`, by its position in the plan. */
function readPosition(details: string[], alias: string): number {
    return details.findIndex((detail) => new RegExp(`^(SCAN|SEARCH) ${alias}( |$)`).test(detail));
}

let prepareSpy: MockInstance<Database.Database['prepare']>;

beforeEach(() => {
    resetTestDb();
    // Open the connection before spying: the first getDb() runs the schema setup, which
    // prepares statements of its own that would otherwise be recorded too.
    const db = testDb();
    // Record-only: no mockImplementation, so every call passes through to the real prepare and
    // the real SQL still runs against the real database. ADR 0004's reason for not mocking our
    // own modules (a mock erases the SQL under test) doesn't apply to a spy that replaces nothing.
    prepareSpy = vi.spyOn(db, 'prepare');
});

afterEach(() => {
    // The connection is shared by the whole file; a leftover spy would record every statement after.
    prepareSpy.mockRestore();
});

describe('the all-raids leaderboard join order', () => {
    it('reads pgcrs before pgcr_players at 720h', () => {
        runLeaderboardRows(720, [], 100);

        expect(prepareSpy).toHaveBeenCalledTimes(1);
        const sql = prepareSpy.mock.calls[0][0];

        // The two parameters of the all-raids, unfiltered statement: cutoff and limit. A new
        // parameter makes this throw a parameter-count error rather than pass silently.
        const details = (testDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(0, 100) as { detail: string }[])
            .map((row) => row.detail);

        const pgcrs = readPosition(details, 'p');
        const pgcrPlayers = readPosition(details, 'pp');
        expect(pgcrs, details.join('\n')).toBeGreaterThanOrEqual(0);
        expect(pgcrPlayers, details.join('\n')).toBeGreaterThan(pgcrs);
    });
});
