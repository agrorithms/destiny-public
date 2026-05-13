import 'dotenv/config';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import Database from 'better-sqlite3';

type Source = 'mock' | 'scanner' | 'crawler';

interface LogEntry {
    source: Source;
    timestamp: number;
    line: string;
}

interface MaintenanceStateShape {
    cleanupStatus?: string;
    dbQuiesceActive?: boolean;
    lastVacuumCompletedAt?: number | null;
    snapshotGeneratedAt?: number | null;
}

interface HarnessSummary {
    mode: 'fast' | 'prod-timings';
    runDir: string;
    dbPath: string;
    logFiles: Record<Source, string>;
    maintenanceStatePath: string;
    statusesObserved: Array<{ status: string; timestamp: number }>;
    assertions: Record<string, boolean>;
    cleanupFinishedAt: number | null;
    completedAt: number;
}

const prodTimings = process.argv.includes('--prod-timings');
const mode: HarnessSummary['mode'] = prodTimings ? 'prod-timings' : 'fast';
const repoRoot = process.cwd();
const sourceDbPath = path.join(repoRoot, 'data', 'raid-tracker.db');
const runDir = path.join(repoRoot, 'tmp', `maintenance-cycle-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const runDbPath = path.join(runDir, 'raid-tracker.db');
const maintenanceStatePath = path.join(runDir, 'maintenance-state.json');
const tsxCliPath = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const logFiles: Record<Source, string> = {
    mock: path.join(runDir, 'mock.log'),
    scanner: path.join(runDir, 'scanner.log'),
    crawler: path.join(runDir, 'crawler.log'),
};

const logEntries: LogEntry[] = [];
const statusTransitions: Array<{ status: string; timestamp: number }> = [];
const logStreams = new Map<Source, fs.WriteStream>();
const children = new Map<Source, ChildProcess>();
let cleanupFinishedAt: number | null = null;
let watcher: NodeJS.Timeout | null = null;
let shuttingDown = false;

function ensureRunDir(): void {
    fs.mkdirSync(runDir, { recursive: true });
}

function createLogStream(source: Source): fs.WriteStream {
    const stream = fs.createWriteStream(logFiles[source], { flags: 'a' });
    logStreams.set(source, stream);
    return stream;
}

function emitLog(source: Source, line: string): void {
    const timestamp = Date.now();
    const prefix = `[${new Date(timestamp).toISOString()}] [${source.toUpperCase()}] `;
    const formatted = `${prefix}${line}`;
    logEntries.push({ source, timestamp, line });
    console.log(formatted);
    logStreams.get(source)?.write(`${formatted}\n`);
}

function attachStream(source: Source, stream: NodeJS.ReadableStream | null): void {
    if (!stream) return;

    let buffer = '';
    stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim().length > 0) {
                emitLog(source, line);
            }
        }
    });
    stream.on('end', () => {
        if (buffer.trim().length > 0) {
            emitLog(source, buffer);
        }
    });
}

function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Failed to resolve a free port'));
                return;
            }
            const port = address.port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

function getStartingInstanceId(dbPath: string): bigint {
    const db = new Database(dbPath, { readonly: true });
    try {
        const scannerRow = db.prepare(
            "SELECT value FROM crawler_state WHERE key = 'scanner_position'"
        ).get() as { value: string | null } | undefined;

        if (scannerRow?.value) {
            return BigInt(scannerRow.value);
        }

        const row = db.prepare('SELECT MAX(CAST(instance_id AS INTEGER)) as maxId FROM pgcrs').get() as {
            maxId: number | null;
        };
        return BigInt(row.maxId || 16795700000);
    } finally {
        db.close();
    }
}

function scannerRecoveredAfterCleanup(timestamp: number | null): boolean {
    const resumedFromPause = assertLineAfter('scanner', timestamp, /Resuming scan loop after Bungie maintenance pause/);
    const reopenedDb = assertLineAfter('scanner', timestamp, /SQLite database initialized/);
    const emittedProgress = assertLineAfter('scanner', timestamp, /\[SCANNER\] Progress:/);
    return (resumedFromPause || reopenedDb) && emittedProgress;
}

function buildWorkerEnv(port: number, baseInstanceId: bigint): NodeJS.ProcessEnv {
    const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        BUNGIE_API_KEY: 'mock-key',
        BUNGIE_DISCOVERY_API_KEY: 'mock-key',
        BUNGIE_SCANNER_API_KEY: 'mock-key',
        BUNGIE_BASE_URL: `http://127.0.0.1:${port}/Platform`,
        RAID_TRACKER_DB_PATH: runDbPath,
        RAID_TRACKER_DATA_DIR: runDir,
        SCANNER_REQUESTS_PER_SECOND: '1',
        SCANNER_BATCH_SIZE: '1',
        SCANNER_WORKERS: '1',
        SCANNER_PROGRESS_LOG_EVERY: '1',
        SCANNER_PAUSE_ON_CATCHUP_MS: '1000',
        SCANNER_MAX_CONSECUTIVE_MISSES: '1000',
        CRAWLER_INTERVAL_MS: '2000',
        CRAWLER_MAX_PLAYERS_PER_CYCLE: '1',
        CRAWLER_CONCURRENCY: '1',
        CRAWLER_ACTIVE_SESSION_INTERVAL_MS: '4000',
        CRAWLER_ACTIVE_SESSION_INITIAL_DELAY_MS: '1000',
        CRAWLER_SESSION_POLLING_LIMIT: '1',
        ACTIVE_SESSION_CONCURRENCY: '1',
        ACTIVE_SESSION_STALE_CONCURRENCY: '1',
        ACTIVE_SESSION_STALE_REVERIFY_LIMIT: '1',
        MOCK_BUNGIE_PORT: String(port),
        MOCK_BUNGIE_BASE_INSTANCE_ID: baseInstanceId.toString(),
    };

    if (!prodTimings) {
        baseEnv.BUNGIE_SYSTEM_DISABLED_PAUSE_MS = '8000';
        baseEnv.BUNGIE_MAINTENANCE_CLEANUP_DELAY_MS = '4000';
        baseEnv.BUNGIE_MAINTENANCE_QUIESCE_GRACE_MS = '500';
        baseEnv.BUNGIE_MAINTENANCE_CLEANUP_RETRY_WINDOW_MS = '5000';
        baseEnv.MOCK_BUNGIE_HEALTHY_MS = '4000';
        baseEnv.MOCK_BUNGIE_DISABLED_MS = '9000';
        baseEnv.MOCK_BUNGIE_RECOVERY_MS = '12000';
    } else {
        baseEnv.MOCK_BUNGIE_HEALTHY_MS = '6000';
        baseEnv.MOCK_BUNGIE_DISABLED_MS = '330000';
        baseEnv.MOCK_BUNGIE_RECOVERY_MS = '15000';
    }

    return baseEnv;
}

