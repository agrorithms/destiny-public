import { getBungieClient, BungieAPIError } from '../bungie/client';
import { isBungieSystemDisabledError } from '../bungie/maintenance';
import { isRaidActivityHash } from '../bungie/manifest';
import { recordCrawlOutcome, getCachedCharacterIds, updateCharacterIds } from '../db/queries';
import type { CrawlOutcome } from '../db/queries';
import { fetchAndStorePGCR } from './pgcr';
import { isoToUnix, hoursAgo } from '../utils/helpers';
import type { PlayerInfo, DestinyHistoricalStatsPeriodGroup } from '../bungie/types';

/** Default re-crawl buffer (seconds) subtracted from last_crawled_at. */
const DEFAULT_RECRAWL_BUFFER_SECONDS = 30 * 60;

/** Read the activity-level duration (seconds) from an activity-history entry. */
function readActivityDuration(activity: DestinyHistoricalStatsPeriodGroup): number {
    const value = activity.values?.activityDurationSeconds?.basic?.value;
    return typeof value === 'number' && value > 0 ? value : 0;
}

// Default character ID cache TTL: 14 days
const DEFAULT_CHAR_ID_TTL_SECONDS = 14 * 24 * 60 * 60;

function extractBungieMessage(rawMessage: string): string | null {
    const jsonStart = rawMessage.indexOf('{');
    if (jsonStart === -1) {
        return null;
    }

    const jsonPart = rawMessage.slice(jsonStart);
    try {
        const parsed = JSON.parse(jsonPart) as { Message?: unknown };
        if (typeof parsed.Message === 'string' && parsed.Message.trim().length > 0) {
            return parsed.Message.trim().replace(/\s+/g, ' ');
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * Get all character IDs for a player (no caching — used by discovery callers).
 */
export async function getCharacterIds(
    membershipType: number,
    membershipId: string
): Promise<string[]> {
    const client = getBungieClient();

    try {
        const profile = await client.getProfile(membershipType, membershipId, [100]);
        const characterIds = profile.Response.profile?.data?.characterIds || [];
        return characterIds;
    } catch (error) {
        if (isBungieSystemDisabledError(error)) {
            throw error;
        }

        if (error instanceof BungieAPIError) {
            // Error code 217 = DestinyAccountNotFound
            // Error code 1601 = DestinyAccountNotFound (alternate)
            // ErrorStatus "DestinyPrivacyRestriction" = private profile
            if (
                error.errorStatus === 'DestinyPrivacyRestriction' ||
                error.errorCode === 217 ||
                error.errorCode === 1601
            ) {
                console.log(`[SKIP] Private/unavailable profile: ${membershipId}`);
                return [];
            }
        }
        console.error(`[ERROR] Failed to fetch characters for ${membershipId}:`, (error as Error).message);
        return [];
    }
}

/**
 * Fetch character IDs from the Bungie API and store them in the cache.
 * Returns the fetched IDs (may be empty on privacy restriction / not found).
 */
async function fetchAndCacheCharacterIds(
    membershipType: number,
    membershipId: string
): Promise<{ ids: string[]; isPrivate: boolean; isNotFound: boolean }> {
    const client = getBungieClient();
    try {
        const profile = await client.getProfile(membershipType, membershipId, [100]);
        const ids = profile.Response.profile?.data?.characterIds || [];
        // Only cache a non-empty result — empty may mean private/not-found
        if (ids.length > 0) {
            updateCharacterIds(membershipId, ids);
        }
        return { ids, isPrivate: false, isNotFound: false };
    } catch (error) {
        if (isBungieSystemDisabledError(error)) {
            throw error;
        }
        if (error instanceof BungieAPIError) {
            // 217 / 1601 = DestinyAccountNotFound → permanent, deactivate.
            if (error.errorCode === 217 || error.errorCode === 1601) {
                console.log(`[SKIP] Account not found: ${membershipId}`);
                return { ids: [], isPrivate: false, isNotFound: true };
            }
            // Private profile → can't read until they un-private (long backoff).
            if (error.errorStatus === 'DestinyPrivacyRestriction') {
                console.log(`[SKIP] Private profile: ${membershipId}`);
                return { ids: [], isPrivate: true, isNotFound: false };
            }
        }
        console.error(`[ERROR] Failed to fetch characters for ${membershipId}:`, (error as Error).message);
        return { ids: [], isPrivate: false, isNotFound: false };
    }
}

/**
 * Get character IDs with cache support (used by crawlPlayer).
 * Skips the getProfile call if the cache is fresh; refreshes on TTL expiry.
 * Does not cache empty results (private/not-found).
 */
async function getCharacterIdsCached(
    membershipType: number,
    membershipId: string,
    charIdTtlSeconds: number
): Promise<{ ids: string[]; isPrivate: boolean; isNotFound: boolean; fromCache: boolean }> {
    const now = Math.floor(Date.now() / 1000);
    const cached = getCachedCharacterIds(membershipId);

    if (cached && now - cached.updatedAt < charIdTtlSeconds) {
        return { ids: cached.ids, isPrivate: false, isNotFound: false, fromCache: true };
    }

    const { ids, isPrivate, isNotFound } = await fetchAndCacheCharacterIds(membershipType, membershipId);
    return { ids, isPrivate, isNotFound, fromCache: false };
}

/**
 * Get recent raid activity instance IDs for a single character (no DB-stop; used by discovery).
 */
export async function getRecentRaidActivities(
    membershipType: number,
    membershipId: string,
    characterId: string,
    hoursBack: number = 4,
    count: number = 25
): Promise<{
    activities: Array<{ instanceId: string; activityHash: number; period: number }>;
    isPrivacyRestricted: boolean;
}> {
    const client = getBungieClient();
    const cutoff = hoursAgo(hoursBack);

    try {
        const response = await client.getActivityHistory(
            membershipType,
            membershipId,
            characterId,
            { mode: 4, count }
        );

        const activities = response.Response.activities || [];

        return {
            activities: activities
                .filter((activity) => {
                    const period = isoToUnix(activity.period);
                    const hash = activity.activityDetails.directorActivityHash || activity.activityDetails.referenceId;
                    return period >= cutoff && isRaidActivityHash(hash);
                })
                .map((activity) => ({
                    instanceId: activity.activityDetails.instanceId,
                    activityHash: activity.activityDetails.directorActivityHash || activity.activityDetails.referenceId,
                    period: isoToUnix(activity.period),
                })),
            isPrivacyRestricted: false,
        };
    } catch (error) {
        const errorMessage = (error as Error).message || '';

        if (isBungieSystemDisabledError(error)) {
            throw error;
        }

        if (error instanceof BungieAPIError) {
            if (
                error.errorStatus === 'DestinyPrivacyRestriction' ||
                error.errorCode === 217 ||
                error.errorCode === 1601
            ) {
                const bungieMessage = error.message || 'The user has chosen for this data to be private. No peeking!';
                console.log(`🔒 ${membershipId} : Bungie API Error - ${bungieMessage}`);
                return { activities: [], isPrivacyRestricted: true };
            }
        }
        if (
            errorMessage.includes('DestinyPrivacyRestriction') ||
            errorMessage.includes('"ErrorCode":1665')
        ) {
            const bungieMessage = extractBungieMessage(errorMessage) || 'The user has chosen for this data to be private. No peeking!';
            console.log(`🔒 ${membershipId} : Bungie API Error - ${bungieMessage}`);
            return { activities: [], isPrivacyRestricted: true };
        }
        console.error(`[ERROR] Failed to fetch activity history for ${membershipId}/${characterId}:`, (error as Error).message);
        return { activities: [], isPrivacyRestricted: false };
    }
}

interface ActivityHistoryResult {
    instanceIds: string[];
    isPrivacyRestricted: boolean;
    /** True on DestinyAccountNotFound (217/1601) — permanent, deactivate. */
    isNotFound: boolean;
    /** True if the API call itself errored (distinct from privacy/not-found). */
    hadError: boolean;
    stopReason: 'already_covered' | 'time_cap' | 'exhausted' | 'privacy' | 'not_found' | 'error';
}

/**
 * Paginate a character's raid activity history, stopping once we reach activities
 * already covered by this player's previous crawl (ended_at < last_crawled_at -
 * buffer) or exceed the time cap. The ended_at comparison is per-player, so a raid
 * instance saved by another player's crawl no longer false-stops this one. Used by
 * crawlPlayer.
 */
async function getRaidActivitiesUntilKnown(
    membershipType: number,
    membershipId: string,
    characterId: string,
    pageCount: number,
    maxPages: number,
    cutoffUnix: number,
    lastCrawledAt: number,
    bufferSeconds: number
): Promise<ActivityHistoryResult> {
    const client = getBungieClient();
    const instanceIds: string[] = [];
    const coveredCutoff = lastCrawledAt > 0 ? lastCrawledAt - bufferSeconds : 0;

    for (let page = 0; page < maxPages; page++) {
        let activities: DestinyHistoricalStatsPeriodGroup[];

        try {
            const response = await client.getActivityHistory(
                membershipType,
                membershipId,
                characterId,
                { mode: 4, count: pageCount, page }
            );
            activities = response.Response.activities || [];
        } catch (error) {
            const errorMessage = (error as Error).message || '';

            if (isBungieSystemDisabledError(error)) {
                throw error;
            }

            if (error instanceof BungieAPIError) {
                // 217 / 1601 = DestinyAccountNotFound → permanent, deactivate.
                if (error.errorCode === 217 || error.errorCode === 1601) {
                    console.log(`👻 ${membershipId} : account not found`);
                    return { instanceIds, isPrivacyRestricted: false, isNotFound: true, hadError: false, stopReason: 'not_found' };
                }
                if (error.errorStatus === 'DestinyPrivacyRestriction') {
                    const msg = error.message || 'Private activity history.';
                    console.log(`🔒 ${membershipId} : Bungie API Error - ${msg}`);
                    return { instanceIds, isPrivacyRestricted: true, isNotFound: false, hadError: false, stopReason: 'privacy' };
                }
            }
            if (
                errorMessage.includes('DestinyPrivacyRestriction') ||
                errorMessage.includes('"ErrorCode":1665')
            ) {
                const msg = extractBungieMessage(errorMessage) || 'Private activity history.';
                console.log(`🔒 ${membershipId} : Bungie API Error - ${msg}`);
                return { instanceIds, isPrivacyRestricted: true, isNotFound: false, hadError: false, stopReason: 'privacy' };
            }

            console.error(`[ERROR] Activity history page ${page} failed for ${membershipId}/${characterId}:`, (error as Error).message);
            return { instanceIds, isPrivacyRestricted: false, isNotFound: false, hadError: true, stopReason: 'error' };
        }

        if (activities.length === 0) {
            return { instanceIds, isPrivacyRestricted: false, isNotFound: false, hadError: false, stopReason: 'exhausted' };
        }

        let hitCovered = false;
        let hitTimeCap = false;

        for (const activity of activities) {
            const period = isoToUnix(activity.period);
            if (period < cutoffUnix) {
                hitTimeCap = true;
                break;
            }

            // Per-player stop: once we reach a run that ended before this player's
            // last successful crawl (minus buffer), everything older is covered.
            // A run still in progress at the last crawl has ended_at > watermark,
            // so it is correctly kept. Missing duration (0) → don't stop here.
            const endedAt = period + readActivityDuration(activity);
            if (coveredCutoff > 0 && endedAt > 0 && endedAt < coveredCutoff) {
                hitCovered = true;
                break;
            }

            const hash = activity.activityDetails.directorActivityHash || activity.activityDetails.referenceId;
            if (!isRaidActivityHash(hash)) continue;

            // fetchAndStorePGCR dedups via hasPGCR, so re-collecting an instance the
            // scanner/another crawl already stored is a cheap no-op, not an API call.
            instanceIds.push(activity.activityDetails.instanceId);
        }

        if (hitCovered) {
            return { instanceIds, isPrivacyRestricted: false, isNotFound: false, hadError: false, stopReason: 'already_covered' };
        }
        if (hitTimeCap) {
            return { instanceIds, isPrivacyRestricted: false, isNotFound: false, hadError: false, stopReason: 'time_cap' };
        }
        // If this page was shorter than requested, there are no more pages
        if (activities.length < pageCount) {
            return { instanceIds, isPrivacyRestricted: false, isNotFound: false, hadError: false, stopReason: 'exhausted' };
        }
    }

    return { instanceIds, isPrivacyRestricted: false, isNotFound: false, hadError: false, stopReason: 'exhausted' };
}

export interface CrawlPlayerOptions {
    /** Activities to fetch per page (hot/queue: 15, warm/cold: 50). Default 25. */
    pageCount?: number;
    /** Maximum pages to paginate per character. Default 5. */
    maxPages?: number;
    /** Hard time cap in hours for backfill. Default 720 (30 days). */
    maxBackfillHours?: number;
    /** Character ID cache TTL in seconds. Default 14 days. */
    charIdTtlSeconds?: number;
    /** Re-crawl buffer (seconds) subtracted from last_crawled_at. Default 30 min. */
    recrawlBufferSeconds?: number;
}

/**
 * Crawl a single player: fetch their recent raid activities across all characters,
 * then fetch and store any new PGCRs. Returns newly discovered players.
 */
export async function crawlPlayer(
    player: PlayerInfo,
    options: CrawlPlayerOptions = {}
): Promise<{
    newPGCRs: number;
    discoveredPlayers: PlayerInfo[];
}> {
    const {
        pageCount = 25,
        maxPages = 5,
        maxBackfillHours = 720,
        charIdTtlSeconds = DEFAULT_CHAR_ID_TTL_SECONDS,
        recrawlBufferSeconds = DEFAULT_RECRAWL_BUFFER_SECONDS,
    } = options;

    const cutoffUnix = hoursAgo(maxBackfillHours);
    // Coverage watermark: last successful crawl. 0 (never crawled) → full backfill.
    const lastCrawledAt = player.lastCrawledAt ?? 0;

    let newPGCRs = 0;
    const discoveredPlayers: PlayerInfo[] = [];
    const seenMembershipIds = new Set<string>();

    try {
        // Fetch character IDs, using the cache when fresh
        const { ids: characterIds, isPrivate, isNotFound, fromCache } = await getCharacterIdsCached(
            player.membershipType,
            player.membershipId,
            charIdTtlSeconds
        );

        if (isNotFound) {
            recordCrawlOutcome(player.membershipId, 'not_found');
            return { newPGCRs, discoveredPlayers };
        }

        if (isPrivate) {
            recordCrawlOutcome(player.membershipId, 'privacy');
            return { newPGCRs, discoveredPlayers };
        }

        if (characterIds.length === 0) {
            console.warn(`⚠️ No characters found for ${player.displayName} (${player.membershipId})`);
            recordCrawlOutcome(player.membershipId, 'transient');
            return { newPGCRs, discoveredPlayers };
        }

        // Fetch raid activities for each character, stopping at the per-player
        // ended_at coverage watermark.
        const uniqueInstanceIds = new Set<string>();
        let privacyRestricted = false;
        let notFound = false;
        let hadError = false;
        let needsCharIdRefresh = false;
        const processedCharIds = new Set<string>();

        for (const characterId of characterIds) {
            processedCharIds.add(characterId);
            const result = await getRaidActivitiesUntilKnown(
                player.membershipType,
                player.membershipId,
                characterId,
                pageCount,
                maxPages,
                cutoffUnix,
                lastCrawledAt,
                recrawlBufferSeconds
            );

            if (result.isNotFound) {
                notFound = true;
                break;
            }
            if (result.isPrivacyRestricted) {
                privacyRestricted = true;
                break;
            }
            if (result.hadError) {
                hadError = true;
                // If we got an error and were using cached char IDs, the cache may be stale
                if (fromCache) needsCharIdRefresh = true;
            }

            for (const instanceId of result.instanceIds) {
                uniqueInstanceIds.add(instanceId);
            }
        }

        // Error-driven char ID refresh: if any character history call errored while using cached IDs,
        // re-fetch from getProfile to catch deleted/changed characters
        if (needsCharIdRefresh && !privacyRestricted && !notFound) {
            console.log(`[CRAWLER] Refreshing cached char IDs for ${player.membershipId} after API error`);
            const refreshed = await fetchAndCacheCharacterIds(player.membershipType, player.membershipId);
            if (!refreshed.isPrivate && !refreshed.isNotFound && refreshed.ids.length > 0) {
                // Crawl any character IDs not yet processed
                for (const characterId of refreshed.ids) {
                    if (processedCharIds.has(characterId)) continue;
                    const result = await getRaidActivitiesUntilKnown(
                        player.membershipType,
                        player.membershipId,
                        characterId,
                        pageCount,
                        maxPages,
                        cutoffUnix,
                        lastCrawledAt,
                        recrawlBufferSeconds
                    );
                    if (result.isNotFound) {
                        notFound = true;
                        break;
                    }
                    if (result.isPrivacyRestricted) {
                        privacyRestricted = true;
                        break;
                    }
                    if (result.hadError) hadError = true;
                    for (const instanceId of result.instanceIds) {
                        uniqueInstanceIds.add(instanceId);
                    }
                }
            }
        }

        if (notFound) {
            recordCrawlOutcome(player.membershipId, 'not_found');
            return { newPGCRs, discoveredPlayers };
        }
        if (privacyRestricted) {
            recordCrawlOutcome(player.membershipId, 'privacy');
            return { newPGCRs, discoveredPlayers };
        }

        // Fetch and store each new PGCR (dedups via hasPGCR — known instances are
        // a cheap no-op). Run this even on a partial (hadError) crawl to keep what
        // we did collect; the watermark just won't advance.
        for (const instanceId of uniqueInstanceIds) {
            const processed = await fetchAndStorePGCR(instanceId, 'crawler');

            if (processed) {
                newPGCRs++;

                // Discover new players from this PGCR
                for (const discoveredPlayer of processed.players) {
                    if (
                        discoveredPlayer.membershipId !== player.membershipId &&
                        !seenMembershipIds.has(discoveredPlayer.membershipId)
                    ) {
                        seenMembershipIds.add(discoveredPlayer.membershipId);
                        discoveredPlayers.push(discoveredPlayer);
                    }
                }
            }
        }

        // Advance the coverage watermark only on a clean, complete traversal.
        // A partial crawl (hadError) records a transient failure so it is re-covered.
        recordCrawlOutcome(player.membershipId, hadError ? 'transient' : 'success');

    } catch (error) {
        if (isBungieSystemDisabledError(error)) {
            throw error;
        }

        let outcome: CrawlOutcome = 'transient';
        if (error instanceof BungieAPIError && (error.errorCode === 217 || error.errorCode === 1601)) {
            console.log(`👻 Account not found: ${player.displayName} (${player.membershipId})`);
            outcome = 'not_found';
        } else if (error instanceof BungieAPIError && error.errorStatus === 'DestinyPrivacyRestriction') {
            console.log(`[SKIP] Private profile: ${player.displayName} (${player.membershipId})`);
            outcome = 'privacy';
        } else {
            console.error(`[ERROR] Error crawling player ${player.displayName}:`, (error as Error).message);
        }
        recordCrawlOutcome(player.membershipId, outcome);
    }

    return { newPGCRs, discoveredPlayers };
}
