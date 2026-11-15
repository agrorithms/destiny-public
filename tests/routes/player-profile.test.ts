import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/players/[membershipType]/[membershipId]/route';
import { upsertActiveSession } from '@/lib/db/queries';
import { resetTestDb } from '../helpers/db';
import { seedPlayer } from '../helpers/seed';
import { RAID_HASH } from '../helpers/bungie-profile-builder';

/**
 * `GET /api/players/{type}/{id}`: the player read route accepts a membership id of 1 to 20
 * digits and nothing else (#9001). The profile page's private-player path reads the stored
 * session *containing* a player through it, a search through each stored Roster, so the id
 * it searches for has to be an id.
 */

const HOST_ID = '4611686018488940001';
const MEMBER_ID = '4611686018488940002';

function read(membershipId: string, query = '') {
    return GET(
        new NextRequest(`http://localhost:3100/api/players/3/${encodeURIComponent(membershipId)}${query}`),
        { params: Promise.resolve({ membershipType: '3', membershipId }) },
    );
}

beforeEach(() => {
    resetTestDb();
});

const READS = [
    ['the profile read', ''],
    ['the active-session read', '?part=active'],
    ['the containing-session read', '?part=active&containing=1'],
] as const;

const BAD_IDS = [
    ['letters', 'abc'],
    ['a LIKE wildcard', '%'],
    ['a LIKE single-character wildcard', '1_2'],
    ['a quote', "1'"],
    ['21 digits', '123456789012345678901'],
    ['digits with a space', '4611686018488940001 '],
    ['an empty id', ''],
] as const;

describe('GET /api/players/{type}/{id} membership id', () => {
    for (const [readName, query] of READS) {
        it.each(BAD_IDS)(`refuses %s on ${readName}`, async (_label, id) => {
            const response = await read(id, query);

            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({ error: 'Invalid player identity' });
        });

        it(`accepts a 1-digit and a 20-digit id on ${readName}`, async () => {
            expect((await read('1', query)).status).toBe(200);
            expect((await read('12345678901234567890', query)).status).toBe(200);
        });
    }

    it('still finds the stored session containing a Roster member', async () => {
        seedPlayer(HOST_ID, 'Host', 1);
        upsertActiveSession({
            membershipId: HOST_ID,
            membershipType: 3,
            displayName: 'Host',
            activityHash: RAID_HASH,
            activityModeType: 4,
            raidKey: 'salvations_edge',
            startedAt: new Date().toISOString(),
            partyMembersJson: JSON.stringify([
                { membershipId: HOST_ID, displayName: 'Host', status: 1 },
                { membershipId: MEMBER_ID, displayName: MEMBER_ID, status: 1 },
            ]),
            playerCount: 2,
        });

        const response = await read(MEMBER_ID, '?part=active&containing=1');

        expect(response.status).toBe(200);
        expect((await response.json()).activeSession).toMatchObject({ membershipId: HOST_ID, activityHash: RAID_HASH });
    });
});