function spawnTsxScript(source: Source, scriptPath: string, env: NodeJS.ProcessEnv): ChildProcess {
    const child = spawn(process.execPath, [tsxCliPath, scriptPath], {
        cwd: repoRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    children.set(source, child);
    attachStream(source, child.stdout);
    attachStream(source, child.stderr);

    child.on('exit', (code, signal) => {
        emitLog(source, `Process exited with code=${code} signal=${signal}`);
        if (!shuttingDown && code !== 0 && signal !== 'SIGTERM') {
            void failHarness(new Error(`${source} exited unexpectedly with code ${code}`));
        }
    });

    return child;
}

function readMaintenanceState(): MaintenanceStateShape | null {
    if (!fs.existsSync(maintenanceStatePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(maintenanceStatePath, 'utf8')) as MaintenanceStateShape;
    } catch {
        return null;
    }
}

function startStateWatcher(): void {
    let lastStatus: string | null = null;
    watcher = setInterval(() => {
        const state = readMaintenanceState();
        if (!state) return;

        if (state.cleanupStatus && state.cleanupStatus !== lastStatus) {
            lastStatus = state.cleanupStatus;
            statusTransitions.push({ status: state.cleanupStatus, timestamp: Date.now() });
            console.log(`[STATE] cleanupStatus -> ${state.cleanupStatus}`);
        }

        if (state.cleanupStatus === 'succeeded' && !cleanupFinishedAt) {
            cleanupFinishedAt = Date.now();
        }
    }, 50);
}

function assertLineAfter(source: Source, timestamp: number | null, matcher: RegExp): boolean {
    return logEntries.some((entry) => (
        entry.source === source &&
        (timestamp === null || entry.timestamp >= timestamp) &&
        matcher.test(entry.line)
    ));
}

function validateAssertions(): HarnessSummary['assertions'] {
    const finalState = readMaintenanceState();
    const observedStatuses = new Set(statusTransitions.map((entry) => entry.status));
    const snapshotsDir = path.join(runDir, 'maintenance-snapshots');

    const assertions = {
        scannerDetectedSystemDisabled: assertLineAfter('scanner', null, /API maintenance detected by scanner/),
        crawlerDetectedSystemDisabled: (
            assertLineAfter('crawler', null, /API maintenance detected by crawler/) ||
            assertLineAfter('crawler', null, /API maintenance detected by active session poll/)
        ),
        observedPending: observedStatuses.has('pending'),
        observedSnapshotting: observedStatuses.has('snapshotting') || Boolean(finalState?.snapshotGeneratedAt),
        observedQuiescing: observedStatuses.has('quiescing'),
        observedRunning: observedStatuses.has('running'),
        observedSucceeded: observedStatuses.has('succeeded'),
        snapshotStatusExists: fs.existsSync(path.join(snapshotsDir, 'status.json')),
        snapshotLeaderboardExists: fs.existsSync(path.join(snapshotsDir, 'leaderboard.json')),
        snapshotAdminExists: fs.existsSync(path.join(snapshotsDir, 'admin-stats.json')),
        lastVacuumCompletedAtRecorded: Boolean(finalState?.lastVacuumCompletedAt),
        dbQuiesceCleared: finalState?.dbQuiesceActive === false,
        scannerResumedAfterCleanup: scannerRecoveredAfterCleanup(cleanupFinishedAt),
        crawlerResumedAfterCleanup: (
            assertLineAfter('crawler', cleanupFinishedAt, /Resuming crawl loop after Bungie maintenance pause/) &&
            (
                assertLineAfter('crawler', cleanupFinishedAt, /Crawl cycle complete:/) ||
                assertLineAfter('crawler', cleanupFinishedAt, /Polling active sessions/)
            )
        ),
    };

    return assertions;
}

function writeSummary(assertions: HarnessSummary['assertions']): HarnessSummary {
    const summary: HarnessSummary = {
        mode,
        runDir,
        dbPath: runDbPath,
        logFiles,
        maintenanceStatePath,
        statusesObserved: statusTransitions,
        assertions,
        cleanupFinishedAt,
        completedAt: Date.now(),
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    return summary;
}

async function stopChildren(): Promise<void> {
    shuttingDown = true;
    if (watcher) {
        clearInterval(watcher);
        watcher = null;
    }

    const waits = Array.from(children.entries()).map(([source, child]) => {
        if (child.exitCode !== null || child.killed) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
            }, 5000);

            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });

            child.kill('SIGTERM');
            emitLog(source, 'Sent SIGTERM for harness shutdown.');
        });
    });

    await Promise.all(waits);

    for (const stream of logStreams.values()) {
        stream.end();
    }
}

