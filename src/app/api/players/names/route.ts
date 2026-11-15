import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { formatBungieDisplayName, getPlayerIdentities } from '@/lib/db/queries';
import { withNoStore } from '@/lib/http/cache';

/**
 * Names for the Roster members the Tracker already knows (#9001). The profile page renders a
 * live Fireteam from the viewer's own Bungie response, and asks here for the `Name#Code` and
 * membership type of the members it can link. Read-only: ids in, known identities out. A member
 * the Tracker does not know is left out, and the browser names that one itself, on screen only.
 */

/** A Fireteam's Roster is at most six; twelve leaves room without making this a bulk export. */
const MAX_IDS = 12;
const MEMBERSHIP_ID = /^\d{1,20}$/;

export async function GET(request: NextRequest) {
    const ids = (request.nextUrl.searchParams.get('ids') ?? '').split(',');

    if (ids.length > MAX_IDS) {
        return withNoStore(NextResponse.json({ error: 'Too many ids' }, { status: 400 }));
    }
    if (!ids.every((id) => MEMBERSHIP_ID.test(id))) {
        return withNoStore(NextResponse.json({ error: 'Invalid ids' }, { status: 400 }));
    }

    try {
        const byId = new Map(getPlayerIdentities(ids).map((identity) => [identity.membershipId, identity]));
        const players = [...new Set(ids)].flatMap((id) => {
            const identity = byId.get(id);
            return identity
                ? [{ membershipId: id, membershipType: identity.membershipType, displayName: formatBungieDisplayName(identity) }]
                : [];
        });
        return withNoStore(NextResponse.json({ players }));
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            return withNoStore(NextResponse.json({ maintenance: true, players: [] }));
        }
        console.error('[ERROR] Player names lookup failed:', error);
        return withNoStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
    }
}
