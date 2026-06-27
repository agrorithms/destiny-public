import { NextResponse } from 'next/server';
import { getStatusStats } from '@/lib/system-stats';
import { getBungieMaintenanceStatus } from '@/lib/bungie/maintenance';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { readStatusSnapshot } from '@/lib/maintenance/snapshots';
import { withCache, withNoStore } from '@/lib/http/cache';

export async function GET() {
    try {
        const stats = getStatusStats();
        const stale = (stats.secondsSinceHeartbeat ?? 301) > 300; // 5 minutes

        const response = NextResponse.json(
            {
                crawlerRunning: stats.crawlerRunning,
                crawlerStatus: stats.crawlerStatus,
                secondsSinceHeartbeat: stats.secondsSinceHeartbeat,
                scannerRunning: stats.scanner?.isRunning ?? false,
                scannerStatus: stats.scanner ? 'available' : 'unknown',
                bungieMaintenanceActive: stats.bungieMaintenanceActive,
                bungieMaintenanceUntil: stats.bungieMaintenanceUntil,
                bungieMaintenanceRemainingMs: stats.bungieMaintenanceRemainingMs,
                isVacuuming: stats.isVacuuming,
                dbQuiesceActive: stats.dbQuiesceActive,
                cleanupStatus: stats.cleanupStatus,
                cleanupStartedAt: stats.cleanupStartedAt,
                cleanupFinishedAt: stats.cleanupFinishedAt,
                snapshotGeneratedAt: stats.snapshotGeneratedAt,
                lastVacuumCompletedAt: stats.lastVacuumCompletedAt,
                status: stale ? 'degraded' : 'ok',
                timestamp: Date.now()
            },
            { status: stale ? 503 : 200 }
        );

        return stale ? withNoStore(response) : withCache(response, 5, 15);
    } catch (error) {
        if (isDatabaseMaintenanceError(error)) {
            const maintenance = getBungieMaintenanceStatus();
            const snapshot = readStatusSnapshot();
            const stats = snapshot?.data;

            return withNoStore(NextResponse.json({
                crawlerRunning: stats?.crawlerRunning ?? false,
                crawlerStatus: stats?.crawlerStatus ?? 'maintenance',
                secondsSinceHeartbeat: stats?.secondsSinceHeartbeat ?? null,
                scannerRunning: stats?.scanner?.isRunning ?? false,
                scannerStatus: stats?.scanner ? 'snapshot' : 'maintenance',
                bungieMaintenanceActive: maintenance.active,
                bungieMaintenanceUntil: maintenance.until,
                bungieMaintenanceRemainingMs: maintenance.remainingMs,
                isVacuuming: maintenance.isVacuuming,
                dbQuiesceActive: maintenance.dbQuiesceActive,
                cleanupStatus: maintenance.cleanupStatus,
                cleanupStartedAt: maintenance.cleanupStartedAt,
                cleanupFinishedAt: maintenance.cleanupFinishedAt,
                snapshotGeneratedAt: snapshot?.snapshotGeneratedAt ?? maintenance.snapshotGeneratedAt,
                lastVacuumCompletedAt: maintenance.lastVacuumCompletedAt,
                maintenanceSnapshot: true,
                status: 'maintenance',
                timestamp: Date.now(),
            }));
        }

        console.error('[ERROR] Status query failed:', error);
        return withNoStore(NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        ));
    }
}
