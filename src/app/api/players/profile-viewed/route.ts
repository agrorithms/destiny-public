import { NextRequest, NextResponse } from 'next/server';
import type { PlayerRef } from '@/lib/active-session/profile-viewed';
import { isMembershipId } from '@/lib/active-session/roster';
import { VALID_MEMBERSHIP_TYPES } from '@/lib/bungie/search-mapping';
import { requestSessionPoll } from '@/lib/db/queries';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { withNoStore } from '@/lib/http/cache';
import { createPollRequestLimits } from '@/lib/http/poll-request-limits';
import { isTrustedClientWrite } from '@/lib/http/request-auth';

// One global limiter and a per-player cooldown, neither keyed on the caller's address. The
// queue-length cap is enforced by requestSessionPoll. See poll-request-limits.ts for the
// per-process (2x under PM2 cluster x2) caveat.
const limits = createPollRequestLimits();

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

function json(body: Record<string, unknown>, status = 200): NextResponse {
    return withNoStore(NextResponse.json(body, { status }));
}

/**
 * "Profile viewed": the profile page asks the crawler to poll the viewed player and, when the
 * raid was read from a teammate, that one teammate. Ids only (ADR 0010): any other field in the
 * body is ignored, and the route writes no session row and no player row. What it does is
 * `requestSessionPoll`, which marks a listed session for re-verify or queues the player; the
 * crawler does the looking on its next cycle.
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
    const players = teammate ? [viewed, teammate] : [viewed];

    let accepted = 0;
    let refusal: { reason: string; status: number } | null = null;
    try {
        for (const player of players) {
            if (limits.isCoolingDown(player)) {
                refusal ??= { reason: 'recently_refreshed', status: 200 };
                continue;
            }
            if (limits.isOverGlobalLimit()) {
                refusal = { reason: 'rate_limited', status: 429 };
                break;
            }
            const result = requestSessionPoll(player.membershipId, player.membershipType);
            if (result === 'accepted') {
                limits.recordAccepted(player);
                accepted += 1;
            } else if (result === 'queue_full') {
                refusal = { reason: 'queue_full', status: 429 };
                break;
            } else {
                refusal ??= { reason: 'privacy_backoff', status: 200 };
            }
        }
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return json({ queued: false, reason: 'maintenance' }, 503);
        }
        console.error('[ERROR] profile-viewed failed:', error);
        return json({ error: 'Internal server error' }, 500);
    }

    if (accepted > 0) return json({ queued: true }, 202);
    // refusal is always set when nothing was accepted: every player either queued or was refused.
    return json({ queued: false, reason: refusal!.reason }, refusal!.status);
}
