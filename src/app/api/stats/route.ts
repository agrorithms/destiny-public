import { NextResponse } from 'next/server';
import { getSystemStats } from '@/lib/system-stats';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { readAdminStatsSnapshot } from '@/lib/maintenance/snapshots';
import { getBungieMaintenanceStatus } from '@/lib/bungie/maintenance';
import { withNoStore } from '@/lib/http/cache';

export async function GET() {
    try {
        return withNoStore(NextResponse.json(getSystemStats()));
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            const snapshot = readAdminStatsSnapshot();
            const maintenance = getBungieMaintenanceStatus();

            return withNoStore(NextResponse.json({
                ...(snapshot?.data || {}),
                bungieMaintenanceActive: maintenance.active,
                bungieMaintenanceUntil: maintenance.until,
                bungieMaintenanceRemainingMs: maintenance.remainingMs,
                dbQuiesceActive: maintenance.dbQuiesceActive,
                cleanupStatus: maintenance.cleanupStatus,
                cleanupStartedAt: maintenance.cleanupStartedAt,
                cleanupFinishedAt: maintenance.cleanupFinishedAt,
                snapshotGeneratedAt: snapshot?.snapshotGeneratedAt ?? maintenance.snapshotGeneratedAt,
                lastVacuumCompletedAt: maintenance.lastVacuumCompletedAt,
                maintenanceSnapshot: true,
            }));
        }

        console.error('[ERROR] Stats query failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
