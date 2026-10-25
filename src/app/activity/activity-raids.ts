import { ACTIVITY_RAIDS_PARAM } from './activity-range';

/**
 * Which raids the Raid Activity chart's bottom panel draws (#198, parent #51): the ones in
 * `?raids=`, kept to five, and when the URL names none the raids with the most activity in
 * the chosen range. Kept in the URL, like `?range=` (./activity-range.ts), so a shared link
 * shows the same comparison, and a bad one falls back to the default rather than to an error.
 *
 * Pure, and takes the known raid keys as an argument rather than importing the definitions:
 * the picker and the chart are client code, and the raid table lives with the Bungie manifest.
 */

/** The most raids the panel draws: past five the lines can no longer be told apart by colour. */
export const MAX_RAIDS = 5;

/**
 * The raid keys in the URL, in its order: unknown ones and empty segments dropped, each raid
 * once, then no more than {@link MAX_RAIDS} of what is left. Empty — the default applies —
 * when the key is missing, repeated, or has nothing valid in it.
 */
export function parseActivityRaids(
    searchParams: Record<string, string | string[] | undefined>,
    knownKeys: readonly string[]
): string[] {
    const value = searchParams[ACTIVITY_RAIDS_PARAM];
    if (typeof value !== 'string') return [];
    const kept = new Set(value.split(',').filter((key) => knownKeys.includes(key)));
    return [...kept].slice(0, MAX_RAIDS);
}

/**
 * The raids to draw: the URL's when it names any, else the range's top raids that have a
 * name to show. Empty when no raid ran in the range.
 */
export function pickRaids(urlKeys: readonly string[], topRaids: readonly string[], knownKeys: readonly string[]): string[] {
    return urlKeys.length > 0 ? [...urlKeys] : topRaids.filter((key) => knownKeys.includes(key));
}

/**
 * The line colour of the raid at `index` in the picked list: one series token per position
 * (`--ui-series-1` to `-5`, src/app/globals.css), so the colours come from the list and not
 * from the raid. Wraps past the fifth, which the cap never reaches.
 */
export function raidColour(index: number): string {
    return `var(--ui-series-${(index % MAX_RAIDS) + 1})`;
}
