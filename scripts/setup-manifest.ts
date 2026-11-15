import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getBungieClient } from '../src/lib/bungie/client';
import type { DestinyActivityDefinition } from '../src/lib/bungie/types';
import { closeDb } from '../src/lib/db';

// Writes data/manifest-cache.json for a human to read; nothing reads it at runtime. Lives here
// rather than in src/lib/bungie/manifest.ts so that module stays free of `fs` and the server's
// Bungie client: the profile page imports it in the browser (#9001).
const MANIFEST_CACHE_PATH = path.join(process.cwd(), 'data', 'manifest-cache.json');

async function updateManifestCache(): Promise<void> {
    console.log('📦 Fetching Destiny 2 manifest...');
    const client = getBungieClient();
    const manifest = await client.getManifest();

    const activityDefPath =
        manifest.Response.jsonWorldComponentContentPaths.en.DestinyActivityDefinition;

    const activityDefUrl = `https://www.bungie.net${activityDefPath}`;
    console.log(`📥 Downloading activity definitions from ${activityDefUrl}`);

    const response = await fetch(activityDefUrl);
    const activityDefs: Record<string, DestinyActivityDefinition> = await response.json();

    // Find all raid activities
    const raidActivities: Record<string, {
        hash: number;
        name?: string;
        description?: string;
        directActivityModeType?: number;
    }> = {};
    for (const [hash, def] of Object.entries(activityDefs)) {
        if (
            def.activityTypeHash === 2043403989 ||
            (def.activityModeTypes && def.activityModeTypes.includes(4))
        ) {
            raidActivities[hash] = {
                hash: Number(hash),
                name: def.displayProperties?.name,
                description: def.displayProperties?.description,
                directActivityModeType: def.directActivityModeType,
            };
        }
    }

    const cacheData = {
        updatedAt: new Date().toISOString(),
        raidActivities,
    };

    fs.mkdirSync(path.dirname(MANIFEST_CACHE_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_CACHE_PATH, JSON.stringify(cacheData, null, 2));
    console.log(
        `✅ Cached ${Object.keys(raidActivities).length} raid activities to ${MANIFEST_CACHE_PATH}`
    );
    console.log('⚠️  Review the cached file and update RAID_DEFINITIONS in manifest.ts if needed');
}

async function main() {
    console.log('========================================');
    console.log('  Destiny Farm Finder — Manifest Setup');
    console.log('========================================\n');

    try {
        await updateManifestCache();
        console.log('\n[INFO] Manifest cache updated successfully.');
        console.log('[INFO] Review data/manifest-cache.json and update raid hashes in');
        console.log('       src/lib/bungie/manifest.ts if needed.');
    } catch (error) {
        console.error('[ERROR] Failed to update manifest:', error);
    } finally {
        closeDb();
    }
}

main();
