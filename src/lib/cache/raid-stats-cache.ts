import type { RaidFilters, RaidScope, RaidScopeStats, RaidStatsFrameRow } from '../db/queries';
import type { CacheState } from './swr-cache';

export const RAID_STATS_MISS_PAUSE_MS = 0;

export interface RaidStatsRead<T> {
    value: T;
    state: CacheState | null;
}

export async function readRaidStatsFrame(_hoursBack: number, _filters?: RaidFilters): Promise<RaidStatsRead<RaidStatsFrameRow[]>> {
    throw new Error('not implemented');
}

export async function readRaidStatsScope(
    _hoursBack: number,
    _scope: RaidScope,
    _filters?: RaidFilters
): Promise<RaidStatsRead<Map<string, RaidScopeStats> | null>> {
    throw new Error('not implemented');
}
