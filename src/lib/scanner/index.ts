import { BungieClient, BungieAPIError } from '../bungie/client';
import { isRaidActivityHash, getRaidKeyFromHash } from '../bungie/manifest';
import { getDb } from '../db';
import { insertFullPGCR, hasPGCR } from '../db/queries';
import { isoToUnix } from '../utils/helpers';

const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 5, 6]);

function isValidMembershipType(type: any): boolean {
    return VALID_MEMBERSHIP_TYPES.has(Number(type));
}

// =====================
// CONFIGURATION
// =====================

export interface ScannerConfig {
    requestsPerSecond: number;
    batchSize: number;
    pauseOnCatchupMs: number;
    maxConsecutiveMisses: number;
    apiKey?: string;
    enabled: boolean;
    workers: number;
}

const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
    requestsPerSecond: parseInt(process.env.SCANNER_REQUESTS_PER_SECOND || '25', 10),
    batchSize: parseInt(process.env.SCANNER_BATCH_SIZE || '75', 10),
    pauseOnCatchupMs: parseInt(process.env.SCANNER_PAUSE_ON_CATCHUP_MS || '20000', 10),
    maxConsecutiveMisses: parseInt(process.env.SCANNER_MAX_CONSECUTIVE_MISSES || '50', 10),
    apiKey: process.env.BUNGIE_SCANNER_API_KEY || undefined,
    enabled: true,
    workers: parseInt(process.env.SCANNER_WORKERS || '15', 10),
};

// =====================
// SCANNER STATE
// =====================

interface ScannerState {
    currentInstanceId: bigint;
    totalScanned: number;
    totalRaidsFound: number;
    totalMisses: number;
    consecutiveMisses: number;
    isRunning: boolean;
    shouldStop: boolean;
    startedAt: number;
}

let state: ScannerState = {
    currentInstanceId: BigInt(0),
    totalScanned: 0,
    totalRaidsFound: 0,
    totalMisses: 0,
    consecutiveMisses: 0,
    isRunning: false,
    shouldStop: false,
    startedAt: 0,
};

// Separate client and rate limiter for the scanner
let scannerClient: BungieClient | null = null;

// =====================
// CLIENT SETUP
// =====================

function getScannerClient(config: ScannerConfig): BungieClient {
    if (!scannerClient) {
        const apiKey = config.apiKey || process.env.BUNGIE_API_KEY;
        if (!apiKey) {
            throw new Error('No API key available for scanner. Set BUNGIE_SCANNER_API_KEY or BUNGIE_API_KEY.');
        }

        const rps = parseInt(process.env.SCANNER_REQUESTS_PER_SECOND || '25', 10);

        scannerClient = new BungieClient(apiKey, rps);
    }
    return scannerClient;
}

// =====================
// STATE PERSISTENCE
// =====================

function saveScannerPosition(instanceId: bigint): void {
    const db = getDb();

    const current = db.prepare(
        "SELECT value FROM crawler_state WHERE key = 'scanner_position'"
    ).get() as { value: string } | undefined;

    if (current && BigInt(current.value) > instanceId) {
        return;
    }

    db.prepare(`
    INSERT INTO crawler_state (key, value, updated_at)
    VALUES ('scanner_position', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = unixepoch()
  `).run(instanceId.toString());
}

function loadScannerPosition(): bigint {
    const db = getDb();

    const saved = db.prepare(
        "SELECT value FROM crawler_state WHERE key = 'scanner_position'"
    ).get() as { value: string } | undefined;

    if (saved && saved.value) {
        console.log(`[SCANNER] Resuming from saved position: ${saved.value}`);
        return BigInt(saved.value);
    }

    const highest = db.prepare(
        'SELECT MAX(CAST(instance_id AS INTEGER)) as max_id FROM pgcrs'
    ).get() as { max_id: number | null } | undefined;

    if (highest?.max_id) {
        console.log(`[SCANNER] Starting from highest PGCR in database: ${highest.max_id}`);
        return BigInt(highest.max_id);
    }

    const fallback = BigInt('16795700000');
    console.log(`[SCANNER] No PGCRs in database. Starting from fallback: ${fallback}`);
    return fallback;
}

function loadScannerPositionRaw(): bigint {
    const db = getDb();
    const saved = db.prepare(
        "SELECT value FROM crawler_state WHERE key = 'scanner_position'"
    ).get() as { value: string } | undefined;

    if (saved && saved.value) {
        return BigInt(saved.value);
    }
    return BigInt(0);
}

