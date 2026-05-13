import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.RAID_TRACKER_DATA_DIR
    ? path.resolve(process.env.RAID_TRACKER_DATA_DIR)
    : process.env.RAID_TRACKER_DB_PATH
        ? path.dirname(path.resolve(process.env.RAID_TRACKER_DB_PATH))
        : path.join(process.cwd(), 'data');
const STATE_PATH = path.join(DATA_DIR, 'maintenance-state.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'maintenance-snapshots');
const CLEANUP_LEASE_PATH = path.join(DATA_DIR, 'maintenance-cleanup.lease');
const CURRENT_VERSION = 1;

export type MaintenanceCleanupStatus =
    | 'idle'
    | 'pending'
    | 'snapshotting'
    | 'quiescing'
    | 'running'
    | 'succeeded'
    | 'failed';

export interface MaintenanceState {
    version: number;
    bungieMaintenanceActive: boolean;
    bungieMaintenanceUntil: number | null;
    maintenanceEventStartedAt: number | null;
    cleanupEligibleAt: number | null;
    dbQuiesceActive: boolean;
    cleanupStatus: MaintenanceCleanupStatus;
    cleanupStartedAt: number | null;
    cleanupFinishedAt: number | null;
    cleanupError: string | null;
    lastVacuumCompletedAt: number | null;
    lastCleanupAttemptedEventId: string | null;
    lastCleanupEventId: string | null;
    snapshotGeneratedAt: number | null;
}

function getDefaultState(): MaintenanceState {
    return {
        version: CURRENT_VERSION,
        bungieMaintenanceActive: false,
        bungieMaintenanceUntil: null,
        maintenanceEventStartedAt: null,
        cleanupEligibleAt: null,
        dbQuiesceActive: false,
        cleanupStatus: 'idle',
        cleanupStartedAt: null,
        cleanupFinishedAt: null,
        cleanupError: null,
        lastVacuumCompletedAt: null,
        lastCleanupAttemptedEventId: null,
        lastCleanupEventId: null,
        snapshotGeneratedAt: null,
    };
}

function ensureDataDir(): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeJsonAtomic(targetPath: string, value: unknown): void {
    ensureDataDir();
    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, targetPath);
}

export function getSnapshotDir(): string {
    ensureDataDir();
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    return SNAPSHOT_DIR;
}

export function getSnapshotPath(name: string): string {
    return path.join(getSnapshotDir(), `${name}.json`);
}

export function readMaintenanceState(): MaintenanceState {
    ensureDataDir();

    if (!fs.existsSync(STATE_PATH)) {
        return getDefaultState();
    }

    try {
        const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as Partial<MaintenanceState>;
        return {
            ...getDefaultState(),
            ...raw,
            version: CURRENT_VERSION,
        };
    } catch {
        return getDefaultState();
    }
}

export function writeMaintenanceState(state: MaintenanceState): void {
    writeJsonAtomic(STATE_PATH, state);
}

export function updateMaintenanceState(
    updater: (state: MaintenanceState) => MaintenanceState
): MaintenanceState {
    const next = updater(readMaintenanceState());
    writeMaintenanceState(next);
    return next;
}

export function isDbQuiesceActive(): boolean {
    return readMaintenanceState().dbQuiesceActive === true;
}

export function tryAcquireCleanupLease(owner: string): boolean {
    ensureDataDir();
    try {
        fs.writeFileSync(CLEANUP_LEASE_PATH, JSON.stringify({ owner, acquiredAt: Date.now() }), {
            flag: 'wx',
        });
        return true;
    } catch {
        return false;
    }
}

export function releaseCleanupLease(owner: string): void {
    try {
        if (!fs.existsSync(CLEANUP_LEASE_PATH)) {
            return;
        }

        const raw = JSON.parse(fs.readFileSync(CLEANUP_LEASE_PATH, 'utf8')) as {
            owner?: string;
        };

        if (!raw.owner || raw.owner === owner) {
            fs.unlinkSync(CLEANUP_LEASE_PATH);
        }
    } catch {
        // Ignore stale lease cleanup failures; a future cleanup run can overwrite state after restart.
    }
}

export function hasActiveCleanupLease(): boolean {
    return fs.existsSync(CLEANUP_LEASE_PATH);
}

export function readSnapshot<T>(name: string): T | null {
    try {
        const snapshotPath = getSnapshotPath(name);
        if (!fs.existsSync(snapshotPath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as T;
    } catch {
        return null;
    }
}

export function writeSnapshot(name: string, value: unknown): void {
    writeJsonAtomic(getSnapshotPath(name), value);
}
