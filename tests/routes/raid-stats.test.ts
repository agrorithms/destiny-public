import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/raid-stats/route';
import { __resetSwrCacheForTests } from '@/lib/cache/swr-cache';
import { resetTestDb } from '../helpers/db';
import { seedRun } from '../helpers/seed';

/**
 * `GET /api/analytics/raid-stats?difficulty=` (#41). The query takes the leaderboard's shared
 * filter clause, which tests/db/raid-stats.test.ts covers; this file covers what the route adds:
 * which `difficulty` values it accepts. Difficulty comes from the activity hash, so the seeds
 * cross it with `difficulty_tier` (Feats).
 */

const VOG_MASTER = 1681562271; // "Vault of Glass: Master"
const DP_NORMAL = 1044919065; // "The Desert Perpetual: Standard"
const DP_EPIC = 3817322389; // "The Desert Perpetual (Epic): Standard"

interface Body {
    raids: { raidKey: string; instanceCount: number }[];
}

beforeEach(() => {
    resetTestDb();
    __resetSwrCacheForTests();
});

async function instancesPerRaid(query: Record<string, string>): Promise<[string, number][]> {
    const response = await GET(new NextRequest(`http://localhost:3100/api/analytics/raid-stats?${new URLSearchParams(query)}`));
    expect(response.status).toBe(200);
    const body: Body = await response.json();
    return body.raids.map((r): [string, number] => [r.raidKey, r.instanceCount]).sort();
}

describe('GET /api/analytics/raid-stats?difficulty=', () => {
    beforeEach(() => {
        seedRun({ instanceId: '1', completedBy: ['p1'], activityHash: VOG_MASTER, difficultyTier: 0 });
        seedRun({ instanceId: '2', completedBy: ['p2'], activityHash: DP_NORMAL, difficultyTier: 2 });
        seedRun({ instanceId: '3', completedBy: ['p3'], activityHash: DP_EPIC });
        seedRun({ instanceId: '4', completedBy: ['p4'], activityHash: DP_EPIC });
    });

    it.each([
        ['master', [['vault_of_glass', 1]]],
        ['normal', [['the_desert_perpetual', 1]]],
        ['epic', [['the_desert_perpetual', 2]]],
    ])('difficulty=%s counts only instances whose activity hash has that Difficulty', async (difficulty, expected) => {
        expect(await instancesPerRaid({ hours: '24', difficulty })).toEqual(expected);
    });

    it('normal and epic split The Desert Perpetual between them, so its unfiltered count is their sum', async () => {
        expect(await instancesPerRaid({ hours: '24' })).toEqual([['the_desert_perpetual', 3], ['vault_of_glass', 1]]);
    });

    it('an unknown difficulty is ignored', async () => {
        expect(await instancesPerRaid({ hours: '24', difficulty: 'hard' })).toEqual([['the_desert_perpetual', 3], ['vault_of_glass', 1]]);
    });
});
