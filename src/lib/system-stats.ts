import { getDbStats, getCrawlerStatus } from '@/lib/db/queries';
import { getDb } from '@/lib/db';
import { getBungieMaintenanceStatus } from '@/lib/bungie/maintenance';

export interface ScannerStats {
    isRunning: boolean;
    currentInstanceId: string;
    totalScanned: number;
    totalRaidsFound: number;
    raidHitRate: string;
    uptimeSeconds: number;
    secondsSinceUpdate: number;
}

export interface SystemStats {
    crawlerRunning: boolean;
    crawlerStatus: string;
    lastHeartbeat: string | null;
    secondsSinceHeartbeat: number | null;
    bungieMaintenanceActive: boolean;
    bungieMaintenanceUntil: number | null;
    bungieMaintenanceRemainingMs: number;
    scanner: ScannerStats | null;
    database: {
        totalPlayers: number;
        totalPGCRs: number;
        totalPGCRPlayers: number;
        activeSessions: number;
        oldestPGCR: string | null;
        newestPGCR: string | null;
    };
}

export function getSystemStats(): SystemStats {
    const databaseStats = getDbStats();
    const crawlerStatus = getCrawlerStatus();
    const bungieMaintenance = getBungieMaintenanceStatus();

    const db = getDb();
    const scannerStatsRow = db.prepare(
        "SELECT value, updated_at FROM crawler_state WHERE key = 'scanner_stats'"
    ).get() as { value: string; updated_at: number } | undefined;

    let scannerStats: ScannerStats | null = null;
    if (scannerStatsRow) {
        try {
            const parsed = JSON.parse(scannerStatsRow.value) as Omit<ScannerStats, 'isRunning' | 'secondsSinceUpdate'>;
            const secondsSinceUpdate = Math.floor(Date.now() / 1000) - scannerStatsRow.updated_at;
            scannerStats = {
                ...parsed,
                isRunning: secondsSinceUpdate < 60,
                secondsSinceUpdate,
            };
        } catch {
            scannerStats = null;
        }
    }

    return {
        crawlerRunning: crawlerStatus.isRunning,
        crawlerStatus: crawlerStatus.status,
        lastHeartbeat: crawlerStatus.lastHeartbeat,
        secondsSinceHeartbeat: crawlerStatus.secondsSinceHeartbeat,
        bungieMaintenanceActive: bungieMaintenance.active,
        bungieMaintenanceUntil: bungieMaintenance.until,
        bungieMaintenanceRemainingMs: bungieMaintenance.remainingMs,
        scanner: scannerStats,
        database: databaseStats,
    };
}
