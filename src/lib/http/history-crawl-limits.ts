import type { PlayerRef } from '@/lib/active-session/profile-viewed';
import { CooldownGate, FixedWindowLimiter } from './rate-limit';

/**
 * The two limits on history-crawl requests that sit in the web process (#9004): one limiter
 * across every caller, and a per-player cooldown. Neither is keyed on the caller's address. The
 * third limit, the queue-length cap, lives with the queue (`requestHistoryCrawl`).
 *
 * Kept apart from the poll request's limits, so a refusal of one kind never touches the other.
 * In memory and per process, like those: under PM2 cluster x2 the effective ceilings are up to
 * twice the knobs (ADR 0010).
 */

const DEFAULT_GLOBAL_PER_MIN = 60;
// The cooldown the retired history-crawl route used.
const COOLDOWN_MS = 120_000;

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface HistoryCrawlLimits {
    /** True when this player was accepted within the cooldown. Keyed on the membership id alone. */
    isCoolingDown(player: PlayerRef): boolean;
    /** Counts one enqueue attempt against the global limit; true when it is over the limit. */
    isOverGlobalLimit(): boolean;
    /** Starts the player's cooldown. Called only for an accepted request. */
    recordAccepted(player: PlayerRef): void;
}

/** Reads `HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN` (default 60) once, when called. */
export function createHistoryCrawlLimits(env: Record<string, string | undefined> = process.env): HistoryCrawlLimits {
    const perMinute = readNonNegativeInt(env.HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN, DEFAULT_GLOBAL_PER_MIN);
    const limiter = new FixedWindowLimiter(perMinute, 60_000);
    const cooldown = new CooldownGate(COOLDOWN_MS);
    return {
        isCoolingDown: (player) => cooldown.isCoolingDown(player.membershipId),
        // FixedWindowLimiter lets the first hit of a window through whatever the limit, so 0 needs its own answer.
        isOverGlobalLimit: () => perMinute === 0 || limiter.isRateLimited('global'),
        recordAccepted: (player) => cooldown.record(player.membershipId),
    };
}
