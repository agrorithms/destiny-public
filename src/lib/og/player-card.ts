import {
    getPlayerIdentity,
    getPlayerRaidCompletionSummary,
    formatBungieDisplayName,
} from '@/lib/db/queries';
import { getRaidDefinition } from '@/lib/bungie/manifest';

// "All-time" headline number. The query helper has no upper cap (only the API route caps
// `hours` at 720), so a large window effectively means all of recorded history.
const ALL_TIME_HOURS = 24 * 365 * 30;
// Most-farmed raid is scoped to a rolling 30-day window (720h, the API route's cap).
export const MOST_FARMED_WINDOW_DAYS = 30;
const MOST_FARMED_WINDOW_HOURS = 24 * MOST_FARMED_WINDOW_DAYS;

export interface PlayerOgData {
    displayName: string;
    totalClears: number; // all-time
    topRaidName: string | null; // within the 30-day window
    topRaidCount: number; // within the 30-day window
    windowDays: number;
}

/**
 * Pure SQLite read used by both the player route's `generateMetadata` (text unfurl) and its
 * `opengraph-image` (PNG card). No Bungie API calls — link shares cost a local DB read only.
 * Returns `null` for unknown/untracked players so callers can fall back to generic copy.
 */
export function getPlayerOgData(membershipId: string): PlayerOgData | null {
    const identity = getPlayerIdentity(membershipId);
    if (!identity) return null;

    const allTime = getPlayerRaidCompletionSummary(membershipId, ALL_TIME_HOURS);
    const totalClears = allTime.reduce((sum, row) => sum + row.completions, 0);

    // Rows are already ordered by completions DESC, so the first row is the most-farmed raid.
    const window = getPlayerRaidCompletionSummary(membershipId, MOST_FARMED_WINDOW_HOURS);
    const top = window[0] ?? null;
    const topRaidName = top ? getRaidDefinition(top.raidKey)?.name ?? top.raidKey : null;
    const topRaidCount = top ? top.completions : 0;

    return {
        displayName: formatBungieDisplayName(identity),
        totalClears,
        topRaidName,
        topRaidCount,
        windowDays: MOST_FARMED_WINDOW_DAYS,
    };
}
