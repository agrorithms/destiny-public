import { beforeEach, describe, expect, it, vi } from 'vitest';

type Manifest = typeof import('./manifest');

/**
 * Difficulty is a property of the activity hash (#41): each version of a raid has its own hash,
 * and `RAID_DEFINITIONS` tags every one of them. These tests pin the tags against the labels in
 * `data/manifest-cache.json` (2026-06-18), so a retag is a deliberate edit here as well as there.
 *
 * Expected values are written out by hand from those labels rather than read back from the table,
 * so a test can disagree with the table.
 *
 * The module is imported afresh before every test, not once at the top. The table and the
 * hash→Difficulty map are built while the module loads, so a test that only calls the lookups
 * on an already-loaded module can never see a mistagged hash; mutation testing proved it (a tag
 * blanked to "" survived every test). Loading it inside each test is what lets a wrong tag fail.
 */
let manifest: Manifest;

beforeEach(async () => {
    vi.resetModules();
    manifest = await import('./manifest');
});

const getAllRaidDefinitions: Manifest['getAllRaidDefinitions'] = () => manifest.getAllRaidDefinitions();
const getDifficultyFromHash: Manifest['getDifficultyFromHash'] = (hash) => manifest.getDifficultyFromHash(hash);
const getHashesWithDifficulty: Manifest['getHashesWithDifficulty'] = (d) => manifest.getHashesWithDifficulty(d);
const getRaidKeysWithDifficulty: Manifest['getRaidKeysWithDifficulty'] = (d) => manifest.getRaidKeysWithDifficulty(d);

/** Every hash Bungie labels "Master". */
const MASTER_HASHES = [
    4129614942, // Salvation's Edge: Master
    1507509200, // Crota's End: Master
    2918919505, // Root of Nightmares: Master
    2964135793, // King's Fall: Master
    3257594522, // King's Fall: Master
    4217492330, // Vow of the Disciple: Master
    3889634515, // Vow of the Disciple: Master
    1681562271, // Vault of Glass: Master
    3022541210, // Vault of Glass: Master
];

/** Every hash Bungie labels "Epic": The Desert Perpetual only. */
const EPIC_HASHES = [
    2586252122, // The Desert Perpetual (Epic): Contest
    3817322389, // The Desert Perpetual (Epic): Standard
];

/**
 * Labels that sound like a hard mode but are neither Master nor Epic, so they are Normal
 * (decision 2). If prod shows one of them is a real hard mode, retagging it is a one-line edit.
 */
const DOUBTFUL_NORMAL_HASHES = [
    1063970578, // King's Fall: Expert
    156253568, // Crota's End: Legend
    4156879541, // Vow of the Disciple: Legend
    1485585878, // Vault of Glass: Challenge Mode
    3896382790, // The Desert Perpetual: Contest
    3711931140, // Vault of Glass (unlabelled)
];

function allTableHashes(): number[] {
    return Object.values(getAllRaidDefinitions()).flatMap((raid) => Object.keys(raid.hashes).map(Number));
}

function sorted<T>(values: T[]): T[] {
    return [...values].sort();
}

describe('the Difficulty of an activity hash', () => {
    it.each(MASTER_HASHES)('%i is Master', (hash) => {
        expect(getDifficultyFromHash(hash)).toBe('master');
    });

    it.each(EPIC_HASHES)('%i is Epic', (hash) => {
        expect(getDifficultyFromHash(hash)).toBe('epic');
    });

    it.each(DOUBTFUL_NORMAL_HASHES)('%i, labelled neither Master nor Epic, is Normal', (hash) => {
        expect(getDifficultyFromHash(hash)).toBe('normal');
    });

    it('a hash in no raid definition has no Difficulty', () => {
        expect(getDifficultyFromHash(1)).toBeUndefined();
    });

    it('every hash in the table appears once, under one raid, with one Difficulty', () => {
        const hashes = allTableHashes();

        expect(new Set(hashes).size).toBe(hashes.length);
        for (const hash of hashes) {
            expect(['normal', 'master', 'epic']).toContain(getDifficultyFromHash(hash));
        }
    });

    it('the Master and Epic hashes are exactly the labelled ones, and every other hash is Normal', () => {
        expect(sorted(getHashesWithDifficulty('master'))).toEqual(sorted(MASTER_HASHES));
        expect(sorted(getHashesWithDifficulty('epic'))).toEqual(sorted(EPIC_HASHES));

        const tagged = new Set([...MASTER_HASHES, ...EPIC_HASHES]);
        expect(sorted(getHashesWithDifficulty('normal'))).toEqual(sorted(allTableHashes().filter((h) => !tagged.has(h))));
    });
});

describe('the raid of an activity hash', () => {
    it('every version of a raid, Master and Epic included, still resolves to that raid', () => {
        // Retagging must not cost a hash its raid: raid_key is what groups every version under
        // one card (decision 5).
        expect(manifest.getRaidKeyFromHash(1681562271)).toBe('vault_of_glass');
        expect(manifest.getRaidKeyFromHash(3817322389)).toBe('the_desert_perpetual');
        for (const [key, raid] of Object.entries(getAllRaidDefinitions())) {
            for (const hash of Object.keys(raid.hashes).map(Number)) {
                expect(manifest.getRaidKeyFromHash(hash)).toBe(key);
            }
        }
    });
});

describe('which raids have a version at a Difficulty', () => {
    it('Master leaves out DSC, Garden, Last Wish, the Pantheons and The Desert Perpetual', () => {
        expect(sorted(getRaidKeysWithDifficulty('master'))).toEqual(sorted([
            'salvations_edge',
            'crotas_end',
            'root_of_nightmares',
            'kings_fall',
            'vow_of_the_disciple',
            'vault_of_glass',
        ]));
    });

    it('Epic is The Desert Perpetual alone', () => {
        expect(getRaidKeysWithDifficulty('epic')).toEqual(['the_desert_perpetual']);
    });

    it('every raid has a Normal version', () => {
        expect(sorted(getRaidKeysWithDifficulty('normal'))).toEqual(sorted(Object.keys(getAllRaidDefinitions())));
    });
});
