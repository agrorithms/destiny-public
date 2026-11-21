import type { PlayerRef } from '@/lib/active-session/profile-viewed';
import { CooldownGate, FixedWindowLimiter } from './rate-limit';

/**
 * The web-process limits shared by each kind of profile-view request: one limiter across every
 * caller, and a per-player cooldown. Neither is keyed on the caller's address, so rotating
 * addresses lifts neither. Each kind builds its own (poll-request-limits.ts,
 * history-crawl-limits.ts), so a refusal of one kind never touches the other; the queue-length
 * caps live with the queues.
 *
 * In memory and per process, like the other client-write limiters: under PM2 cluster x2 each web
 * process keeps its own count, so the effective ceilings are up to twice the knobs, and a player
 * may be accepted once per process inside the cooldown. Abuse dampeners, not quotas (ADR 0010).
 */

export function readNonNegativeInt(raw: string | undefined, fallback: number): number {
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** The web-process limits on one kind of profile-view request. */
export interface RequestLimits {
    /**
     * True when this player was accepted within the cooldown: the request should enqueue nothing.
     * Keyed on the membership id alone, as the queue and the privacy backoff are, so the same id
     * sent under another membership type is the same player.
     */
    isCoolingDown(player: PlayerRef): boolean;
    /** Counts one enqueue attempt against the global limit; true when it is over the limit. */
    isOverGlobalLimit(): boolean;
    /** Starts the player's cooldown. Called only for an accepted request. */
    recordAccepted(player: PlayerRef): void;
}

/**
 * One global limiter (`perMinute` attempts a minute, 0 refusing all) and a per-player cooldown
 * of `cooldownMs`, keyed on the membership id. Each kind of request builds its own.
 */
export function createRequestLimits(perMinute: number, cooldownMs: number): RequestLimits {
    const limiter = new FixedWindowLimiter(perMinute, 60_000);
    const cooldown = new CooldownGate(cooldownMs);
    return {
        isCoolingDown: (player) => cooldown.isCoolingDown(player.membershipId),
        // FixedWindowLimiter lets the first hit of a window through whatever the limit, so 0 needs its own answer.
        isOverGlobalLimit: () => perMinute === 0 || limiter.isRateLimited('global'),
        recordAccepted: (player) => cooldown.record(player.membershipId),
    };
}