async function failHarness(error: Error): Promise<never> {
    console.error(`[HARNESS] Failure: ${error.message}`);
    await stopChildren();
    throw error;
}

async function waitForSuccess(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = readMaintenanceState();
        const scannerResumed = scannerRecoveredAfterCleanup(cleanupFinishedAt);
        const crawlerResumed = assertLineAfter('crawler', cleanupFinishedAt, /Resuming crawl loop after Bungie maintenance pause/);
        const crawlerWork = assertLineAfter('crawler', cleanupFinishedAt, /Crawl cycle complete:|Polling active sessions/);

        if (
            state?.cleanupStatus === 'succeeded' &&
            state.dbQuiesceActive === false &&
            scannerResumed &&
            crawlerResumed &&
            crawlerWork
        ) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for maintenance cycle success in ${mode} mode`);
}

async function main() {
    ensureRunDir();
    fs.cpSync(sourceDbPath, runDbPath);

    createLogStream('mock');
    createLogStream('scanner');
    createLogStream('crawler');

    const port = await findFreePort();
    const baseInstanceId = getStartingInstanceId(runDbPath) - BigInt(1);
    const env = buildWorkerEnv(port, baseInstanceId);

    fs.writeFileSync(
        path.join(runDir, 'run-config.json'),
        JSON.stringify({
            mode,
            port,
            baseInstanceId: baseInstanceId.toString(),
            timings: {
                healthyMs: env.MOCK_BUNGIE_HEALTHY_MS,
                disabledMs: env.MOCK_BUNGIE_DISABLED_MS,
                recoveryMs: env.MOCK_BUNGIE_RECOVERY_MS,
                maintenancePauseMs: env.BUNGIE_SYSTEM_DISABLED_PAUSE_MS || 'production-default',
                cleanupDelayMs: env.BUNGIE_MAINTENANCE_CLEANUP_DELAY_MS || 'production-default',
                quiesceGraceMs: env.BUNGIE_MAINTENANCE_QUIESCE_GRACE_MS || 'production-default',
            },
        }, null, 2)
    );

    process.on('SIGINT', () => {
        void failHarness(new Error('Interrupted by SIGINT'));
    });
    process.on('SIGTERM', () => {
        void failHarness(new Error('Interrupted by SIGTERM'));
    });

    startStateWatcher();

    spawnTsxScript('mock', 'scripts/mock-bungie-maintenance.ts', env);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    spawnTsxScript('scanner', 'scripts/start-scanner.ts', env);
    spawnTsxScript('crawler', 'scripts/start-crawler.ts', env);

    await waitForSuccess(prodTimings ? 420000 : 90000);

    const assertions = validateAssertions();
    const summary = writeSummary(assertions);
    const failures = Object.entries(assertions).filter(([, value]) => !value);

    await stopChildren();

    if (failures.length > 0) {
        throw new Error(`Harness assertions failed: ${failures.map(([key]) => key).join(', ')}`);
    }

    console.log('[HARNESS] Maintenance simulation succeeded.');
    console.log(`[HARNESS] Summary written to ${path.join(runDir, 'summary.json')}`);
    console.log(`[HARNESS] Logs saved under ${runDir}`);
    console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
    const assertions = validateAssertions();
    writeSummary(assertions);
    await stopChildren();
    console.error(error);
    process.exit(1);
});