function writeScannerStats(): void {
    const db = getDb();
    const stats = JSON.stringify({
        currentInstanceId: state.currentInstanceId.toString(),
        totalScanned: state.totalScanned,
        totalRaidsFound: state.totalRaidsFound,
        totalMisses: state.totalMisses,
        isRunning: state.isRunning,
        startedAt: state.startedAt,
        raidHitRate: state.totalScanned > 0
            ? ((state.totalRaidsFound / state.totalScanned) * 100).toFixed(2) + '%'
            : '0%',
        uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
    });

    db.prepare(`
    INSERT INTO crawler_state (key, value, updated_at)
    VALUES ('scanner_stats', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = unixepoch()
  `).run(stats);
}

// =====================
// PGCR PROCESSING
// =====================

async function scanSinglePGCR(
    client: BungieClient,
    instanceId: string
): Promise<'raid' | 'not_raid' | 'not_found' | 'error' | 'error_retryable'> {
    if (hasPGCR(instanceId)) {
        return 'not_raid';
    }

    try {
        const response = await client.getPGCR(instanceId);
        const pgcrData = response.Response;

        if (!pgcrData || !pgcrData.activityDetails) {
            return 'not_found';
        }

        const activityHash = pgcrData.activityDetails.directorActivityHash
            || pgcrData.activityDetails.referenceId;

        if (!isRaidActivityHash(activityHash)) {
            return 'not_raid';
        }

        const raidKey = getRaidKeyFromHash(activityHash);

        const anyoneCompleted = pgcrData.entries?.some(
            (entry: any) => entry.values?.completed?.basic?.value === 1
        ) || false;

        const playerEntries = (pgcrData.entries || []).map((entry: any) => ({
            instanceId,
            membershipId: entry.player.destinyUserInfo.membershipId,
            membershipType: entry.player.destinyUserInfo.membershipType,
            displayName: entry.player.destinyUserInfo.displayName,
            bungieGlobalDisplayName: entry.player.destinyUserInfo.bungieGlobalDisplayName,
            characterClass: entry.player.characterClass || 'Unknown',
            lightLevel: entry.player.lightLevel || 0,
            completed: entry.values?.completed?.basic?.value === 1,
            kills: entry.values?.kills?.basic?.value || 0,
            deaths: entry.values?.deaths?.basic?.value || 0,
            assists: entry.values?.assists?.basic?.value || 0,
            timePlayedSeconds: entry.values?.timePlayedSeconds?.basic?.value || 0,
        }));

        insertFullPGCR(
            {
                instanceId,
                activityHash,
                raidKey,
                period: isoToUnix(pgcrData.period),
                startingPhaseIndex: pgcrData.startingPhaseIndex || 0,
                activityWasStartedFromBeginning: pgcrData.activityWasStartedFromBeginning || false,
                completed: anyoneCompleted,
                playerCount: (pgcrData.entries || []).length,
            },
            playerEntries
        );

        const db = getDb();
        const upsertPlayer = db.prepare(`
      INSERT INTO players (membership_id, membership_type, display_name, bungie_global_display_name, bungie_global_display_name_code, discovered_at, is_active)
      VALUES (?, ?, ?, ?, ?, unixepoch(), 1)
      ON CONFLICT(membership_id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, players.display_name),
        bungie_global_display_name = COALESCE(excluded.bungie_global_display_name, players.bungie_global_display_name),
        bungie_global_display_name_code = COALESCE(excluded.bungie_global_display_name_code, players.bungie_global_display_name_code)
    `);

        const insertMany = db.transaction((entries: any[]) => {
            for (const entry of entries) {
                if (!isValidMembershipType(entry.membershipType)) continue;
                upsertPlayer.run(
                    entry.membershipId,
                    entry.membershipType,
                    entry.displayName,
                    entry.bungieGlobalDisplayName || null,
                    entry.bungieGlobalDisplayNameCode || null
                );
            }
        });

        insertMany(playerEntries);

        return 'raid';
    } catch (error) {
        const errorMessage = (error as Error).message || '';

        // Check for PGCR not found — whether it's a BungieAPIError or regular Error
        if (
            (error instanceof BungieAPIError && (
                error.errorCode === 1653 ||
                error.errorStatus === 'DestinyPGCRNotFound' ||
                error.errorCode === 7
            )) ||
            errorMessage.includes('DestinyPGCRNotFound') ||
            errorMessage.includes('1653')
        ) {
            return 'not_found';
        }

        // System disabled
        if (
            (error instanceof BungieAPIError && error.errorStatus === 'SystemDisabled') ||
            errorMessage.includes('SystemDisabled')
        ) {
            console.error('[SCANNER] Bungie API is disabled. Pausing...');
            return 'error';
        }

        // Detect Cloudflare/HTTP server errors (502, 503, 504)
        if (
            errorMessage.includes('502') ||
            errorMessage.includes('503') ||
            errorMessage.includes('504') ||
            errorMessage.includes('Bad gateway') ||
            errorMessage.includes('<!DOCTYPE html>')
        ) {
            console.warn(`[SCANNER] ⚠️ Bungie API server error for PGCR ${instanceId} — will retry`);
            return 'error_retryable';
        }

        // Log unexpected errors (truncated) but continue scanning
        console.error(`[SCANNER] Error fetching PGCR ${instanceId}:`, errorMessage.substring(0, 150));
        return 'error';
    }
}

