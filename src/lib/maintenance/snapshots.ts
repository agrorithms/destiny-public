import { getAllRaidDefinitions } from '../bungie/manifest';
import { getDb } from '../db';
import { getSystemStats, type SystemStats } from '../system-stats';
import { readSnapshot, writeSnapshot } from './state';

export interface MaintenanceSnapshotEnvelope<T> {
    maintenanceSnapshot: true;
    snapshotGeneratedAt: number;
    data: T;
}

export interface LeaderboardSnapshot {
    mode: 'aggregate';
    hours: number;
    fullClearsOnly: boolean;
    raidKeys: string[];
    entries: Array<{
        membershipId: string;
        membershipType: number;
        displayName: string;
        completions: number;
    }>;
}

interface LeaderboardRow {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
    completions: number;
}

function formatDisplayName(entry: LeaderboardRow): string {
    if (entry.bungieGlobalDisplayName && entry.bungieGlobalDisplayNameCode) {
        return `${entry.bungieGlobalDisplayName}#${String(entry.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }
    return entry.bungieGlobalDisplayName || entry.displayName || entry.membershipId;
}

function buildEnvelope<T>(data: T): MaintenanceSnapshotEnvelope<T> {
    return {
        maintenanceSnapshot: true,
        snapshotGeneratedAt: Date.now(),
        data,
    };
}

function buildLeaderboardSnapshot(hours: number = 4, limit: number = 50): LeaderboardSnapshot {
    const db = getDb();
    const cutoff = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
    const allRaids = getAllRaidDefinitions();

    const rows = db.prepare(`
        SELECT
          pp.membership_id as membershipId,
          pp.membership_type as membershipType,
          COALESCE(pl.bungie_global_display_name, pp.display_name) as displayName,
          pl.bungie_global_display_name as bungieGlobalDisplayName,
          pl.bungie_global_display_name_code as bungieGlobalDisplayNameCode,
          COUNT(DISTINCT pp.instance_id) as completions
        FROM pgcr_players pp
        JOIN pgcrs p ON pp.instance_id = p.instance_id
        LEFT JOIN players pl ON pp.membership_id = pl.membership_id
        WHERE p.ended_at >= ?
          AND pp.completed = 1
          AND p.completed = 1
          AND p.activity_was_started_from_beginning = 1
        GROUP BY pp.membership_id
        HAVING completions > 0
        ORDER BY completions DESC
        LIMIT ?
    `).all(cutoff, limit) as LeaderboardRow[];

    return {
        mode: 'aggregate',
        hours,
        fullClearsOnly: true,
        raidKeys: Object.keys(allRaids),
        entries: rows.map((row) => ({
            membershipId: row.membershipId,
            membershipType: row.membershipType,
            displayName: formatDisplayName(row),
            completions: row.completions,
        })),
    };
}

export function generateMaintenanceSnapshots(): void {
    const status = getSystemStats();
    const adminStats = getSystemStats();
    const leaderboard = buildLeaderboardSnapshot();

    writeSnapshot('status', buildEnvelope(status));
    writeSnapshot('admin-stats', buildEnvelope(adminStats));
    writeSnapshot('leaderboard', buildEnvelope(leaderboard));
}

export function readStatusSnapshot(): MaintenanceSnapshotEnvelope<SystemStats> | null {
    return readSnapshot<MaintenanceSnapshotEnvelope<SystemStats>>('status');
}

export function readAdminStatsSnapshot(): MaintenanceSnapshotEnvelope<SystemStats> | null {
    return readSnapshot<MaintenanceSnapshotEnvelope<SystemStats>>('admin-stats');
}

export function readLeaderboardSnapshot(): MaintenanceSnapshotEnvelope<LeaderboardSnapshot> | null {
    return readSnapshot<MaintenanceSnapshotEnvelope<LeaderboardSnapshot>>('leaderboard');
}
