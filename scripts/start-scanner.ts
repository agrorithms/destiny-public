import 'dotenv/config';
import { getScannerApiKeysFromEnv, startScanner, stopScanner } from '../src/lib/scanner';
import { getDbStats } from '../src/lib/db/queries';
import { closeDb } from '../src/lib/db';

const scannerApiKeys = getScannerApiKeysFromEnv();

const SCANNER_CONFIG = {
    requestsPerSecond: parseInt(process.env.SCANNER_REQUESTS_PER_SECOND || '25', 10),
    batchSize: parseInt(process.env.SCANNER_BATCH_SIZE || '50', 10),
    pauseOnCatchupMs: parseInt(process.env.SCANNER_PAUSE_ON_CATCHUP_MS || '10000', 10),
    maxConsecutiveMisses: parseInt(process.env.SCANNER_MAX_CONSECUTIVE_MISSES || '50', 10),
    apiKeys: scannerApiKeys,
    enabled: true,
};

async function main() {
    console.log('========================================');
    console.log('  Destiny Farm Finder — PGCR Scanner');
    console.log('========================================\n');

    const stats = getDbStats();
    console.log('Database stats:', stats);
    console.log('');
    console.log('Scanner config:', {
        ...SCANNER_CONFIG,
        apiKeysConfigured: scannerApiKeys.length,
        aggregateRequestsPerSecond: `${scannerApiKeys.length * SCANNER_CONFIG.requestsPerSecond} req/s max`,
    });
    console.log('');
    console.log('Starting scanner... Press Ctrl+C to stop.\n');

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[INFO] Received SIGINT. Shutting down gracefully...');
        stopScanner();
        setTimeout(() => {
            closeDb();
            console.log('[INFO] Shutdown complete.');
            process.exit(0);
        }, 3000);
    });

    process.on('SIGTERM', () => {
        console.log('\n[INFO] Received SIGTERM. Shutting down gracefully...');
        stopScanner();
        setTimeout(() => {
            closeDb();
            console.log('[INFO] Shutdown complete.');
            process.exit(0);
        }, 3000);
    });

    if (scannerApiKeys.length === 0) {
        throw new Error('No scanner API keys found. Set BUNGIE_SCANNER_API_KEY, _2, _3, or _4.');
    }

    await startScanner(SCANNER_CONFIG);
}

main().catch((error) => {
    console.error('[ERROR] Failed to start scanner:', (error as Error).message);
    process.exit(1);
});
