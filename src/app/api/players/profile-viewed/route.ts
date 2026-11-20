import { NextRequest, NextResponse } from 'next/server';
import type { PlayerRef } from '@/lib/active-session/profile-viewed';
import { isMembershipId } from '@/lib/active-session/roster';
import { VALID_MEMBERSHIP_TYPES } from '@/lib/bungie/search-mapping';
import { requestHistoryCrawl, requestSessionPoll } from '@/lib/db/queries';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { withNoStore } from '@/lib/http/cache';
import { createHistoryCrawlLimits } from '@/lib/http/history-crawl-limits';
import { createPollRequestLimits, type RequestLimits } from '@/lib/http/poll-request-limits';
import { isTrustedClientWrite } from '@/lib/http/request-auth';

// Each kind of request has one global limiter and a per-player cooldown, neither keyed on the
// caller's address, so a refusal of one never touches the other. The queue-length caps are
// enforced by requestSessionPoll and requestHistoryCrawl. See poll-request-limits.ts for the
// per-process (2x under PM2 cluster x2) caveat.
const limits = createPollRequestLimits();
const historyLimits = createHistoryCrawlLimits();

function parsePlayer(value: unknown): PlayerRef | null {
    // Anything that is not an object has no ids to read, and fails the checks below.
    const { membershipId, membershipType } = (value ?? {}) as Record<string, unknown>;
    if (typeof membershipId !== 'string') return null;
    // A JSON number only, as the page sends: coercing would let `true`, `[3]` or "1e0" pass as a type.
    if (typeof membershipType !== 'number') return null;
    const id = membershipId.trim();
    if (!isMembershipId(id) || !VALID_MEMBERSHIP_TYPES.has(membershipType)) return null;
    return { membershipId: id, membershipType };
}

interface Refusal {
    reason: string;
    status: number;
}

/**
 * One ask of one kind: the cooldown, then the global limit, then the queue. Answers null when
 * the ask was accepted, or why it was refused: a 429 for the global limit or a full queue, a 200
 * for the cooldown or `declinedReason` (the queue's own decline).
 */
function ask(
    kindLimits: RequestLimits,
    player: PlayerRef,
    enqueue: (membershipId: string, membershipType: number) => string,
    declinedReason: string,
): Refusal | null {
    if (kindLimits.isCoolingDown(player)) return { reason: 'recently_refreshed', status: 200 };
    if (kindLimits.isOverGlobalLimit()) return { reason: 'rate_limited', status: 429 };
    const result = enqueue(player.membershipId, player.membershipType);
    if (result === 'accepted') {
        kindLimits.recordAccepted(player);
        return null;
    }
    if (result === 'queue_full') return { reason: 'queue_full', status: 429 };
    return { reason: declinedReason, status: 200 };
}

/** A 429 replaces any earlier refusal; a 200 refusal is kept only when nothing came before it. */
function worse(earlier: Refusal | null, next: Refusal): Refusal {
    return next.status === 429 ? next : (earlier ?? next);
}

function json(body: Record<string, unknown>, status = 200): NextResponse {
    return withNoStore(NextResponse.json(body, { status }));
}

/**
 * "Profile viewed": the one request a profile view sends. It asks the crawler to poll the viewed
 * player and, when the raid was read from a teammate, that one teammate (`poll`, default true);
 * and to crawl the viewed player's raid history, never the teammate's (`history`, default true).
 * Ids and those two flags only (ADR 0010): any other field in the body is ignored, and the route
 * writes no session row and no player row. The two queues stay separate, each with its own
 * limits, so a refusal of one kind leaves the other as it was.
 */
export async function POST(request: NextRequest) {
    if (!isTrustedClientWrite(request)) {
        return json({ error: 'Forbidden' }, 403);
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const viewed = parsePlayer(body);
    if (!viewed) return json({ error: 'Invalid membershipId or membershipType' }, 400);

    // A flag that is present must be a boolean, and at least one kind must be asked for.
    const flags: Record<'poll' | 'history', boolean> = { poll: true, history: true };
    for (const name of ['poll', 'history'] as const) {
        const value = body[name];
        if (value === undefined) continue;
        if (typeof value !== 'boolean') return json({ error: `Invalid ${name}` }, 400);
        flags[name] = value;
    }
    if (!flags.poll && !flags.history) return json({ error: 'Nothing to ask for' }, 400);

    // At most one teammate. An array under either name is a body naming several.
    const teammates = body.teammates;
    if (Array.isArray(teammates) && teammates.length > 1) {
        return json({ error: 'At most one teammate' }, 400);
    }
    let teammate: PlayerRef | null = null;
    if (body.teammate !== undefined && body.teammate !== null) {
        teammate = parsePlayer(body.teammate);
        if (!teammate) return json({ error: 'Invalid teammate' }, 400);
    }

    // A teammate who is the viewed player is harmless: the cooldown the first one starts skips the
    // second, whatever type each was sent under.
    const polled = flags.poll ? (teammate ? [viewed, teammate] : [viewed]) : [];

    let accepted = 0;
    let refusal: Refusal | null = null;
    try {
        for (const player of polled) {
            const refused = ask(limits, player, requestSessionPoll, 'privacy_backoff');
            if (!refused) {
                accepted += 1;
                continue;
            }
            refusal = worse(refusal, refused);
            // A 429 stops the poll asks only: the history ask has its own limits.
            if (refused.status === 429) break;
        }

        if (flags.history) {
            const refused = ask(historyLimits, viewed, requestHistoryCrawl, 'backing_off');
            if (refused) refusal = worse(refusal, refused);
            else accepted += 1;
        }
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return json({ queued: false, reason: 'maintenance' }, 503);
        }
        console.error('[ERROR] profile-viewed failed:', error);
        return json({ error: 'Internal server error' }, 500);
    }

    if (accepted > 0) return json({ queued: true }, 202);
    // refusal is always set when nothing was accepted: every ask either queued or was refused.
    return json({ queued: false, reason: refusal!.reason }, refusal!.status);
}
