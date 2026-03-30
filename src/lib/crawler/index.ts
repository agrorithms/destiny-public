import {
    getPlayersForSessionPolling,
    getPlayersToCrawl,
    bulkUpsertPlayers,
    cleanupOldPGCRs,
    getDbStats,
    getSessionPollingCandidateLimit,
} from '../db/queries';
import { crawlPlayer } from './players';
import { pollActiveSessions } from './active-sessions';
import { getDb } from '../db';
import { processWithConcurrency } from '../utils/concurrent';
import type { PlayerInfo } from '../bungie/types';

function writeCrawlerHeartbeat(): void {
    const db = getDb();
    db.prepare(`
    INSERT INTO crawler_state (key, value, updated_at)
    VALUES ('heartbeat', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = unixepoch()
  `).run(new Date().toISOString());
}

function writeCrawlerStatus(status: string): void {
    const db = getDb();
    db.prepare(`
    INSERT INTO crawler_state (key, value, updated_at)
    VALUES ('status', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = unixepoch()
  `).run(status);
}

export interface CrawlerConfig {
    intervalMs: number;
    maxPlayersPerCycle: number;
    hoursBack: number;
    crawlConcurrency: number;
    enableActiveSessionPolling: boolean;
    activeSessionIntervalMs: number;
    activeSessionConcurrency: number;
    activeSessionStaleConcurrency: number;
    activeSessionStaleReverifyLimit: number;
    sessionPollingLimit: number;
    cleanupIntervalMs: number;
    cleanupMaxAgeHours: number;
}

const DEFAULT_CONFIG: CrawlerConfig = {
    intervalMs: parseInt(process.env.CRAWLER_INTERVAL_MS || '90000', 10),
    maxPlayersPerCycle: parseInt(process.env.CRAWLER_MAX_PLAYERS_PER_CYCLE || '50', 10),
    hoursBack: parseInt(process.env.CRAWLER_HOURS_BACK || '24', 10),
    crawlConcurrency: parseInt(process.env.CRAWLER_CONCURRENCY || '5', 10),
    enableActiveSessionPolling: true,
    activeSessionIntervalMs: parseInt(process.env.CRAWLER_ACTIVE_SESSION_INTERVAL_MS || '120000', 10), // 2 minutes
    activeSessionConcurrency: Math.max(
        1,
        parseInt(process.env.ACTIVE_SESSION_CONCURRENCY || process.env.CRAWLER_CONCURRENCY || '4', 10)
    ),
    activeSessionStaleConcurrency: Math.max(
        1,
        parseInt(
            process.env.ACTIVE_SESSION_STALE_CONCURRENCY
            || process.env.ACTIVE_SESSION_CONCURRENCY
            || process.env.CRAWLER_CONCURRENCY
            || '4',
            10
        )
    ),
    activeSessionStaleReverifyLimit: Math.max(
        1,
        parseInt(process.env.ACTIVE_SESSION_STALE_REVERIFY_LIMIT || '200', 10)
    ),
    sessionPollingLimit: Math.max(
        1,
        parseInt(process.env.CRAWLER_SESSION_POLLING_LIMIT || '200', 10)
    ),
    cleanupIntervalMs: 1800000, // 30 minutes
    cleanupMaxAgeHours: parseInt(process.env.CRAWLER_CLEANUP_MAX_AGE_HOURS || '24', 10),
};

let isRunning = false;
let shouldStop = false;

/**
 * Run a single crawl cycle: pick players, crawl their activity history,
 * fetch new PGCRs, and discover new players.
 */
