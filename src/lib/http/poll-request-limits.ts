import { createRequestLimits, readNonNegativeInt, type RequestLimits } from './request-limits';

/**
 * The two limits on poll requests that sit in the web process: one limiter across every caller,
 * and a per-player cooldown (request-limits.ts has what they share, and the per-process caveat:
 * up to twice the knobs under PM2 cluster x2). The third limit, the queue-length cap, lives with
 * the queue (`requestSessionPoll`) and is enforced in SQLite, so it holds across processes.
 */

const DEFAULT_GLOBAL_PER_MIN = 60;
const DEFAULT_COOLDOWN_SEC = 300;

/**
 * Reads `ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN` (default 60) and
 * `ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC` (default 300, the stale re-verify's age and longer
 * than the roughly two-minute poll cycle) once, when called.
 */
export function createPollRequestLimits(env: Record<string, string | undefined> = process.env): RequestLimits {
    return createRequestLimits(
        readNonNegativeInt(env.ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN, DEFAULT_GLOBAL_PER_MIN),
        readNonNegativeInt(env.ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC, DEFAULT_COOLDOWN_SEC) * 1000,
    );
}
