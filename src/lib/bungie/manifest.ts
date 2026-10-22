import fs from 'fs';
import path from 'path';
import { getBungieClient } from './client';
import type { DestinyActivityDefinition } from './types';

const MANIFEST_CACHE_PATH = path.join(process.cwd(), 'data', 'manifest-cache.json');

/** Which version of a Raid was played (CONTEXT.md). Every hash has exactly one. */
export type Difficulty = 'normal' | 'master' | 'epic';

export interface RaidDefinition {
    name: string;
    slug: string;
    /**
     * Every activity hash of the raid, each tagged with its Difficulty. Labels come from
     * `data/manifest-cache.json`: a hash Bungie labels neither Master nor Epic is Normal
     * (Standard, Contest, Legend, Expert, Challenge Mode, unlabelled, the Pantheons' Customize).
     */
    hashes: Record<number, Difficulty>;
}

// Known raid activity hashes — fallback/starter values
// The setup-manifest script will fetch the latest from the API
const RAID_DEFINITIONS: Record<string, RaidDefinition> = {
    pantheon_insurrection_prime_revolutionary: {
        name: "Pantheon: Insurrection Prime Revolutionary",
        slug: 'pantheon-insurrection-prime-revolutionary',
        hashes: { 747671496: 'normal' },
    },
    pantheon_calus_resplendent: {
        name: "Pantheon: Calus Resplendent",
        slug: 'pantheon-calus-resplendent',
        hashes: { 1516551982: 'normal' },
    },
    the_desert_perpetual: {
        name: "The Desert Perpetual",
        slug: 'the-desert-perpetual',
        hashes: { 2586252122: 'epic', 1044919065: 'normal', 3896382790: 'normal', 3817322389: 'epic' },
    },
    salvations_edge: {
        name: "Salvation's Edge",
        slug: 'salvations-edge',
        hashes: { 2192826039: 'normal', 940375169: 'normal', 1541433876: 'normal', 4129614942: 'master' },
    },
    crotas_end: {
        name: "Crota's End",
        slug: 'crotas-end',
        hashes: { 1566480315: 'normal', 1507509200: 'master', 4179289725: 'normal', 107319834: 'normal', 156253568: 'normal' },
    },
    root_of_nightmares: {
        name: 'Root of Nightmares',
        slug: 'root-of-nightmares',
        hashes: { 2381413764: 'normal', 2918919505: 'master' },
    },
    kings_fall: {
        name: "King's Fall",
        slug: 'kings-fall',
        hashes: { 1374392663: 'normal', 2964135793: 'master', 3257594522: 'master', 1063970578: 'normal', 2897223272: 'normal' },
    },
    vow_of_the_disciple: {
        name: 'Vow of the Disciple',
        slug: 'vow-of-the-disciple',
        hashes: { 2906950631: 'normal', 4156879541: 'normal', 4217492330: 'master', 1441982566: 'normal', 3889634515: 'master' },
    },
    vault_of_glass: {
        name: 'Vault of Glass',
        slug: 'vault-of-glass',
        hashes: { 3881495763: 'normal', 1681562271: 'master', 3022541210: 'master', 1485585878: 'normal', 3711931140: 'normal' },
    },
    deep_stone_crypt: {
        name: 'Deep Stone Crypt',
        slug: 'deep-stone-crypt',
        hashes: { 910380154: 'normal', 3976949817: 'normal' },
    },
    garden_of_salvation: {
        name: 'Garden of Salvation',
        slug: 'garden-of-salvation',
        hashes: { 2659723068: 'normal', 3458480158: 'normal', 1042180643: 'normal', 2497200493: 'normal', 3845997235: 'normal' },
    },
    last_wish: {
        name: 'Last Wish',
        slug: 'last-wish',
        hashes: { 2122313384: 'normal', 1661734046: 'normal', 2214608157: 'normal', 2214608156: 'normal' },
    },
    pantheon_morgeth_surpassing: {
        name: "Pantheon: Morgeth Surpassing",
        slug: 'pantheon-morgeth-surpassing',
        hashes: { 2530656885: 'normal' },
    },
};

const raidDefinitions: Record<string, RaidDefinition> = RAID_DEFINITIONS;
const hashToRaidMap: Map<number, string> = new Map();
const hashToDifficultyMap: Map<number, Difficulty> = new Map();

function buildHashMap() {
    hashToRaidMap.clear();
    hashToDifficultyMap.clear();
    for (const [key, raid] of Object.entries(raidDefinitions)) {
        for (const [hash, difficulty] of Object.entries(raid.hashes)) {
            hashToRaidMap.set(Number(hash), key);
            hashToDifficultyMap.set(Number(hash), difficulty);
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

/** Undefined for a hash in no raid definition. */
export function getDifficultyFromHash(hash: number): Difficulty | undefined {
    return hashToDifficultyMap.get(hash);
}

/** Every raid hash tagged with `difficulty`, across all raids. */
export function getHashesWithDifficulty(difficulty: Difficulty): number[] {
    return [...hashToDifficultyMap].filter(([, d]) => d === difficulty).map(([hash]) => hash);
}

/**
 * The raids that have a version at `difficulty`, in table order. Known ahead of time, so a raid
 * with no Master version is told apart from one with no Master clears in the window (#41).
 */
export function getRaidKeysWithDifficulty(difficulty: Difficulty): string[] {
    return Object.entries(raidDefinitions)
        .filter(([, raid]) => Object.values(raid.hashes).includes(difficulty))
        .map(([key]) => key);
}

export function getRaidNameFromHash(hash: number): string {
    const key = hashToRaidMap.get(hash);
    if (!key) return 'Unknown Raid';
    return raidDefinitions[key]?.name || 'Unknown Raid';
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