async function crawlCycle(config: CrawlerConfig): Promise<{
    playersCrawled: number;
    newPGCRs: number;
    newPlayersDiscovered: number;
}> {
    const players = getPlayersToCrawl(config.maxPlayersPerCycle);

    if (players.length === 0) {
        console.log('⚠️ No players to crawl. Run the discovery tool first to seed players.');
        return { playersCrawled: 0, newPGCRs: 0, newPlayersDiscovered: 0 };
    }

    let totalNewPGCRs = 0;
    const discoveredFlushSize = Math.max(
        1,
        parseInt(process.env.CRAWLER_DISCOVERED_PLAYERS_FLUSH_SIZE || '500', 10)
    );
    const discoveredPlayersBuffer: PlayerInfo[] = [];
    let totalNewPlayersDiscovered = 0;
    let crawledCount = 0;
    const halfMilestone = Math.max(1, Math.floor(config.maxPlayersPerCycle / 2));
    const fullMilestone = config.maxPlayersPerCycle;
    const reachedMilestones = new Set<number>();

    const results = await processWithConcurrency(
        players,
        config.crawlConcurrency,
        async (player) => {
            if (shouldStop) {
                return { newPGCRs: 0, discoveredPlayers: [] as PlayerInfo[], skipped: true };
            }
            const result = await crawlPlayer(player, config.hoursBack);
            return { ...result, skipped: false };
        },
        (completed, total) => {
            const milestones = [
                Math.min(halfMilestone, total),
                Math.min(fullMilestone, total),
            ];

            for (const milestone of milestones) {
                if (completed >= milestone && !reachedMilestones.has(milestone)) {
                    reachedMilestones.add(milestone);
                    console.log(`[CRAWLER] Progress: ${completed}/${total} players`);
                }
            }

            if (completed === total && !reachedMilestones.has(total)) {
                reachedMilestones.add(total);
                console.log(`[CRAWLER] Progress: ${completed}/${total} players`);
            }
        }
    );

    for (const result of results) {
        if (!result.success) continue;
        if (result.result.skipped) continue;
        crawledCount++;
        totalNewPGCRs += result.result.newPGCRs;
        if (result.result.discoveredPlayers.length > 0) {
            totalNewPlayersDiscovered += result.result.discoveredPlayers.length;
            discoveredPlayersBuffer.push(...result.result.discoveredPlayers);

            if (discoveredPlayersBuffer.length >= discoveredFlushSize) {
                bulkUpsertPlayers(discoveredPlayersBuffer);
                discoveredPlayersBuffer.length = 0;
            }
        }
    }

    // Flush any remaining discovered players
    if (discoveredPlayersBuffer.length > 0) {
        bulkUpsertPlayers(discoveredPlayersBuffer);
        discoveredPlayersBuffer.length = 0;
    }

    return {
        playersCrawled: crawledCount,
        newPGCRs: totalNewPGCRs,
        newPlayersDiscovered: totalNewPlayersDiscovered,
    };
}

/**
 * Start the main crawler loop using recursive setTimeout
 */
