import { NextRequest, NextResponse } from 'next/server';
import { upsertPlayerFillOnly } from '@/lib/db/queries';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { withNoStore } from '@/lib/http/cache';
import { getClientIp } from '@/lib/http/request-ip';
import { isTrustedClientWrite } from '@/lib/http/request-auth';
import { CooldownGate } from '@/lib/http/rate-limit';

const validMembershipTypes = new Set([1, 2, 3, 5, 6]);

// Per-IP + per-player cooldown: at most one identity write per player per 30s from a given IP.
const writeCooldown = new CooldownGate(30_000);

interface IdentityBody {
    membershipId?: unknown;
    membershipType?: unknown;
    bungieGlobalDisplayName?: unknown;
    bungieGlobalDisplayNameCode?: unknown;
}

// The browser resolves an unknown fireteam member via GetLinkedProfiles (public key) and POSTs
// the resolved identity here so the member's card shows Name#Code instead of a raw membership id.
// The server makes NO Bungie call — it validates and fill-only upserts: names are written only
// for players the DB doesn't already know, so a forged request can't rename an existing player
// (the crawler stays authoritative and corrects names on the next crawl). Spoofing is further
// bounded by the request-authenticity guard (same-origin + page token) and the per-IP/player
// cooldown.
export async function POST(request: NextRequest) {
    if (!isTrustedClientWrite(request)) {
        return withNoStore(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }

    let body: IdentityBody;
    try {
        body = await request.json();
    } catch {
        return withNoStore(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }));
    }

    const membershipId = typeof body.membershipId === 'string' ? body.membershipId.trim() : '';
    const membershipType = Number(body.membershipType);
    const bungieGlobalDisplayName =
        typeof body.bungieGlobalDisplayName === 'string' && body.bungieGlobalDisplayName.trim()
            ? body.bungieGlobalDisplayName.trim()
            : null;
    const codeRaw = Number(body.bungieGlobalDisplayNameCode);
    const bungieGlobalDisplayNameCode =
        Number.isInteger(codeRaw) && codeRaw >= 0 && codeRaw <= 9999 ? codeRaw : null;

    if (!/^\d{1,20}$/.test(membershipId)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membershipId' }, { status: 400 }));
    }
    if (!validMembershipTypes.has(membershipType)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membershipType' }, { status: 400 }));
    }
    // A name is the whole point of this endpoint — reject empty writes.
    if (!bungieGlobalDisplayName) {
        return withNoStore(NextResponse.json({ error: 'Missing bungieGlobalDisplayName' }, { status: 400 }));
    }

    const ip = getClientIp(request);
    const rateKey = `${ip}:${membershipType}:${membershipId}`;
    if (writeCooldown.isCoolingDown(rateKey)) {
        return withNoStore(NextResponse.json({ stored: false, reason: 'recently_updated' }));
    }
    writeCooldown.record(rateKey);

    try {
        upsertPlayerFillOnly({
            membershipId,
            membershipType,
            displayName: bungieGlobalDisplayName,
            bungieGlobalDisplayName,
            bungieGlobalDisplayNameCode: bungieGlobalDisplayNameCode ?? undefined,
        });
        return withNoStore(NextResponse.json({ stored: true }));
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return withNoStore(NextResponse.json({ stored: false, reason: 'maintenance' }, { status: 503 }));
        }
        console.error('[ERROR] identity upsert failed:', error);
        return withNoStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
    }
}