// =====================
// SCAN BATCH (CONCURRENT)
// =====================


async function scanBatch(
    client: BungieClient,
    startId: bigint,
    batchSize: number,
    workerCount: number
): Promise<{
    scanned: number;
    raidsFound: number;
    misses: number;
    consecutiveMisses: number;
    lastId: bigint;
    missedIds: string[];
}> {
    let raidsFound = 0;
    let misses = 0;
    let scanned = 0;

    // Build the list of instance IDs for this batch
    const instanceIds: string[] = [];
    for (let i = 0; i < batchSize; i++) {
        instanceIds.push((startId + BigInt(i)).toString());
    }

    // Shared index — each worker grabs the next available ID
    let nextIndex = 0;

    // Track results in order for consecutive miss calculation
    const results: ('raid' | 'not_raid' | 'not_found' | 'error' | 'error_retryable')[] = new Array(batchSize);

    async function worker() {
        while (true) {
            const myIndex = nextIndex++;
            if (myIndex >= batchSize || state.shouldStop) break;

            const result = await scanSinglePGCR(client, instanceIds[myIndex]);
            results[myIndex] = result;

            switch (result) {
                case 'raid':
                    raidsFound++;
                    scanned++;
                    break;
                case 'not_raid':
                    scanned++;
                    break;
                case 'not_found':
                    misses++;
                    scanned++;
                    break;
                case 'error':
                    scanned++;
                    break;
                case 'error_retryable':
                    break;
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(workerCount, batchSize) },
        () => worker()
    );
    await Promise.all(workers);

    // *** THIS IS THE KEY PART ***
    // Collect ALL IDs that were not_found or error_retryable for retry
    const missedIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
        if (results[i] === 'not_found' || results[i] === 'error_retryable') {
            missedIds.push(instanceIds[i]);
        }
    }

    // Calculate consecutive misses from the END of the batch
    let consecutiveMisses = 0;
    for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === 'not_found' || results[i] === 'error') {
            consecutiveMisses++;
        } else {
            break;
        }
    }

    const lastId = startId + BigInt(batchSize - 1);

    return {
        scanned,
        raidsFound,
        misses,
        consecutiveMisses,
        lastId,
        missedIds,
    };
}


// =====================
// RETRY MISSED IDs
// =====================

async function retryMissedIds(
    client: BungieClient,
    missedIds: string[],
    workerCount: number
): Promise<{ retryRaidsFound: number; stillMissing: number }> {
    let retryRaidsFound = 0;
    let stillMissing = 0;
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const myIndex = nextIndex++;
            if (myIndex >= missedIds.length || state.shouldStop) break;

            const result = await scanSinglePGCR(client, missedIds[myIndex]);

            switch (result) {
                case 'raid':
                    retryRaidsFound++;
                    break;
                case 'not_found':
                case 'error':
                case 'error_retryable':
                    stillMissing++;
                    break;
                // 'not_raid' means it exists now but isn't a raid — that's fine
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(workerCount, missedIds.length) },
        () => worker()
    );
    await Promise.all(workers);

    return { retryRaidsFound, stillMissing };
}

// =====================
// PUBLIC API
// =====================

