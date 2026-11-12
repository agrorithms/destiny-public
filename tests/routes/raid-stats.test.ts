import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/raid-stats/route';
import type { RaidStatsRow } from '@/lib/db/queries';
import { __resetSwrCacheForTests } from '@/lib/cache/swr-cache';
import { readRaidStatsFrame, readRaidStatsScope } from '@/lib/cache/raid-stats-cache';
import { resetTestDb } from '../helpers/db';
import { seedRun } from '../helpers/seed';
import { DP_EPIC, DP_NORMAL, VOG_MASTER } from '../helpers/pgcr-builder';

/**
 * `GET /api/analytics/raid-stats?difficulty=` (#41). The query takes the leaderboard's shared
 * filter clause, which tests/db/raid-stats.test.ts covers; this file covers what the route adds:
 * which `difficulty` values it accepts. Difficulty comes from the activity hash, so the seeds
 * cross it with `difficulty_tier` (Feats).
 */

interface Body {
    raids: RaidStatsRow[];
}

beforeEach(() => {
    resetTestDb();
    __resetSwrCacheForTests();
});

async function raids(query: Record<string, string>): Promise<Body['raids']> {
    const response = await GET(new NextRequest(`http://localhost:3100/api/analytics/raid-stats?${new URLSearchParams(query)}`));
    expect(response.status).toBe(200);
    const body: Body = await response.json();
    return body.raids;
}

async function instancesPerRaid(query: Record<string, string>): Promise<[string, number][]> {
    return (await raids(query)).map((r): [string, number] => [r.raidKey, r.instanceCount]).sort();
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

// Above 168h only Full Clears is computed (ADR 0006, second 2026-11-07 amendment). The key stays
// on the wire as null, so a reader of `row[scope]` sees "not computed" rather than a missing field.
describe('GET /api/analytics/raid-stats scopes by window', () => {
    async function firstRaid(hours: string): Promise<Body['raids'][number]> {
        return (await raids({ hours }))[0];
    }

    beforeEach(() => {
        seedRun({ instanceId: '1', completedBy: ['p1'], activityHash: VOG_MASTER });
    });

    it('sends allAttempts as null at hours=720, with fullClear computed', async () => {
        const raid = await firstRaid('720');
        expect(raid).toHaveProperty('allAttempts', null);
        expect(raid).toHaveProperty('fullClear.sampleSize', 1);
    });

    it('sends both scopes at hours=168', async () => {
        const raid = await firstRaid('168');
        expect(raid).toHaveProperty('allAttempts.sampleSize', 1);
        expect(raid).toHaveProperty('fullClear.sampleSize', 1);
    });
});

// #200: the route composes the frame and the three scopes from their own cache entries
// (src/lib/cache/raid-stats-cache.ts). The response gains Fresh Runs, Clear Time Quartiles and the
// Full Clear count, and is otherwise what it was.
describe('GET /api/analytics/raid-stats, staged (#200)', () => {
    async function get(hours: string): Promise<Response> {
        return GET(new NextRequest(`http://localhost:3100/api/analytics/raid-stats?hours=${hours}`));
    }

    beforeEach(() => {
        seedRun({ instanceId: '1', completedBy: ['p1'], activityHash: VOG_MASTER, activityDurationSeconds: 1500 });
        seedRun({ instanceId: '2', incompleteBy: ['p2'], completed: false, activityHash: VOG_MASTER });
        seedRun({ instanceId: '3', incompleteBy: ['p3'], startedFromBeginning: false, completed: false, activityHash: VOG_MASTER });
    });

    it('sends every scope, the Clear Time Quartiles and the Full Clear count, beside the fields it had', async () => {
        const [raid] = await raids({ hours: '168' });
        expect(raid).toMatchObject({
            raidKey: 'vault_of_glass',
            raidName: 'Vault of Glass',
            instanceCount: 3,
            fastestClearSeconds: 1500,
            clearTimeQuartiles: { p25: 1500, p50: 1500, p75: 1500 },
            fullClearCount: 1,
        });
        expect(raid.dnfRate).toBeCloseTo(2 / 3, 4);
        expect([raid.fullClear.sampleSize, raid.freshRuns!.sampleSize, raid.allAttempts!.sampleSize]).toEqual([1, 2, 3]);
    });

    it('sends freshRuns as null at hours=720, as allAttempts', async () => {
        const [raid] = await raids({ hours: '720' });
        expect(raid).toHaveProperty('freshRuns', null);
        expect(raid).toHaveProperty('allAttempts', null);
        expect(raid).toHaveProperty('fullClearCount', 1);
    });

    it('says MISS while any piece was computed, and HIT once every piece is cached', async () => {
        expect((await get('168')).headers.get('X-Cache')).toBe('MISS');
        expect((await get('168')).headers.get('X-Cache')).toBe('HIT');
    });

    it('shares its pieces with the page: one scope already cached still leaves a MISS for the rest', async () => {
        await readRaidStatsScope(168, 'fullClear');
        await readRaidStatsFrame(168);
        expect((await get('168')).headers.get('X-Cache')).toBe('MISS');
        expect((await get('168')).headers.get('X-Cache')).toBe('HIT');
    });
});
