import 'dotenv/config';
import { startCrawler, stopCrawler } from '../src/lib/crawler';
import { getDbStats, getPlayerCount } from '../src/lib/db/queries';
import { closeDb } from '../src/lib/db';
import { diffRequestCounts, getBungieClient, type RequestCounts } from '../src/lib/bungie/client';

// ============================================
// CONFIGURATION
// ============================================

const CRAWLER_CONFIG = {
    intervalMs: parseInt(process.env.CRAWLER_INTERVAL_MS || '90000', 10),
    maxPlayersPerCycle: parseInt(process.env.CRAWLER_MAX_PLAYERS_PER_CYCLE || '50', 10),
    hoursBack: parseInt(process.env.CRAWLER_HOURS_BACK || '24', 10),
    crawlConcurrency: parseInt(process.env.CRAWLER_CONCURRENCY || '5', 10),
    enableActiveSessionPolling: process.env.CRAWLER_ENABLE_ACTIVE_SESSION_POLLING !== 'false',
    activeSessionIntervalMs: parseInt(process.env.CRAWLER_ACTIVE_SESSION_INTERVAL_MS || '120000', 10), // 2 minutes
    cleanupIntervalMs: 1800000, // 30 minutes
    cleanupMaxAgeHours: parseInt(process.env.CRAWLER_CLEANUP_MAX_AGE_HOURS || '48', 10),
    // CRAWLER_MEMBER_RESOLVE_LIMIT (default 25): max unknown fireteam members resolved to
    // Name#Code per active-session cycle via GetLinkedProfiles. Read in src/lib/crawler/active-sessions.ts.
    // ACTIVE_SESSION_POLL_REQUEST_MAX_PER_CYCLE (default 20): poll requests for players with no
    // session row checked per active-session cycle, one GetProfile each, on top of
    // CRAWLER_SESSION_POLLING_LIMIT. Requests on players with a row only mark it for re-verify,
    // inside ACTIVE_SESSION_STALE_REVERIFY_LIMIT. Read in src/lib/crawler/active-sessions.ts.
    // ACTIVE_SESSION_POLL_REQUEST_QUEUE_MAX (default 200): pending poll requests for players with
    // no session row; a request beyond it is refused. Read in src/lib/db/queries.ts.
    // The two limits on the web side of poll requests are read by the web processes, not here:
    // ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN (default 60) and
    // ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC (default 300), in src/lib/http/poll-request-limits.ts.
    // Both are per web process, so under PM2 cluster x2 the effective ceilings are up to twice the knobs.
    // History-crawl requests from a profile view have limits of their own, apart from the poll's:
    // HISTORY_CRAWL_REQUEST_QUEUE_MAX (default 200): profile-view rows in crawl_queue; a request
    // beyond it is refused. Enforced in SQLite, so it holds across processes. The crawler's own
    // session-end enqueues are neither counted nor capped. Read in src/lib/db/queries.ts.
    // HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN (default 60): read by the web processes, not here, in
    // src/lib/http/history-crawl-limits.ts; in memory and per web process, like the poll's.
};

// One line a minute with how many Bungie requests this process's shared client made.
// The scanner and discovery run their own processes and clients, so they are not in it.
const REQUEST_COUNT_LOG_INTERVAL_MS = 60_000;

// Each field's label in the log line, in print order. A Record, so a new field is a compile error here
// rather than a count the log silently leaves out.
const REQUEST_COUNT_LOG_LABELS: Record<keyof RequestCounts, string> = {
    activityHistory: 'activity',
    pgcr: 'pgcr',
    profileIdsOnly: 'profile_characters_only',
    profileOther: 'profile_other',
    linkedProfiles: 'linked_profiles',
    other: 'other',
    throttled429: 'throttled_429',
    throttled1672: 'throttled_1672',
    throttledBungie: 'throttled_bungie',
};

function startRequestCountLog(): NodeJS.Timeout {
    const client = getBungieClient();
    let previous = client.getRequestCounts();
    const timer = setInterval(() => {
        const current = client.getRequestCounts();
        const d = diffRequestCounts(previous, current);
        previous = current;
        const fields = (Object.keys(REQUEST_COUNT_LOG_LABELS) as (keyof RequestCounts)[])
            .map((key) => `${REQUEST_COUNT_LOG_LABELS[key]}=${d[key]}`);
        console.log(`[bungie-requests/min] ${fields.join(' ')}`);
    }, REQUEST_COUNT_LOG_INTERVAL_MS);
    // Never the reason the process stays alive.
    timer.unref();
    return timer;
}

// ============================================
// SCRIPT
// ============================================

async function main() {
    console.log('========================================');
    console.log('  Destiny Farm Finder — Crawler');
    console.log('========================================\n');

    // Check if we have players to crawl
    const playerCount = getPlayerCount();
    if (playerCount === 0) {
        console.error('[ERROR] No players in the database!');
        console.error('Run the discovery tool first to seed players:');
        console.error('  npx tsx scripts/discover.ts\n');
        process.exit(1);
    }

    const stats = getDbStats();
    console.log('Database stats:', stats);
    console.log('');
    console.log('Crawler config:', CRAWLER_CONFIG);
    console.log('');
    console.log('Starting crawler... Press Ctrl+C to stop.\n');

    const requestCountTimer = startRequestCountLog();

    // Handle graceful shutdown
    const shutdown = (signal: NodeJS.Signals) => {
        console.log(`\n[INFO] Received ${signal}. Shutting down gracefully...`);
        clearInterval(requestCountTimer);
        stopCrawler();
        setTimeout(() => {
            closeDb();
            console.log('[INFO] Shutdown complete.');
            process.exit(0);
        }, 2000);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start the crawler
    await startCrawler(CRAWLER_CONFIG);
}

main();
