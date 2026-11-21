import { createRequestLimits, readNonNegativeInt, type RequestLimits } from './request-limits';

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
const COOLDOWN_MS = 120_000;

/** Reads `HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN` (default 60) once, when called. The cooldown is a fixed 120 seconds. */
export function createHistoryCrawlLimits(env: Record<string, string | undefined> = process.env): RequestLimits {
    return createRequestLimits(readNonNegativeInt(env.HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN, DEFAULT_GLOBAL_PER_MIN), COOLDOWN_MS);
}
