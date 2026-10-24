import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/leaderboard/route';
import { __resetSwrCacheForTests } from '@/lib/cache/swr-cache';
import { resetTestDb } from '../helpers/db';
import { seedRun } from '../helpers/seed';
import { DP_EPIC, DP_NORMAL, NON_RAID_HASH, VOG_MASTER, VOG_NORMAL } from '../helpers/pgcr-builder';

/**
 * `GET /api/leaderboard?difficulty=` (#41), driven through the route handler against the test
 * database. Difficulty comes from the activity hash; `difficulty_tier` records Feats and is read
 * by no filter, so the seeds cross the two.
 *
 * The route is tested here, not only the runners under it, for two things the runners can't
 * show: which `difficulty` values the route accepts, and that a raid with no version at the
 * requested Difficulty has no board at all, while one that has a version but no clears keeps an
 * empty board (decision 6). The SWR cache is per process, so it is emptied before every test.
 */

/** Every raid with a Master version, written out from the manifest labels. */
const RAIDS_WITH_MASTER = [
    'crotas_end',
    'kings_fall',
    'root_of_nightmares',
    'salvations_edge',
    'vault_of_glass',
    'vow_of_the_disciple',
];

type Board = 'fullClears' | 'fastest';

interface Entry {
    membershipId: string;
}

interface Body {
    raidKeys: string[];
    entries?: Entry[];
    leaderboards?: Record<string, { raidKey: string; entries: Entry[] }>;
}

beforeEach(() => {
    resetTestDb();
    __resetSwrCacheForTests();
});

async function respond(query: Record<string, string>): Promise<Response> {
    const response = await GET(new NextRequest(`http://localhost:3100/api/leaderboard?${new URLSearchParams(query)}`));
    expect(response.status).toBe(200);
    return response;
}

async function get(query: Record<string, string>): Promise<Body> {
    return (await respond(query)).json();
}

/** The per-raid request for a board: Full Clears' Per Raid view, or Fastest Clears. */
function perRaid(board: Board, query: Record<string, string> = {}): Record<string, string> {
    return board === 'fastest' ? { board: 'fastest', ...query } : { mode: 'individual', ...query };
}

/** Everyone on any of the body's boards, sorted, whichever shape it has. */
function playersOn(body: Body): string[] {
    const entries = body.entries ?? Object.values(body.leaderboards ?? {}).flatMap((lb) => lb.entries);
    return [...new Set(entries.map((e) => e.membershipId))].sort();
}

function seedOneRunPerDifficulty(): void {
    seedRun({ instanceId: '1', completedBy: ['master'], activityHash: VOG_MASTER, difficultyTier: 0 });
    seedRun({ instanceId: '2', completedBy: ['feats'], activityHash: DP_NORMAL, difficultyTier: 2 });
    seedRun({ instanceId: '3', completedBy: ['epic'], activityHash: DP_EPIC });
}

describe('GET /api/leaderboard?difficulty=', () => {
    describe.each<[Board, Record<string, string>]>([
        ['fullClears', { mode: 'aggregate' }],
        ['fastest', { board: 'fastest' }],
    ])('on the %s board', (_board, boardQuery) => {
        it.each([
            ['master', ['master']],
            ['normal', ['feats']],
            ['epic', ['epic']],
        ])('difficulty=%s counts only runs whose activity hash has that Difficulty', async (difficulty, players) => {
            seedOneRunPerDifficulty();

            expect(playersOn(await get({ ...boardQuery, difficulty }))).toEqual(players);
        });

        it('an unknown difficulty is ignored, so every run counts', async () => {
            seedOneRunPerDifficulty();

            expect(playersOn(await get({ ...boardQuery, difficulty: 'hard' }))).toEqual(['epic', 'feats', 'master']);
        });
    });

    it('difficulty=normal on Total Clears counts a run on a hash in no raid definition', async () => {
        seedRun({ instanceId: '1', completedBy: ['unknown'], activityHash: NON_RAID_HASH });
        seedRun({ instanceId: '2', completedBy: ['master'], activityHash: VOG_MASTER });

        expect(playersOn(await get({ mode: 'aggregate', difficulty: 'normal' }))).toEqual(['unknown']);
    });

    it('with no filter, a raid\'s Normal and Master runs share its one board', async () => {
        seedRun({ instanceId: '1', completedBy: ['normal'], activityHash: VOG_NORMAL });
        seedRun({ instanceId: '2', completedBy: ['master'], activityHash: VOG_MASTER });

        const body = await get(perRaid('fullClears'));

        expect(body.leaderboards!.vault_of_glass.entries.map((e) => e.membershipId).sort()).toEqual(['master', 'normal']);
    });
});

describe.each<Board>(['fullClears', 'fastest'])('which boards the %s response holds', (board) => {
    it('Master leaves out every raid with no Master version, and keeps an empty board for one with no clears', async () => {
        seedRun({ instanceId: '1', completedBy: ['master'], activityHash: VOG_MASTER });

        const body = await get(perRaid(board, { difficulty: 'master' }));

        expect(Object.keys(body.leaderboards!).sort()).toEqual(RAIDS_WITH_MASTER);
        expect(body.raidKeys.sort()).toEqual(RAIDS_WITH_MASTER);
        expect(body.leaderboards!.vault_of_glass.entries.map((e) => e.membershipId)).toEqual(['master']);
        expect(body.leaderboards!.root_of_nightmares.entries).toEqual([]);
    });

    it('Epic leaves The Desert Perpetual as the only board', async () => {
        const body = await get(perRaid(board, { difficulty: 'epic' }));

        expect(Object.keys(body.leaderboards!)).toEqual(['the_desert_perpetual']);
        expect(body.raidKeys).toEqual(['the_desert_perpetual']);
    });

    it('a selected raid with no version at the Difficulty has no board, and nothing is cached for it', async () => {
        const response = await respond(perRaid(board, { difficulty: 'master', raids: 'deep_stone_crypt' }));
        const body: Body = await response.json();

        expect(body.leaderboards).toEqual({});
        expect(body.raidKeys).toEqual([]);
        expect(response.headers.get('X-Cache')).toBe('BYPASS');
    });

    it('a selection keeps only its raids with a version at the Difficulty', async () => {
        const body = await get(perRaid(board, { difficulty: 'master', raids: 'deep_stone_crypt,vault_of_glass,last_wish' }));

        expect(Object.keys(body.leaderboards!)).toEqual(['vault_of_glass']);
        expect(body.raidKeys).toEqual(['vault_of_glass']);
    });

    it('with no Difficulty, every raid keeps its board', async () => {
        const unfiltered = await get(perRaid(board));
        const normal = await get(perRaid(board, { difficulty: 'normal' }));

        // Every raid has a Normal version, so Normal hides nothing either.
        expect(Object.keys(unfiltered.leaderboards!)).toHaveLength(13);
        expect(Object.keys(normal.leaderboards!).sort()).toEqual(Object.keys(unfiltered.leaderboards!).sort());
    });
});

describe('Total Clears under a Difficulty', () => {
    it('a selection of raids with no version at the Difficulty is an empty board', async () => {
        seedRun({ instanceId: '1', completedBy: ['normal'], activityHash: VOG_NORMAL });

        const body = await get({ mode: 'aggregate', difficulty: 'epic', raids: 'vault_of_glass' });

        expect(body.entries).toEqual([]);
        expect(body.raidKeys).toEqual([]);
    });

    it('echoes only the raids with a version at the Difficulty', async () => {
        const body = await get({ mode: 'aggregate', difficulty: 'epic' });

        expect(body.raidKeys).toEqual(['the_desert_perpetual']);
    });
});
