import fs from 'fs';
import path from 'path';
import { getBungieClient } from './client';

const MANIFEST_CACHE_PATH = path.join(process.cwd(), 'data', 'manifest-cache.json');

export interface ManifestActivityDefinition {
    hash: number;
    name: string;
    description?: string;
    directActivityModeType?: number;
}

export interface RaidDefinition {
    name: string;
    slug: string;
    hashes: number[];
}

// Known raid activity hashes — fallback/starter values
// The setup-manifest script will fetch the latest from the API
const RAID_DEFINITIONS: Record<string, RaidDefinition> = {
    the_desert_perpetual: {
        name: "The Desert Perpetual",
        slug: 'the-desert-perpetual',
        hashes: [2586252122, 1044919065, 3896382790, 3817322389],
    },
    salvations_edge: {
        name: "Salvation's Edge",
        slug: 'salvations-edge',
        hashes: [2192826039, 940375169, 1541433876, 4129614942],
    },
    crotas_end: {
        name: "Crota's End",
        slug: 'crotas-end',
        hashes: [1566480315, 1507509200, 4179289725, 107319834, 156253568],
    },
    root_of_nightmares: {
        name: 'Root of Nightmares',
        slug: 'root-of-nightmares',
        hashes: [2381413764, 2918919505],
    },
    kings_fall: {
        name: "King's Fall",
        slug: 'kings-fall',
        hashes: [1374392663, 2964135793, 3257594522, 1063970578, 2897223272],
    },
    vow_of_the_disciple: {
        name: 'Vow of the Disciple',
        slug: 'vow-of-the-disciple',
        hashes: [2906950631, 4156879541, 4217492330, 1441982566, 3889634515],
    },
    vault_of_glass: {
        name: 'Vault of Glass',
        slug: 'vault-of-glass',
        hashes: [3881495763, 1681562271, 3022541210, 1485585878, 3711931140],
    },
    deep_stone_crypt: {
        name: 'Deep Stone Crypt',
        slug: 'deep-stone-crypt',
        hashes: [910380154, 3976949817],
    },
    garden_of_salvation: {
        name: 'Garden of Salvation',
        slug: 'garden-of-salvation',
        hashes: [2659723068, 3458480158, 1042180643, 2497200493, 3845997235],
    },
    last_wish: {
        name: 'Last Wish',
        slug: 'last-wish',
        hashes: [2122313384, 1661734046, 2214608157, 2214608156],
    },
};

const raidDefinitions: Record<string, RaidDefinition> = RAID_DEFINITIONS;
const hashToRaidMap: Map<number, string> = new Map();
let manifestActivitiesCache: Record<string, ManifestActivityDefinition> | null = null;

function buildHashMap() {
    hashToRaidMap.clear();
    for (const [key, raid] of Object.entries(raidDefinitions)) {
        for (const hash of raid.hashes) {
            hashToRaidMap.set(hash, key);
        }
    }
}

// Initialize with defaults
buildHashMap();

export function isRaidActivityHash(hash: number): boolean {
    return hashToRaidMap.has(hash);
}

export function getRaidKeyFromHash(hash: number): string | undefined {
    return hashToRaidMap.get(hash);
}

export function getRaidDefinition(key: string): RaidDefinition | undefined {
    return raidDefinitions[key];
}

export function getAllRaidDefinitions(): Record<string, RaidDefinition> {
    return { ...raidDefinitions };
}

export function getRaidNameFromHash(hash: number): string {
    const key = hashToRaidMap.get(hash);
    if (!key) return 'Unknown Raid';
    return raidDefinitions[key]?.name || 'Unknown Raid';
}

function readManifestCache(): {
    updatedAt?: string;
    raidActivities?: Record<string, ManifestActivityDefinition>;
    allActivities?: Record<string, ManifestActivityDefinition>;
} | null {
    if (manifestActivitiesCache) {
        return {
            allActivities: manifestActivitiesCache,
            raidActivities: Object.fromEntries(
                Object.entries(manifestActivitiesCache).filter(([hash]) => isRaidActivityHash(Number(hash)))
            ),
        };
    }

    if (!fs.existsSync(MANIFEST_CACHE_PATH)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(MANIFEST_CACHE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        manifestActivitiesCache = parsed.allActivities || parsed.raidActivities || {};
        return parsed;
    } catch (error) {
        console.error('[WARN] Failed to read manifest cache:', error);
        return null;
    }
}

export function getActivityDefinitionFromManifest(hash: number): ManifestActivityDefinition | null {
    const cache = readManifestCache();
    const key = String(hash);
    const activity =
        cache?.allActivities?.[key]
        || cache?.raidActivities?.[key];

    return activity || null;
}

export function getActivityNameFromManifest(hash: number): string | null {
    const activity = getActivityDefinitionFromManifest(hash);
    return activity?.name || null;
}

export function getActivityNameFromHash(hash: number): string {
    const manifestName = getActivityNameFromManifest(hash);
    if (manifestName) return manifestName;
    if (isRaidActivityHash(hash)) return getRaidNameFromHash(hash);
    return `Activity ${hash}`;
}

export function getManifestActivityOptions(): Array<{
    hash: number;
    name: string;
}> {
    const cache = readManifestCache();
    const entries = Object.values(cache?.allActivities || cache?.raidActivities || {});

    if (entries.length > 0) {
        return entries
            .filter((activity) => activity?.hash && activity?.name)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((activity) => ({
                hash: activity.hash,
                name: activity.name,
            }));
    }

    return Object.values(raidDefinitions)
        .flatMap((raid) => raid.hashes.map((hash) => ({
            hash,
            name: raid.name,
        })))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateManifestCache(): Promise<void> {
    console.log('📦 Fetching Destiny 2 manifest...');
    const client = getBungieClient();
    const manifest = await client.getManifest();

    const activityDefPath =
        manifest.Response.jsonWorldComponentContentPaths.en.DestinyActivityDefinition;

    const activityDefUrl = `https://www.bungie.net${activityDefPath}`;
    console.log(`📥 Downloading activity definitions from ${activityDefUrl}`);

    const response = await fetch(activityDefUrl);
    const activityDefs: Record<string, any> = await response.json();

    const allActivities: Record<string, ManifestActivityDefinition> = {};
    // Find all raid activities
    const raidActivities: Record<string, any> = {};
    for (const [hash, def] of Object.entries(activityDefs)) {
        if (def.displayProperties?.name) {
            allActivities[hash] = {
                hash: Number(hash),
                name: def.displayProperties.name,
                description: def.displayProperties.description,
                directActivityModeType: def.directActivityModeType,
            };
        }

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
        allActivities,
        raidActivities,
    };

    fs.mkdirSync(path.dirname(MANIFEST_CACHE_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_CACHE_PATH, JSON.stringify(cacheData, null, 2));
    manifestActivitiesCache = allActivities;
    console.log(
        `✅ Cached ${Object.keys(raidActivities).length} raid activities to ${MANIFEST_CACHE_PATH}`
    );
    console.log('⚠️  Review the cached file and update RAID_DEFINITIONS in manifest.ts if needed');
}
