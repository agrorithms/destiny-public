import { BungieAPIError } from './client';
import { closeDb, openMaintenanceDb } from '../db';
import {
    MaintenanceCleanupStatus,
    readMaintenanceState,
    releaseCleanupLease,
    tryAcquireCleanupLease,
    updateMaintenanceState,
} from '../maintenance/state';
import { generateMaintenanceSnapshots } from '../maintenance/snapshots';

const DEFAULT_MAINTENANCE_PAUSE_MS = 300000;
const CLEANUP_DELAY_MS = 300000;
const CLEANUP_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const QUIESCE_GRACE_MS = 3000;
const CLEANUP_RETRY_WINDOW_MS = 30000;

export interface BungieMaintenanceStatus {
    active: boolean;
    until: number | null;
    remainingMs: number;
    isVacuuming: boolean;
    dbQuiesceActive: boolean;
    cleanupStatus: MaintenanceCleanupStatus;
    cleanupStartedAt: number | null;
    cleanupFinishedAt: number | null;
    snapshotGeneratedAt: number | null;
    lastVacuumCompletedAt: number | null;
}

function getMaintenancePauseMs(): number {
    const configured = Number.parseInt(process.env.BUNGIE_SYSTEM_DISABLED_PAUSE_MS || '', 10);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAINTENANCE_PAUSE_MS;
}

function getCleanupDelayMs(): number {
    const configured = Number.parseInt(process.env.BUNGIE_MAINTENANCE_CLEANUP_DELAY_MS || '', 10);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : CLEANUP_DELAY_MS;
}

function getQuiesceGraceMs(): number {
    const configured = Number.parseInt(process.env.BUNGIE_MAINTENANCE_QUIESCE_GRACE_MS || '', 10);
    return Number.isFinite(configured) && configured >= 0
        ? configured
        : QUIESCE_GRACE_MS;
}