export async function startScanner(overrides?: Partial<ScannerConfig>): Promise<void> {
    const config = { ...DEFAULT_SCANNER_CONFIG, ...overrides };

    if (state.isRunning) {
        console.warn('[SCANNER] Scanner is already running');
        return;
    }

    if (!config.enabled) {
        console.log('[SCANNER] Scanner is disabled');
        return;
    }

    state.isRunning = true;
    state.shouldStop = false;
    state.startedAt = Date.now();
    state.totalScanned = 0;
    state.totalRaidsFound = 0;
    state.totalMisses = 0;

    const client = getScannerClient(config);
    state.currentInstanceId = loadScannerPosition();

    console.log('[SCANNER] Starting PGCR scanner');
    console.log(`  Rate limit:    ${config.requestsPerSecond} req/s`);
    console.log(`  Batch size:    ${config.batchSize}`);
    console.log(`  Workers:       ${config.workers}`);
    console.log(`  Catchup pause: ${config.pauseOnCatchupMs}ms`);
    console.log(`  Max misses:    ${config.maxConsecutiveMisses}`);
    console.log(`  Starting at:   ${state.currentInstanceId}`);
    console.log(`  API key:       ${config.apiKey ? 'dedicated scanner key' : 'shared main key'}`);
    console.log('');

    async function scanLoop() {
        if (state.shouldStop) {
            state.isRunning = false;
            saveScannerPosition(state.currentInstanceId);
            writeScannerStats();
            console.log('[SCANNER] 🛑 Scanner stopped');
            return;
        }

        // Check if another process has moved the position ahead
        const dbPosition = loadScannerPositionRaw();
        if (dbPosition > state.currentInstanceId) {
            const jump = dbPosition - state.currentInstanceId;
            console.log(
                `[SCANNER] 🚀 Position jump detected! ${state.currentInstanceId} → ${dbPosition} (+${jump} IDs)`
            );
            console.log(`[SCANNER] 📡 Another process updated the position. Jumping ahead...`);
            state.currentInstanceId = dbPosition;
        }

        const batchStart = state.currentInstanceId + BigInt(1);
        const result = await scanBatch(client, batchStart, config.batchSize, config.workers);

        // TEMPORARY DEBUG — remove after confirming it works
        console.log(`[SCANNER DEBUG] Batch results: ${JSON.stringify({
            scanned: result.scanned,
            raidsFound: result.raidsFound,
            misses: result.misses,
            consecutiveMisses: result.consecutiveMisses,
            missedIdsCount: result.missedIds.length,
            firstFewMissed: result.missedIds.slice(0, 5),
        })}`);

        state.totalScanned += result.scanned;
        state.totalRaidsFound += result.raidsFound;
        state.totalMisses += result.misses;
        state.consecutiveMisses = result.consecutiveMisses;
        state.currentInstanceId = result.lastId;

        saveScannerPosition(state.currentInstanceId);

        // Log progress
        const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(0);
        const hitRate = state.totalScanned > 0
            ? ((state.totalRaidsFound / state.totalScanned) * 100).toFixed(1)
            : '0';

        if (result.raidsFound > 0) {
            console.log(
                `[SCANNER] Batch complete: ${result.raidsFound} raids found in ${result.scanned} PGCRs | ` +
                `Total: ${state.totalRaidsFound} raids / ${state.totalScanned} scanned (${hitRate}% hit rate) | ` +
                `Position: ${state.currentInstanceId} | ${elapsed}s elapsed`
            );
        }

        if (state.totalScanned % (config.batchSize * 5) === 0) {
            writeScannerStats();
        }

        // Caught up to present — pause then retry missed IDs
        if (state.consecutiveMisses >= config.maxConsecutiveMisses) {
            console.log(
                `[SCANNER] Caught up to present (${state.consecutiveMisses} consecutive misses). ` +
                `${result.missedIds.length} missed IDs to retry. ` +
                `Pausing for ${config.pauseOnCatchupMs / 1000}s...`
            );
            state.consecutiveMisses = 0;
            writeScannerStats();

            // Pause, then retry missed IDs
            setTimeout(async () => {
                if (result.missedIds.length > 0 && !state.shouldStop) {
                    console.log(`[SCANNER] 🔄 Retrying ${result.missedIds.length} missed IDs...`);

                    const retryResult = await retryMissedIds(
                        client,
                        result.missedIds,
                        config.workers
                    );

                    state.totalRaidsFound += retryResult.retryRaidsFound;

                    if (retryResult.retryRaidsFound > 0) {
                        console.log(
                            `[SCANNER] 🔄 Retry found ${retryResult.retryRaidsFound} raids! ` +
                            `(${retryResult.stillMissing} still missing)`
                        );
                    } else {
                        console.log(
                            `[SCANNER] 🔄 Retry complete. No new raids found. ` +
                            `(${retryResult.stillMissing} still missing)`
                        );
                    }
                }

                scanLoop();
            }, config.pauseOnCatchupMs);
            return;
        }

        // Small delay between batches
        setTimeout(scanLoop, 100);
    }

    scanLoop();
}

export function stopScanner(): void {
    console.log('[SCANNER] Stopping scanner...');
    state.shouldStop = true;
}

export function isScannerRunning(): boolean {
    return state.isRunning;
}

export function getScannerStats(): {
    isRunning: boolean;
    currentInstanceId: string;
    totalScanned: number;
    totalRaidsFound: number;
    hitRate: string;
    uptimeSeconds: number;
} {
    return {
        isRunning: state.isRunning,
        currentInstanceId: state.currentInstanceId.toString(),
        totalScanned: state.totalScanned,
        totalRaidsFound: state.totalRaidsFound,
        hitRate: state.totalScanned > 0
            ? ((state.totalRaidsFound / state.totalScanned) * 100).toFixed(2) + '%'
            : '0%',
        uptimeSeconds: state.isRunning ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
    };
}
