import { NextResponse } from 'next/server';
import { getSystemStats } from '@/lib/system-stats';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { readAdminStatsSnapshot } from '@/lib/maintenance/snapshots';
import { getBungieMaintenanceStatus } from '@/lib/bungie/maintenance';

export async function GET() {
    try {
        return NextResponse.json(getSystemStats());
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            const snapshot = readAdminStatsSnapshot();
            const maintenance = getBungieMaintenanceStatus();

            return NextResponse.json({
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
            });
        }

        console.error('[ERROR] Stats query failed:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
