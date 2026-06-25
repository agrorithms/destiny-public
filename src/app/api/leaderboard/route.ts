import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import { readLeaderboardSnapshot } from '@/lib/maintenance/snapshots';
import { withCache, withNoStore } from '@/lib/http/cache';
import { getLeaderboardResponse } from '@/lib/cache/leaderboard-cache';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    // Support comma-separated raid keys: ?raids=garden_of_salvation,salvations_edge,vow_of_the_disciple
    const raidsParam = searchParams.get('raids') || '';
    const hours = parseInt(searchParams.get('hours') || '4', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const mode = searchParams.get('mode') === 'individual' ? 'individual' : 'aggregate';
    // fullClearsOnly is forced true on the cache path (the only real UI path);
    // it is folded into the cache key as a constant rather than read here.

    const allRaids = getAllRaidDefinitions();
    const raidKeys = raidsParam
        ? raidsParam.split(',').filter((key) => allRaids[key])
        : [];

    if (hours < 1 || hours > 720) {
        return withNoStore(NextResponse.json(
            { error: 'hours must be between 1 and 720' },
            { status: 400 }
        ));
    }

    if (limit < 1 || limit > 500) {
        return withNoStore(NextResponse.json(
            { error: 'limit must be between 1 and 500' },
            { status: 400 }
        ));
    }

    try {
        const { body, state, band } = await getLeaderboardResponse({ mode, hours, raidKeys, limit });

        const response = withCache(NextResponse.json(body), band.sMaxAge, band.staleWhileRevalidate);
        response.headers.set('X-Cache', state.toUpperCase());
        return response;
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            const snapshot = readLeaderboardSnapshot();
            if (snapshot?.data) {
                return withNoStore(NextResponse.json({
                    ...snapshot.data,
                    maintenance: true,
                    snapshotGeneratedAt: snapshot.snapshotGeneratedAt,
                    requestedMode: mode,
                    requestedHours: hours,
                }));
            }
        }

        console.error('[ERROR] Leaderboard query failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
