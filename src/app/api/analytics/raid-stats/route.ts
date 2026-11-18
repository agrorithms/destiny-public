import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import { isDifficulty } from '@/lib/bungie/difficulty';
import { envSeconds } from '@/lib/env';
import { assembleRaidStats, type RaidFilters } from '@/lib/db/queries';
import { readRaidStatsFrame, readRaidStatsScope } from '@/lib/cache/raid-stats-cache';
import type { CacheState } from '@/lib/cache/swr-cache';
import { withCache, withNoStore } from '@/lib/http/cache';

/**
 * The response's `X-Cache` (#200): the least fresh of the entries it was built from, since it is
 * now four of them (the frame and each scope, src/lib/cache/raid-stats-cache.ts). One piece
 * computed is a MISS for the response, as one whole-response entry used to be; HIT only when
 * every piece was. A `negative` entry never reaches here: getOrCompute throws it.
 */
const LEAST_FRESH_FIRST: readonly CacheState[] = ['miss', 'stale-error', 'stale'];

function leastFresh(states: readonly (CacheState | null)[]): CacheState {
    return LEAST_FRESH_FIRST.find((state) => states.includes(state)) ?? 'hit';
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const hours = parseInt(searchParams.get('hours') || '168', 10);

    if (hours < 1 || hours > 720) {
        return withNoStore(NextResponse.json(
            { error: 'hours must be between 1 and 720' },
            { status: 400 }
        ));
    }

    const difficultyParam = searchParams.get('difficulty');
    const exactPlayersParam = searchParams.get('exactPlayers');
    const maxPlayersParam = searchParams.get('maxPlayers');

    const filters: RaidFilters = {};
    if (isDifficulty(difficultyParam)) {
        filters.difficulty = difficultyParam;
    }
    if (exactPlayersParam) {
        const parsed = parseInt(exactPlayersParam, 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 6) {
            filters.exactPlayers = parsed;
        }
    } else if (maxPlayersParam) {
        const parsed = parseInt(maxPlayersParam, 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 6) {
            filters.maxPlayers = parsed;
        }
    }
    const freshSec = envSeconds('ANALYTICS_CACHE_FRESH_SEC', 300);
    const swrSec = envSeconds('ANALYTICS_CACHE_SWR_SEC', 1800);

    try {
        // The frame, then each scope in turn: better-sqlite3 blocks, so nothing is gained by
        // starting them together. Unfiltered, these are the Raid Stats tab's own entries.
        const frame = await readRaidStatsFrame(hours, filters);
        const fullClear = await readRaidStatsScope(hours, 'fullClear', filters);
        const freshRuns = await readRaidStatsScope(hours, 'freshRuns', filters);
        const allAttempts = await readRaidStatsScope(hours, 'allAttempts', filters);
        const rows = assembleRaidStats(frame.value, {
            fullClear: fullClear.value,
            freshRuns: freshRuns.value,
            allAttempts: allAttempts.value,
        });
        const state = leastFresh([frame.state, fullClear.state, freshRuns.state, allAttempts.state]);

        const raids = getAllRaidDefinitions();

        const body = {
            hours,
            // RaidStatsRow is the wire contract; raidName is the only thing this layer adds.
            // Which metrics respond to the scope toggle is documented by the nesting there.
            raids: rows.map(row => ({
                ...row,
                raidName: raids[row.raidKey]?.name || row.raidKey,
            })),
        };

        const response = withCache(NextResponse.json(body), freshSec, swrSec);
        response.headers.set('X-Cache', state.toUpperCase());
        return response;
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return withNoStore(NextResponse.json({
                maintenance: true,
                message: 'Database maintenance is in progress. Analytics are temporarily unavailable.',
            }));
        }

        console.error('[ERROR] Raid stats query failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