export async function startCrawler(overrides?: Partial<CrawlerConfig>): Promise<void> {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    const effectiveSessionPollingCandidateLimit = getSessionPollingCandidateLimit(config.sessionPollingLimit);

    if (isRunning) {
        console.warn('⚠️ Crawler is already running');
        return;
    }

    isRunning = true;
    shouldStop = false;
    writeCrawlerStatus('running');
    writeCrawlerHeartbeat();

    console.log('🚀 Starting crawler with config:', {
        intervalMs: config.intervalMs,
        maxPlayersPerCycle: config.maxPlayersPerCycle,
        hoursBack: config.hoursBack,
        crawlConcurrency: config.crawlConcurrency,
        activeSessionIntervalMs: config.activeSessionIntervalMs,
        activeSessionConcurrency: config.activeSessionConcurrency,
        activeSessionStaleConcurrency: config.activeSessionStaleConcurrency,
        activeSessionStaleReverifyLimit: config.activeSessionStaleReverifyLimit,
        sessionPollingLimit: config.sessionPollingLimit,
        sessionPollingCandidateLimit: effectiveSessionPollingCandidateLimit,
    });

    // Print initial stats
    const stats = getDbStats();
    console.log('📊 Database stats:', stats);

    // Main crawl loop
    async function crawlLoop() {
        if (shouldStop) {
            isRunning = false;
            writeCrawlerStatus('stopped');
            console.log('[CRAWLER] Crawler stopped');
            return;
        }

        const startTime = Date.now();
        writeCrawlerHeartbeat();
        writeCrawlerStatus('running');
        console.log(`\n🔄 Starting crawl cycle at ${new Date().toISOString()}`);

        try {
            const result = await crawlCycle(config);
            console.log(
                `📈 Crawl cycle complete: ${result.playersCrawled} players crawled, ` +
                `${result.newPGCRs} new PGCRs, ${result.newPlayersDiscovered} new players`
            );
        } catch (error) {
            console.error('❌ Crawl cycle error:', error);
        }

        const elapsed = Date.now() - startTime;
        const waitTime = Math.max(0, config.intervalMs - elapsed);

        console.log(`⏱️ Cycle took ${(elapsed / 1000).toFixed(1)}s, waiting ${(waitTime / 1000).toFixed(1)}s`);

        setTimeout(crawlLoop, waitTime);
    }

    // Active session polling loop (separate interval)
    async function activeSessionLoop() {
        if (shouldStop || !config.enableActiveSessionPolling) return;

        const startTime = Date.now();
        console.log(`\n👁️ Polling active sessions...`);

        try {
            const players = getPlayersForSessionPolling(config.sessionPollingLimit);
            console.log(`[SESSIONS] Checking ${players.length} recently active players...`);
            const sessions = await pollActiveSessions(players, config.sessionPollingLimit, {
                playerCheckConcurrency: config.activeSessionConcurrency,
                staleCheckConcurrency: config.activeSessionStaleConcurrency,
                staleReverifyLimit: config.activeSessionStaleReverifyLimit,
            });

            // Log summary by raid
            const byRaid = new Map<string, number>();
            for (const session of sessions) {
                const count = byRaid.get(session.raidName) || 0;
                byRaid.set(session.raidName, count + 1);
            }
            for (const [raid, count] of byRaid) {
                console.log(`  🎮 ${raid}: ${count} active sessions`);
            }
        } catch (error) {
            console.error('❌ Active session poll error:', error);
        }

        const elapsed = Date.now() - startTime;
        const waitTime = Math.max(0, config.activeSessionIntervalMs - elapsed);
        console.log(`[SESSIONS] Poll took ${(elapsed / 1000).toFixed(1)}s, waiting ${(waitTime / 1000).toFixed(1)}s`);
        setTimeout(activeSessionLoop, waitTime);
    }

    // Cleanup loop
    async function cleanupLoop() {
        if (shouldStop) return;

        console.log(`\n🧹 Running cleanup...`);

        try {
            const result = cleanupOldPGCRs(config.cleanupMaxAgeHours);
            console.log(
                `🧹 Cleanup: removed ${result.pgcrsDeleted} old PGCRs and ${result.playersDeleted} player entries`
            );

            const stats = getDbStats();
            console.log('📊 Database stats:', stats);
        } catch (error) {
            console.error('❌ Cleanup error:', error);
        }

        setTimeout(cleanupLoop, config.cleanupIntervalMs);
    }

    // Start all loops
    crawlLoop();

    if (config.enableActiveSessionPolling) {
        // Delay active session polling by 30 seconds to stagger API usage
        setTimeout(activeSessionLoop, 30000);
    }

    // Delay cleanup by 5 minutes
    setTimeout(cleanupLoop, 300000);
}

/**
 * Stop the crawler gracefully
 */
export function stopCrawler(): void {
    console.log('🛑 Stopping crawler...');
    shouldStop = true;
    writeCrawlerStatus('stopped');
}

/**
 * Check if the crawler is currently running
 */
export function isCrawlerRunning(): boolean {
    return isRunning;
}
