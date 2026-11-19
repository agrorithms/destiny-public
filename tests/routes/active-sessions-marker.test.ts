import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/active-sessions/route';
import { requestSessionPoll } from '@/lib/db/queries';
import { resetTestDb } from '../helpers/db';
import { seedActiveSession, seedPlayer } from '../helpers/seed';

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
        // Older than "now", so a mark that stamped checked_at would change the body.
        seedActiveSession(LEADER_ID, { roster: [LEADER_ID, TEAMMATE_ID], ageSeconds: 120 });

        const before = await (await list()).json();
        expect(before.sessions).toHaveLength(1);

        expect(requestSessionPoll(LEADER_ID, 3)).toBe('accepted');

        const after = await (await list()).json();
        expect(after).toEqual(before);
    });
});
