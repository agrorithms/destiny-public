/**
 * Raid stats, cached in pieces (#200, ADR 0006's 2026-11-12 amendment): the **frame** — the
 * scalar query and the Clear Time Quartiles, everything the scope toggle doesn't move — and one
 * entry per **scope**, each in the in-process stale-while-revalidate cache on the analytics
 * lifetime (`ANALYTICS_CACHE_FRESH_SEC` / `_SWR_SEC`, as the route always used).
 *
 * Why apart: better-sqlite3 runs each statement on the request's thread, back to back. The Raid
 * Stats tab shows one scope, so computing all three would put two scopes nobody asked for on a
 * cold miss — about double the 7d wait. So for raid stats, scope is a cache key, where ADR 0006's
 * #204 amendment had it a dimension of one cached value; Raid Activity's chart sweep still
 * computes every scope in one pass and is untouched. `/api/analytics/raid-stats` composes all four
 * pieces and shares them with the page.
 *
 * **The pause.** On a miss each read waits {@link RAID_STATS_MISS_PAUSE_MS} before its query. The
 * Raid Stats tab streams (two `Suspense` boundaries in src/app/activity/page.tsx), and a blocking
 * query that starts at once leaves Next no free event-loop turn to flush what is already rendered:
 * in the 2026-11-12 prototype, nothing reached the reader until every query was done with no pause
 * or one of 5 ms or less, 10 ms was borderline and 20 ms worked on every run. 100 ms is headroom for
 * the ARM box and load, and costs nothing beside queries of seconds. It sits inside the compute
 * function, so a cache hit never pauses — which is also what puts a warm panel in the first HTML.
 * A stale entry's background refresh pauses too, harmlessly.
 */

import { envSeconds } from '../env';
import { sleep } from '../utils/helpers';
import {
    getRaidScopeStats,
    getRaidStatsFrame,
    isScopeComputed,
    type RaidFilters,
    type RaidScope,
    type RaidScopeStats,
    type RaidStatsFrameRow,
} from '../db/queries';
import { filterKeySuffix } from './leaderboard-cache';
import { getOrCompute, type CacheState, type SwrOptions } from './swr-cache';

/** How long a raid-stats read waits before its query on a cache miss. See the module comment. */
export const RAID_STATS_MISS_PAUSE_MS = 100;

/** A cached read and how the cache answered it; `state` is null when nothing was read. */
export interface RaidStatsRead<T> {
    value: T;
    state: CacheState | null;
}

function cacheOptions(): SwrOptions {
    return {
        freshMs: envSeconds('ANALYTICS_CACHE_FRESH_SEC', 300) * 1000,
        staleMs: envSeconds('ANALYTICS_CACHE_SWR_SEC', 1800) * 1000,
    };
}

/** Waits the pause, then runs `query`: the compute every raid-stats entry is filled by. */
function afterPause<T>(query: () => T): () => Promise<T> {
    return async () => {
        await sleep(RAID_STATS_MISS_PAUSE_MS);
        return query();
    };
}

/** The frame for a window and filters: `raid-stats:frame:{hours}{filters}`. */
export function readRaidStatsFrame(hoursBack: number, filters?: RaidFilters): Promise<RaidStatsRead<RaidStatsFrameRow[]>> {
    return getOrCompute(
        `raid-stats:frame:${hoursBack}${filterKeySuffix(filters)}`,
        cacheOptions(),
        afterPause(() => getRaidStatsFrame(hoursBack, filters))
    );
}

/**
 * One scope for a window and filters: `raid-stats:{scope}:{hours}{filters}`. A scope not computed
 * for the window ({@link isScopeComputed}) is `null` at once, with nothing cached, run or awaited.
 */
export async function readRaidStatsScope(
    hoursBack: number,
    scope: RaidScope,
    filters?: RaidFilters
): Promise<RaidStatsRead<Map<string, RaidScopeStats> | null>> {
    if (!isScopeComputed(scope, hoursBack)) return { value: null, state: null };
    return getOrCompute(
        `raid-stats:${scope}:${hoursBack}${filterKeySuffix(filters)}`,
        cacheOptions(),
        afterPause(() => getRaidScopeStats(hoursBack, scope, filters))
    );
}
