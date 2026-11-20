import { NextRequest, NextResponse } from 'next/server';
import { MAX_NAME_LOOKUP_IDS } from '@/lib/active-session/live-profile';
import { isMembershipId } from '@/lib/active-session/roster';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { formatBungieDisplayName, getPlayerIdentities } from '@/lib/db/queries';
import { withNoStore } from '@/lib/http/cache';

/**
 * Names for the Roster members the Tracker already knows (#9001). The profile page renders a
 * live Fireteam from the viewer's own Bungie response, and asks here for the `Name#Code` and
 * membership type of the members it can link. Read-only: ids in, known identities out. A member
 * the Tracker does not know is left out, and the browser names that one itself, on screen only.
 */

export async function GET(request: NextRequest) {
    const param = request.nextUrl.searchParams.get('ids');
    if (param === null) {
        return withNoStore(NextResponse.json({ error: 'Invalid ids' }, { status: 400 }));
    }
    const ids = param.split(',');

    if (ids.length > MAX_NAME_LOOKUP_IDS) {
        return withNoStore(NextResponse.json({ error: 'Too many ids' }, { status: 400 }));
    }
    if (!ids.every(isMembershipId)) {
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
        // Anything else is a real fault: Next answers 500 and logs it.
        throw error;
    }
}