function getCleanupRetryWindowMs(): number {
    const configured = Number.parseInt(process.env.BUNGIE_MAINTENANCE_CLEANUP_RETRY_WINDOW_MS || '', 10);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : CLEANUP_RETRY_WINDOW_MS;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEventId(startedAt: number | null): string | null {
    return startedAt ? String(startedAt) : null;
}

function isCleanupCooldownSatisfied(lastCompletedAt: number | null): boolean {
    if (!lastCompletedAt) {
        return true;
    }

    return (Date.now() - lastCompletedAt) >= CLEANUP_COOLDOWN_MS;
}

function isCleanupEligibleNow(): boolean {
    const state = readMaintenanceState();
    const eventId = getEventId(state.maintenanceEventStartedAt);
    const remainingMs = Math.max(0, (state.bungieMaintenanceUntil || 0) - Date.now());
    const active = remainingMs > 0;

    if (!active || !eventId || !state.cleanupEligibleAt) {
        return false;
    }

    if (state.isVacuuming || state.dbQuiesceActive) {
        return false;
    }

    if (Date.now() < state.cleanupEligibleAt) {
        return false;
    }

    if (state.lastCleanupAttemptedEventId === eventId) {
        return false;
    }

    return isCleanupCooldownSatisfied(state.lastVacuumCompletedAt);
}

function isSqliteBusyLikeError(error: unknown): boolean {
    const message = (error as Error)?.message || '';
    return message.includes('database is locked') || message.includes('database is busy');
}

function validateQuickCheck(): void {
    const db = openMaintenanceDb();
    try {
        const rows = db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
        const failed = rows.some((row) => {
            const value = Object.values(row)[0];
            return value !== 'ok';
        });

        if (failed) {
            throw new Error(`PRAGMA quick_check failed: ${JSON.stringify(rows)}`);
        }
    } finally {
        db.close();
    }
}

function runSqlMaintenanceOnce(): void {
    const db = openMaintenanceDb();
    try {
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
        db.exec('VACUUM;');
        db.exec('ANALYZE;');
    } finally {
        db.close();
    }
}

async function runSqlMaintenanceWithRetry(): Promise<void> {
    validateQuickCheck();

    const deadline = Date.now() + getCleanupRetryWindowMs();
    while (true) {
        try {
            runSqlMaintenanceOnce();
            return;
        } catch (error) {
            if (isSqliteBusyLikeError(error) && Date.now() < deadline) {
                await sleep(1000);
                continue;
            }
            throw error;
        }
    }
}

async function runMaintenanceCleanup(
    source: string,
    cleanupId: string,
    shouldStop?: () => boolean
): Promise<boolean> {
    try {
        updateMaintenanceState((current) => ({
            ...current,
            cleanupStatus: 'snapshotting',
            cleanupStartedAt: Date.now(),
            cleanupFinishedAt: null,
            cleanupError: null,
            isVacuuming: true,
            lastCleanupAttemptedEventId: cleanupId,
        }));

        generateMaintenanceSnapshots();

        updateMaintenanceState((current) => ({
            ...current,
            dbQuiesceActive: true,
            cleanupStatus: 'quiescing',
            snapshotGeneratedAt: Date.now(),
        }));

        closeDb();
        await sleep(getQuiesceGraceMs());

        if (shouldStop?.()) {
            throw new Error(`${source} stopped before DB maintenance could start`);
        }

        updateMaintenanceState((current) => ({
            ...current,
            cleanupStatus: 'running',
        }));

        await runSqlMaintenanceWithRetry();

        updateMaintenanceState((current) => ({
            ...current,
            isVacuuming: false,
            dbQuiesceActive: false,
            cleanupStatus: 'succeeded',
            cleanupFinishedAt: Date.now(),
            cleanupError: null,
            lastVacuumCompletedAt: Date.now(),
            lastCleanupEventId: cleanupId,
        }));
    } catch (error) {
        updateMaintenanceState((current) => ({
            ...current,
            isVacuuming: false,
            dbQuiesceActive: false,
            cleanupStatus: 'failed',
            cleanupFinishedAt: Date.now(),
            cleanupError: (error as Error).message,
        }));

        console.error(`[BUNGIE] Downtime DB maintenance failed for ${source}:`, error);
        return false;
    }

    return true;
}

export async function executeMaintenanceCleanup(
    source: string,
    cleanupId: string,
    shouldStop?: () => boolean
): Promise<boolean> {
    const owner = `${source}-${process.pid}`;
    if (!tryAcquireCleanupLease(owner)) {
        return false;
    }

    try {
        return await runMaintenanceCleanup(source, cleanupId, shouldStop);
    } finally {
        releaseCleanupLease(owner);
    }
}

export async function maybeRunDowntimeCleanup(source: string, shouldStop?: () => boolean): Promise<void> {
    const state = readMaintenanceState();

    if (state.dbQuiesceActive) {
        closeDb();
        return;
    }

    if (!isCleanupEligibleNow()) {
        return;
    }

    const owner = `${source}-${process.pid}`;
    if (!tryAcquireCleanupLease(owner)) {
        return;
    }

    const cleanupId = getEventId(state.maintenanceEventStartedAt) || `manual-${Date.now()}`;
    try {
        await runMaintenanceCleanup(source, cleanupId, shouldStop);
    } finally {
        releaseCleanupLease(owner);
    }
}

export function isBungieSystemDisabledError(error: unknown): boolean {
    return error instanceof BungieAPIError && error.errorStatus === 'SystemDisabled';
}

export function getBungieMaintenanceStatus(): BungieMaintenanceStatus {
    const state = readMaintenanceState();
    const remainingMs = Math.max(0, (state.bungieMaintenanceUntil || 0) - Date.now());

    return {
        active: remainingMs > 0,
        until: state.bungieMaintenanceUntil,
        remainingMs,
        isVacuuming: state.isVacuuming,
        dbQuiesceActive: state.dbQuiesceActive,
        cleanupStatus: state.cleanupStatus,
        cleanupStartedAt: state.cleanupStartedAt,
        cleanupFinishedAt: state.cleanupFinishedAt,
        snapshotGeneratedAt: state.snapshotGeneratedAt,
        lastVacuumCompletedAt: state.lastVacuumCompletedAt,
    };
}

export function recordBungieMaintenancePause(source: string): BungieMaintenanceStatus {
    const now = Date.now();
    const proposedUntil = now + getMaintenancePauseMs();

    const next = updateMaintenanceState((current) => {
        const remainingMs = Math.max(0, (current.bungieMaintenanceUntil || 0) - now);
        const currentlyActive = remainingMs > 0;
        const eventStartedAt = currentlyActive
            ? current.maintenanceEventStartedAt || now
            : now;

        return {
            ...current,
            bungieMaintenanceActive: true,
            bungieMaintenanceUntil: Math.max(current.bungieMaintenanceUntil || 0, proposedUntil),
            maintenanceEventStartedAt: eventStartedAt,
            cleanupEligibleAt: eventStartedAt + getCleanupDelayMs(),
            cleanupStatus: (currentlyActive || current.isVacuuming) ? current.cleanupStatus : 'pending',
            cleanupStartedAt: (currentlyActive || current.isVacuuming) ? current.cleanupStartedAt : null,
            cleanupFinishedAt: (currentlyActive || current.isVacuuming) ? current.cleanupFinishedAt : null,
            cleanupError: (currentlyActive || current.isVacuuming) ? current.cleanupError : null,
            snapshotGeneratedAt: (currentlyActive || current.isVacuuming) ? current.snapshotGeneratedAt : null,
            isVacuuming: current.isVacuuming,
            dbQuiesceActive: (currentlyActive || current.isVacuuming) ? current.dbQuiesceActive : false,
        };
    });

    const remainingSeconds = Math.ceil(Math.max(0, (next.bungieMaintenanceUntil || now) - now) / 1000);
    console.warn(`[BUNGIE] API maintenance detected by ${source}. Pausing Bungie work for ${remainingSeconds}s.`);

    return getBungieMaintenanceStatus();
}

export async function waitForBungieMaintenancePause(
    source: string,
    shouldStop?: () => boolean
): Promise<boolean> {
    let waited = false;
    let logged = false;

    while (!shouldStop?.()) {
        await maybeRunDowntimeCleanup(source, shouldStop);

        const status = getBungieMaintenanceStatus();
        if (!status.active && !status.dbQuiesceActive && !status.isVacuuming) {
            return waited;
        }

        waited = true;
        if (!logged) {
            const reason = status.dbQuiesceActive
                ? 'DB maintenance quiesce'
                : status.isVacuuming
                    ? 'DB maintenance vacuum'
                : `${(status.remainingMs / 1000).toFixed(1)}s of Bungie maintenance pause`;
            console.log(`[BUNGIE] ${source} waiting for ${reason}.`);
            logged = true;
        }

        if (status.dbQuiesceActive || status.isVacuuming) {
            closeDb();
        }

        await sleep(1000);
    }

    return waited;
}
