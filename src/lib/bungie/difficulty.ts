/**
 * The Difficulty values (CONTEXT.md), on their own so client code can import them: manifest.ts,
 * which tags every raid hash with one, reaches `fs` and the Bungie client.
 */
export const DIFFICULTIES = ['normal', 'master', 'epic'] as const;

/** Which version of a Raid was played. Every hash in RAID_DEFINITIONS has exactly one. */
export type Difficulty = typeof DIFFICULTIES[number];

export function isDifficulty(value: string | null): value is Difficulty {
    return (DIFFICULTIES as readonly (string | null)[]).includes(value);
}
