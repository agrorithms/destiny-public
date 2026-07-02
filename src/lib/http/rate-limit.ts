/**
 * In-memory rate-limit primitives for the client-write endpoints
 * (active-session-update, identity, queue-crawl). Expired entries are pruned on
 * access so the maps stay bounded without a timer — previously these routes kept
 * bare Maps that grew forever (one entry per IP:player key, never deleted).
 *
 * Per-process by design: under PM2 cluster mode each web worker keeps its own
 * state, so effective limits scale with the instance count. Same trade-off as
 * the middleware.ts rate limiter; acceptable because these are abuse dampeners,
 * not billing-grade quotas.
 */

const PRUNE_INTERVAL_MS = 60_000;

/** Per-key cooldown: at most one recorded hit per `cooldownMs` per key. */
export class CooldownGate {
    private hits = new Map<string, number>();
    private lastPruneAt = 0;

    constructor(private cooldownMs: number) {}

    /** True when the key was recorded within the cooldown window (caller should skip). */
    isCoolingDown(key: string): boolean {
        const now = Date.now();
        this.prune(now);
        const last = this.hits.get(key);
        return last !== undefined && now - last < this.cooldownMs;
    }

    record(key: string): void {
        this.hits.set(key, Date.now());
    }

    private prune(now: number): void {
        if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
        this.lastPruneAt = now;
        for (const [key, at] of this.hits) {
            if (now - at >= this.cooldownMs) this.hits.delete(key);
        }
    }
}

/** Fixed window counter: allows `limit` hits per `windowMs` per key. */
export class FixedWindowLimiter {
    private windows = new Map<string, { windowStart: number; count: number }>();
    private lastPruneAt = 0;

    constructor(private limit: number, private windowMs: number) {}

    /** Counts the hit and returns true when the key has exceeded the window's limit. */
    isRateLimited(key: string): boolean {
        const now = Date.now();
        this.prune(now);
        const entry = this.windows.get(key);
        if (!entry || now - entry.windowStart >= this.windowMs) {
            this.windows.set(key, { windowStart: now, count: 1 });
            return false;
        }
        entry.count += 1;
        return entry.count > this.limit;
    }

    private prune(now: number): void {
        if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
        this.lastPruneAt = now;
        for (const [key, entry] of this.windows) {
            if (now - entry.windowStart >= this.windowMs) this.windows.delete(key);
        }
    }
}
