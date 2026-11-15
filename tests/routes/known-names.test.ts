import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/players/names/route';
import { upsertPlayer } from '@/lib/db/queries';
import { resetTestDb, testDb } from '../helpers/db';
import { withDbQuiesced } from '../helpers/db-quiesce';
import { seedPlayer } from '../helpers/seed';

/**
 * `GET /api/players/names?ids=` (#9001): the read-only lookup the profile page uses to name
 * the Roster members the Tracker already knows. Ids in, known identities out, nothing written.
 * Members it doesn't know are left out; the browser names those itself, on screen only.
 */

const KNOWN_ID = '4611686018488910001';
const OTHER_KNOWN_ID = '4611686018488910002';
const UNKNOWN_ID = '4611686018488910003';

function lookup(query: string) {
    return GET(new NextRequest(`http://localhost:3100/api/players/names${query}`));
}

function playerCount(): number {
    return (testDb().prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
}

function ids(count: number): string {
    return Array.from({ length: count }, (_, i) => String(4611686018488920000 + i)).join(',');
}

beforeEach(() => {
    resetTestDb();
});

describe('GET /api/players/names', () => {
    it('returns Name#Code and membership type for known ids, in the order asked, and leaves unknown ids out', async () => {
        seedPlayer(KNOWN_ID, 'KnownGuardian', 7);
        upsertPlayer({ membershipId: OTHER_KNOWN_ID, membershipType: 2, displayName: 'Other', bungieGlobalDisplayName: 'OtherOne', bungieGlobalDisplayNameCode: 1234 });

        const response = await lookup(`?ids=${OTHER_KNOWN_ID},${UNKNOWN_ID},${KNOWN_ID}`);

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            players: [
                { membershipId: OTHER_KNOWN_ID, membershipType: 2, displayName: 'OtherOne#1234' },
                { membershipId: KNOWN_ID, membershipType: 3, displayName: 'KnownGuardian#0007' },
            ],
        });
    });

    it('falls back to the best stored name when there is no full Name#Code', async () => {
        upsertPlayer({ membershipId: KNOWN_ID, membershipType: 3, displayName: 'PlatformOnly' });
        upsertPlayer({ membershipId: OTHER_KNOWN_ID, membershipType: 3, displayName: 'Ignored', bungieGlobalDisplayName: 'NoCode' });

        const response = await lookup(`?ids=${KNOWN_ID},${OTHER_KNOWN_ID}`);

        expect((await response.json()).players).toEqual([
            { membershipId: KNOWN_ID, membershipType: 3, displayName: 'PlatformOnly' },
            { membershipId: OTHER_KNOWN_ID, membershipType: 3, displayName: 'NoCode' },
        ]);
    });

    it('answers a repeated id once', async () => {
        seedPlayer(KNOWN_ID, 'KnownGuardian', 7);

        const response = await lookup(`?ids=${KNOWN_ID},${KNOWN_ID}`);

        expect((await response.json()).players).toHaveLength(1);
    });

    it('accepts twelve ids', async () => {
        const response = await lookup(`?ids=${ids(12)}`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ players: [] });
    });

    it('refuses more than twelve ids', async () => {
        const response = await lookup(`?ids=${ids(13)}`);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Too many ids' });
    });

    it.each([
        ['a non-digit id', `?ids=${KNOWN_ID},abc`],
        ['a LIKE wildcard', `?ids=${KNOWN_ID},1%25`],
        ['a 21-digit id', '?ids=123456789012345678901'],
        ['an empty entry', `?ids=${KNOWN_ID},,${OTHER_KNOWN_ID}`],
        ['an empty list', '?ids='],
        ['no ids parameter', ''],
    ])('refuses %s', async (_label, query) => {
        const response = await lookup(query);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid ids' });
    });

    it('accepts a one-digit and a twenty-digit id', async () => {
        const response = await lookup('?ids=1,12345678901234567890');

        expect(response.status).toBe(200);
    });

    it('writes nothing', async () => {
        seedPlayer(KNOWN_ID, 'KnownGuardian', 7);

        await lookup(`?ids=${KNOWN_ID},${UNKNOWN_ID}`);

        expect(playerCount()).toBe(1);
        expect(testDb().prepare('SELECT 1 FROM players WHERE membership_id = ?').get(UNKNOWN_ID)).toBeUndefined();
    });

    it('answers no names during database maintenance', async () => {
        seedPlayer(KNOWN_ID, 'KnownGuardian', 7);

        const response = await withDbQuiesced(() => lookup(`?ids=${KNOWN_ID}`));

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({ maintenance: true, players: [] });
    });

    // A real fault, made with the real database rather than a mock (ADR 0004): the lookup
    // must not pass it off as maintenance or as "nobody known".
    it('lets any other database failure through as an error', async () => {
        const db = testDb();
        db.exec('ALTER TABLE players RENAME TO players_unavailable');
        try {
            await expect(lookup(`?ids=${KNOWN_ID}`)).rejects.toThrow(/no such table/);
        } finally {
            db.exec('ALTER TABLE players_unavailable RENAME TO players');
        }
    });
});
