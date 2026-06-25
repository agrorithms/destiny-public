/**
 * Background warmer for the leaderboard cache.
 *
 * A single interval in the long-lived `web` process that proactively refreshes
 * the canonical 7d & 30d keys (the slowest, including the per-raid "individual"
 * loop that is the crash path) so users never trigger their computation. It
 * goes through the same `getLeaderboardResponse` path as the route, so it shares
 * the single-flight cache and benefits from serve-stale-on-error for free.
 *
 * Refreshes run sequentially with a short stagger so the synchronous SQLite
 * queries don't stall the event loop in one burst.
 */
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import { getLeaderboardResponse, WARM_WINDOWS, type LeaderboardRequest } from './leaderboard-cache';

const GLOBAL_KEY = '__destinyFarmFinderLeaderboardWarmer__';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function staggerMs(): number {
    const parsed = parseInt(process.env.WARMER_STAGGER_MS || '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
}

async function warmOne(req: LeaderboardRequest): Promise<void> {
    try {
        await getLeaderboardResponse(req);
    } catch (error) {
        // Maintenance / transient errors are expected; serve-stale-on-error keeps
        // the previous value live. Log lightly and move on.
        const label = req.raidKeys.length ? req.raidKeys.join(',') : 'all';
        console.warn(`[warmer] refresh failed (${req.mode} ${req.hours}h ${label}):`, (error as Error).message);
    }
    await sleep(staggerMs());
}

async function warmAll(): Promise<void> {
    const allKeys = Object.keys(getAllRaidDefinitions());
    for (const hours of WARM_WINDOWS) {
        await warmOne({ mode: 'aggregate', hours, raidKeys: [], limit: 100 });
        await warmOne({ mode: 'individual', hours, raidKeys: [], limit: 100 });
        for (const raidKey of allKeys) {
            await warmOne({ mode: 'individual', hours, raidKeys: [raidKey], limit: 100 });
        }
    }
}

/**
 * Start the warmer interval. Safe to call multiple times — a `globalThis`
 * singleton guard prevents stacking intervals across Next.js dev HMR re-evals.
 */
export function startLeaderboardWarmer(): void {
    if (process.env.WARMER_ENABLED === 'false') {
        return;
    }

    const g = globalThis as unknown as Record<string, NodeJS.Timeout | undefined>;
    if (g[GLOBAL_KEY]) {
        return;
    }

    const intervalRaw = parseInt(process.env.WARMER_INTERVAL_MS || '', 10);
    const intervalMs = Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : 420_000;

    const handle = setInterval(() => {
        void warmAll();
    }, intervalMs);
    if (typeof handle.unref === 'function') {
        handle.unref();
    }
    g[GLOBAL_KEY] = handle;

    // Warm shortly after startup so the cache is hot before traffic arrives,
    // but not synchronously during boot.
    setTimeout(() => {
        void warmAll();
    }, 5_000).unref?.();

    console.log(`[warmer] leaderboard warmer started (interval ${intervalMs}ms)`);
}
