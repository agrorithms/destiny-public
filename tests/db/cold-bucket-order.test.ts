import { beforeEach, describe, expect, it } from 'vitest';
import { resetTestDb, testDb } from '../helpers/db';
import { getPlayersInColdBucket } from '../../src/lib/db/queries';

/**
 * The cold pick must return the same players in the same order whether or not it sorts by the
 * never-written `priority` column. Every row has priority 0, so ordering by `last_attempt_at`
 * alone is the same ordering. Timestamps are distinct on purpose: ties are unspecified, before
 * and after.
 */
const CUTOFF = 1_000_000;

interface Row {
    id: string;
    lastSeen: number | null;
    attempt: number;
    active?: number;
    nextEligible?: number | null;
}

function seed(rows: Row[]): void {
    const insert = testDb().prepare(`
        INSERT INTO players (membership_id, membership_type, display_name, is_active, priority,
                             last_seen_at, last_attempt_at, next_eligible_at)
        VALUES (?, 3, ?, ?, 0, ?, ?, ?)`);
    for (const r of rows) {
        insert.run(r.id, `n-${r.id}`, r.active ?? 1, r.lastSeen, r.attempt, r.nextEligible ?? null);
    }
}

// The SQL as it was before the change, `priority DESC` included.
function oldColdPick(limit: number, excludeIds: string[]): string[] {
    return (testDb().prepare(`
        SELECT p.membership_id AS id FROM players p
        WHERE p.is_active = 1
          AND (p.last_seen_at IS NULL OR p.last_seen_at < ?)
          AND (p.next_eligible_at IS NULL OR p.next_eligible_at <= unixepoch())
          AND p.membership_id NOT IN (SELECT value FROM json_each(?))
        ORDER BY p.priority DESC, p.last_attempt_at ASC
        LIMIT ?`).all(CUTOFF, JSON.stringify(excludeIds), limit) as { id: string }[]).map((r) => r.id);
}

describe('getPlayersInColdBucket order', () => {
    beforeEach(() => {
        resetTestDb();
        seed([
            { id: 'c-late', lastSeen: 10, attempt: 500 },
            { id: 'a-never', lastSeen: null, attempt: 100 },
            { id: 'b-old', lastSeen: CUTOFF - 1, attempt: 300 },
            { id: 'd-never-newest', lastSeen: null, attempt: 900 },
            { id: 'e-zero', lastSeen: 5, attempt: 0 },
            { id: 'x-warm', lastSeen: CUTOFF, attempt: 1 },
            { id: 'x-inactive', lastSeen: null, attempt: 2, active: 0 },
            { id: 'x-backoff', lastSeen: null, attempt: 3, nextEligible: 4_000_000_000 },
            { id: 'x-excluded', lastSeen: null, attempt: 4 },
        ]);
    });

    it('returns cold players oldest attempt first, skipping warm, inactive, backed-off and excluded ones', () => {
        const ids = getPlayersInColdBucket(CUTOFF, 10, ['x-excluded']).map((p) => p.membershipId);
        expect(ids).toEqual(['e-zero', 'a-never', 'b-old', 'c-late', 'd-never-newest']);
    });

    it('matches the pre-change query (priority DESC, last_attempt_at ASC)', () => {
        const now = getPlayersInColdBucket(CUTOFF, 10, ['x-excluded']).map((p) => p.membershipId);
        expect(now).toEqual(oldColdPick(10, ['x-excluded']));
    });

    it('stops at the limit, taking the stalest first', () => {
        expect(getPlayersInColdBucket(CUTOFF, 2, []).map((p) => p.membershipId)).toEqual(['e-zero', 'x-excluded']);
    });

    it('returns nothing for a limit of zero', () => {
        expect(getPlayersInColdBucket(CUTOFF, 0, [])).toEqual([]);
    });
});
