import { NextRequest, NextResponse } from 'next/server';
import { enqueueCrawl } from '@/lib/db/queries';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { withNoStore } from '@/lib/http/cache';
import { getClientIp } from '@/lib/http/request-ip';
import { isTrustedClientWrite } from '@/lib/http/request-auth';

const validMembershipTypes = new Set([1, 2, 3, 5, 6]);

// Per-player cooldown: don't re-enqueue the same player more than once per 2 minutes.
const PLAYER_COOLDOWN_MS = 120_000;
const recentEnqueue = new Map<string, number>();

// Per-IP fixed window: at most 10 queue requests per minute per IP.
const IP_WINDOW_MS = 60_000;
const IP_MAX_PER_WINDOW = 10;
const ipWindow = new Map<string, { windowStart: number; count: number }>();

function ipRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = ipWindow.get(ip);
    if (!entry || now - entry.windowStart >= IP_WINDOW_MS) {
        ipWindow.set(ip, { windowStart: now, count: 1 });
        return false;
    }
    entry.count += 1;
    return entry.count > IP_MAX_PER_WINDOW;
}

interface QueueCrawlBody {
    membershipId?: unknown;
    membershipType?: unknown;
    displayName?: unknown;
}

export async function POST(request: NextRequest) {
    if (!isTrustedClientWrite(request)) {
        return withNoStore(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }

    let body: QueueCrawlBody;
    try {
        body = await request.json();
    } catch {
        return withNoStore(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }));
    }

    const membershipId = typeof body.membershipId === 'string' ? body.membershipId.trim() : '';
    const membershipType = Number(body.membershipType);
    const displayName = typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : null;

    if (!/^\d{1,20}$/.test(membershipId)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membershipId' }, { status: 400 }));
    }
    if (!validMembershipTypes.has(membershipType)) {
        return withNoStore(NextResponse.json({ error: 'Invalid membershipType' }, { status: 400 }));
    }

    const ip = getClientIp(request);
    if (ipRateLimited(ip)) {
        return withNoStore(NextResponse.json(
            { queued: false, reason: 'rate_limited' },
            { status: 429 }
        ));
    }

    const key = `${membershipType}:${membershipId}`;
    const now = Date.now();
    const last = recentEnqueue.get(key);
    if (last !== undefined && now - last < PLAYER_COOLDOWN_MS) {
        return withNoStore(NextResponse.json({ queued: false, reason: 'recently_refreshed' }));
    }

    try {
        enqueueCrawl([{ membershipId, membershipType, displayName }], 'profile-view');
        recentEnqueue.set(key, now);
        return withNoStore(NextResponse.json({ queued: true }, { status: 202 }));
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return withNoStore(NextResponse.json(
                { queued: false, reason: 'maintenance' },
                { status: 503 }
            ));
        }
        console.error('[ERROR] queue-crawl failed:', error);
        return withNoStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
    }
}
