import 'dotenv/config';
import path from 'path';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { executeMaintenanceCleanup } from '../src/lib/bungie/maintenance';
import {
    readMaintenanceState,
    setVacuumingActive,
} from '../src/lib/maintenance/state';

const execFile = promisify(execFileCallback);
const repoRoot = process.cwd();
const ecosystemConfigPath = path.join(repoRoot, 'ecosystem.config.js');
const MANAGED_WORKERS = ['scanner', 'crawler'] as const;
const CLEANUP_COOLDOWN_MS = 48 * 60 * 60 * 1000;

type ManagedWorker = (typeof MANAGED_WORKERS)[number];

interface Pm2ProcessInfo {
    name?: string;
    pm2_env?: {
        status?: string;
    };
}

function log(message: string): void {
    console.log(`[MAINTENANCE] ${message}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPm2(args: string[]): Promise<void> {
    const { stdout, stderr } = await execFile('pm2', args, {
        cwd: repoRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout.trim().length > 0) {
        process.stdout.write(stdout);
    }
    if (stderr.trim().length > 0) {
        process.stderr.write(stderr);
    }
}

async function readPm2Processes(): Promise<Pm2ProcessInfo[]> {
    const { stdout } = await execFile('pm2', ['jlist'], {
        cwd: repoRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
    });

    try {
        return JSON.parse(stdout) as Pm2ProcessInfo[];
    } catch (error) {
        throw new Error(`Failed to parse pm2 jlist output: ${(error as Error).message}`);
    }
}

async function getRunningManagedWorkers(): Promise<ManagedWorker[]> {
    const processes = await readPm2Processes();
    return processes
        .filter((proc): proc is Pm2ProcessInfo & { name: ManagedWorker } => (
            typeof proc.name === 'string' &&
            MANAGED_WORKERS.includes(proc.name as ManagedWorker) &&
            proc.pm2_env?.status === 'online'
        ))
        .map((proc) => proc.name);
}

async function stopWorkers(workers: ManagedWorker[]): Promise<void> {
    if (workers.length === 0) {
        log('No managed workers were online.');
        return;
    }

    log(`Stopping PM2 workers: ${workers.join(', ')}`);
    await runPm2(['stop', ...workers]);
}

async function restartWorkers(workers: ManagedWorker[]): Promise<void> {
    if (workers.length === 0) {
        return;
    }

    log(`Restarting PM2 workers: ${workers.join(', ')}`);
    await runPm2(['startOrRestart', ecosystemConfigPath, '--only', workers.join(','), '--update-env']);
}

async function waitForEligibleCleanup(): Promise<boolean> {
    let sawActiveMaintenance = false;

    while (true) {
        const state = readMaintenanceState();
        const eligibleAt = state.cleanupEligibleAt ?? null;
        const now = Date.now();
        const active = state.bungieMaintenanceActive && (state.bungieMaintenanceUntil || 0) > now;

        if (!active) {
            return !sawActiveMaintenance;
        }

        sawActiveMaintenance = true;

        if (!eligibleAt) {
            log('Cleanup is not yet eligible. Waiting for the maintenance window to mature...');
        } else if (now >= eligibleAt) {
            return true;
        } else {
            const remainingMs = eligibleAt - now;
            log(`Waiting ${(remainingMs / 1000).toFixed(1)}s for cleanup eligibility...`);
        }

        await sleep(1000);
    }
}

async function main(): Promise<void> {
    const force = process.argv.includes('--force');
    const initialState = readMaintenanceState();
    const cleanupInProgress =
        initialState.cleanupStatus === 'snapshotting' ||
        initialState.cleanupStatus === 'quiescing' ||
        initialState.cleanupStatus === 'running' ||
        initialState.dbQuiesceActive;
    const cleanupId = initialState.maintenanceEventStartedAt
        ? String(initialState.maintenanceEventStartedAt)
        : `manual-${Date.now()}`;

    if (cleanupInProgress) {
        log('A cleanup is already in progress. Nothing to do.');
        return;
    }

    if (initialState.isVacuuming) {
        log('Clearing a stale vacuum gate before continuing.');
        setVacuumingActive(false);
    }

    if (
        initialState.lastVacuumCompletedAt &&
        (Date.now() - initialState.lastVacuumCompletedAt) < CLEANUP_COOLDOWN_MS
    ) {
        const remainingMs = CLEANUP_COOLDOWN_MS - (Date.now() - initialState.lastVacuumCompletedAt);
        log(`Cleanup was run recently. Try again in ${(remainingMs / 1000 / 60).toFixed(1)} minutes.`);
        return;
    }

    const maintenanceActive = initialState.bungieMaintenanceActive &&
        (initialState.bungieMaintenanceUntil || 0) > Date.now();

    if (!maintenanceActive && !force) {
        log('Bungie is healthy. Re-run with --force to perform an ad hoc cleanup.');
        return;
    }

    const workersToRestart = await getRunningManagedWorkers();
    let vacuumGateSetHere = false;

    try {
        setVacuumingActive(true);
        vacuumGateSetHere = true;

        await stopWorkers(workersToRestart);

        const eligible = await waitForEligibleCleanup();
        if (!eligible) {
            log('Bungie maintenance ended before the cleanup window opened. Skipping cleanup.');
            return;
        }

        log(`Starting shared DB cleanup (${force ? 'forced' : 'maintenance-driven'})...`);
        const completed = await executeMaintenanceCleanup('manual', cleanupId);
        if (!completed) {
            const finalState = readMaintenanceState();
            if (finalState.cleanupStatus === 'failed') {
                log(`Cleanup failed: ${finalState.cleanupError || 'unknown error'}`);
                process.exitCode = 1;
                return;
            }

            log('Cleanup lease is already held by another process. Skipping.');
            return;
        }

        log('DB cleanup completed successfully.');
    } finally {
        if (vacuumGateSetHere) {
            setVacuumingActive(false);
        }
        await restartWorkers(workersToRestart);
    }
}

main().catch((error) => {
    console.error('[MAINTENANCE] Cleanup failed:', error);
    process.exitCode = 1;
});
