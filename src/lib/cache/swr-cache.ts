/**
 * Generic in-process stale-while-revalidate cache with single-flight,
 * serve-stale-on-error and short negative caching.
 *
 * Built generic (not leaderboard-specific) so other endpoints can adopt it.
 * The store lives on `globalThis` so it survives Next.js dev HMR module
 * re-evaluation and is shared across Next's per-entrypoint module copies
 * within one process. Under PM2 cluster mode each web worker is its own
 * process with its own independent store — cache warmth is per-worker.
 *
 * Note: `compute` may be synchronous (e.g. better-sqlite3). When it runs it
 * still blocks the event loop for its duration — the value here is that the
 * heavy compute runs at most once per stale-interval per key and never while a
 * specific user awaits (stale/warmed paths run it in the background).
 */

export interface SwrOptions {
    freshMs: number;
    staleMs: number;
    /** How long to suppress re-running a failing compute. 0 / undefined disables. */
    negativeMs?: number;
}

export type CacheState = 'hit' | 'stale' | 'stale-error' | 'miss' | 'negative';

interface Entry<T> {
    value: T;
    storedAt: number;
}

interface NegativeMarker {
    error: unknown;
    failedAt: number;
}

interface Store {
    values: Map<string, Entry<unknown>>;
    inflight: Map<string, Promise<unknown>>;
    negatives: Map<string, NegativeMarker>;
}

const GLOBAL_KEY = '__destinyFarmFinderSwrCache__';
const MAX_ENTRIES = 500;

function getStore(): Store {
    const g = globalThis as unknown as Record<string, Store | undefined>;
    if (!g[GLOBAL_KEY]) {
        g[GLOBAL_KEY] = {
            values: new Map(),
            inflight: new Map(),
            negatives: new Map(),
        };
    }
    return g[GLOBAL_KEY]!;
}

function storeValue<T>(store: Store, key: string, value: T): void {
    store.values.set(key, { value, storedAt: Date.now() });
    store.negatives.delete(key);
    evictIfNeeded(store);
}

/** Simple bounded eviction. The canonical key set is small (~120); this only
 *  guards against unbounded growth if arbitrary keys ever get cached. */
function evictIfNeeded(store: Store): void {
    if (store.values.size <= MAX_ENTRIES) {
        return;
    }
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [k, entry] of store.values) {
        if (entry.storedAt < oldestAt) {
            oldestAt = entry.storedAt;
            oldestKey = k;
        }
    }
    if (oldestKey !== undefined) {
        store.values.delete(oldestKey);
    }
}

/**
 * Schedule a single-flight background refresh that runs after the current
 * response is flushed (`setImmediate`). On success it updates the value; on
 * failure it keeps the existing (stale) value and records a negative marker
 * so the key isn't hammered while it's failing (serve-stale-on-error).
 */
function scheduleRefresh<T>(key: string, compute: () => T | Promise<T>): void {
    const store = getStore();
    if (store.inflight.has(key)) {
        return; // single-flight: a refresh for this key is already scheduled/running
    }
    const promise = new Promise<void>((resolve) => {
        setImmediate(async () => {
            try {
                const value = await compute();
                storeValue(store, key, value);
            } catch (error) {
                store.negatives.set(key, { error, failedAt: Date.now() });
            } finally {
                store.inflight.delete(key);
                resolve();
            }
        });
    });
    store.inflight.set(key, promise);
}

/**
 * Blocking compute for the miss path, deduped via single-flight. If a refresh
 * is already in flight for this key, await it and reuse whatever value it
 * produced instead of running a second synchronous query.
 */
async function computeBlocking<T>(key: string, compute: () => T | Promise<T>): Promise<T> {
    const store = getStore();

    const existing = store.inflight.get(key) as Promise<unknown> | undefined;
    if (existing) {
        await existing.catch(() => undefined);
        const refreshed = store.values.get(key) as Entry<T> | undefined;
        if (refreshed) {
            return refreshed.value;
        }
        // The in-flight refresh failed and left no value; fall through and compute.
    }

    const promise = (async () => compute())();
    store.inflight.set(key, promise);
    try {
        const value = await promise;
        storeValue(store, key, value);
        return value;
    } catch (error) {
        store.negatives.set(key, { error, failedAt: Date.now() });
        throw error;
    } finally {
        store.inflight.delete(key);
    }
}

export async function getOrCompute<T>(
    key: string,
    opts: SwrOptions,
    compute: () => T | Promise<T>,
): Promise<{ value: T; state: CacheState }> {
    const store = getStore();
    const now = Date.now();
    const entry = store.values.get(key) as Entry<T> | undefined;
    const age = entry ? now - entry.storedAt : Infinity;

    // 1. Fresh
    if (entry && age <= opts.freshMs) {
        return { value: entry.value, state: 'hit' };
    }

    // 2. Stale — serve now, refresh in the background (single-flight)
    if (entry && age <= opts.staleMs) {
        scheduleRefresh(key, compute);
        const failing = store.negatives.has(key);
        return { value: entry.value, state: failing ? 'stale-error' : 'stale' };
    }

    // 3. Miss (no value, or older than the stale window)
    const negative = store.negatives.get(key);
    const negativeMs = opts.negativeMs ?? 0;
    if (negative && now - negative.failedAt <= negativeMs) {
        // Skip the (likely still-failing, blocking) compute and re-throw the
        // original error so callers' existing error handling kicks in.
        throw negative.error;
    }

    const value = await computeBlocking(key, compute);
    return { value, state: 'miss' };
}

/** Test-only: clear the entire cache store. */
export function __resetSwrCacheForTests(): void {
    const store = getStore();
    store.values.clear();
    store.inflight.clear();
    store.negatives.clear();
}
