import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/active-sessions/route';
import { requestSessionPoll, upsertActiveSession } from '@/lib/db/queries';
import { resetTestDb, testDb } from '../helpers/db';
import { seedPlayer } from '../helpers/seed';

/**
 * A poll request on a listed player marks their row due for re-verify (#9002). The mark is the
 * crawler's business only: the public list must not move because someone asked. The row's
 * checked_at drives the freshness window and the list's order (ADR 0001), and the response
 * carries it, so an identical response proves the mark left it alone.
 */

const LEADER_ID = '4611686018488950001';
const TEAMMATE_ID = '4611686018488950002';

function list() {
    return GET(new NextRequest('http://localhost:3100/api/active-sessions'));
}

beforeEach(() => {
    resetTestDb();
});

describe('GET /api/active-sessions with a row marked for re-verify', () => {
    it('answers the same before and after the mark', async () => {
        seedPlayer(LEADER_ID, 'Leader', 1111);
        upsertActiveSession({
            membershipId: LEADER_ID,
            membershipType: 3,
            displayName: 'Leader',
            activityHash: 1541433876,
            activityModeType: 4,
            raidKey: 'salvations_edge',
            startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
            partyMembersJson: JSON.stringify([
                { membershipId: LEADER_ID, emblemHash: 0, status: 9 },
                { membershipId: TEAMMATE_ID, emblemHash: 0, status: 1 },
            ]),
            playerCount: 2,
        });
        // Older than "now", so a mark that stamped checked_at would change the body.
        testDb().prepare('UPDATE active_sessions SET checked_at = unixepoch() - 120').run();

        const before = await (await list()).json();
        expect(before.sessions).toHaveLength(1);

        expect(requestSessionPoll(LEADER_ID, 3)).toBe('accepted');

        const after = await (await list()).json();
        expect(after).toEqual(before);
    });
});
