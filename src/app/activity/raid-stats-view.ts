/**
 * The Raid Stats tab's view model (#200): which cards the board has, in which order, what each
 * panel says, and which scope the tab shows. Pure, so Vitest and mutation testing reach every
 * decision; ./RaidStatsBoard.tsx only lays out what this returns.
 *
 * Imports `isScopeComputed` from the query module for the one rule about which scopes a window
 * computes; it runs no query, and only server components import this module.
 */

import { isScopeComputed, type RaidScopeStats, type RaidStatsFrameRow } from '@/lib/db/queries';
import { formatRunDuration } from '@/lib/utils/helpers';
import { formatShare } from '../gos10k/share-copy';
import type { ActivityRange } from './activity-range';
import { ACTIVITY_SCOPES, type ActivityScopeOption } from './activity-scope';

/**
 * Below this many in a sample the figures are replaced by a count (ADR 0006's Consequences): the
 * Full Clears behind a Clear Time panel, the Player-Runs behind KDA and Classes, which share it so
 * a card never shows classes from a sample its KDA was hidden for.
 */
export const MIN_STATS_SAMPLE = 3;

/** One labelled figure in a panel. */
export interface StatsFigure {
    label: string;
    value: string;
}

/** A Clear Time panel: its figures with the Full Clear count beside them, or too few to show. */
export type ClearTimePanel = { kind: 'figures'; sample: string; figures: StatsFigure[] } | { kind: 'tooFew'; line: string };

/** The scope's part of a card: KDA and the class line, or one line replacing both. */
export type ScopePanel =
    | { kind: 'figures'; sample: string; figures: StatsFigure[]; classes: string }
    | { kind: 'tooFew'; line: string };

/** A raid's card as far as the frame goes; the scope's part comes later (./RaidStatsBoard.tsx). */
export interface RaidStatsCard {
    raidKey: string;
    name: string;
    clearTime: ClearTimePanel;
}

export type RaidStatsBoard = { kind: 'empty' } | { kind: 'cards'; cards: RaidStatsCard[] };

/** "N runs, too few to show", the line that replaces a panel's figures below {@link MIN_STATS_SAMPLE}. */
export function tooFewLine(n: number): string {
    return `${n} ${n === 1 ? 'run' : 'runs'}, too few to show`;
}

/**
 * The board: a card for every raid with an instance in the window, in the raid table's order
 * (`definitions`, RAID_DEFINITIONS), or the empty state when there is none. A raid the table
 * doesn't name goes last under its key rather than vanishing.
 */
export function raidStatsBoard(frame: readonly RaidStatsFrameRow[], definitions: Record<string, { name: string }>): RaidStatsBoard {
    if (frame.length === 0) return { kind: 'empty' };
    const order = Object.keys(definitions);
    const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
    const cards = [...frame]
        .sort((a, b) => rank(a.raidKey) - rank(b.raidKey))
        .map((row) => ({ raidKey: row.raidKey, name: definitions[row.raidKey]?.name ?? row.raidKey, clearTime: clearTimePanel(row) }));
    return { kind: 'cards', cards };
}

/** Clear Time over the raid's Full Clears, whatever the scope (CONTEXT.md, Clear Time Quartiles). */
function clearTimePanel(row: RaidStatsFrameRow): ClearTimePanel {
    const quartiles = row.clearTimeQuartiles;
    // The query makes quartiles null only with no Full Clears; a row that broke that reads as too
    // few rather than as figures with nothing in them.
    if (row.fullClearCount < MIN_STATS_SAMPLE || quartiles === null) return { kind: 'tooFew', line: tooFewLine(row.fullClearCount) };
    return {
        kind: 'figures',
        sample: `${row.fullClearCount.toLocaleString('en-US')} Full Clears`,
        figures: [
            { label: 'Fastest', value: formatRunDuration(row.fastestClearSeconds) },
            { label: '25th', value: formatRunDuration(quartiles.p25) },
            { label: 'Median', value: formatRunDuration(quartiles.p50) },
            { label: '75th', value: formatRunDuration(quartiles.p75) },
        ],
    };
}

/**
 * KDA Quartiles, Aggregate KDA and the class line for one raid under the shown scope. `undefined`
 * is a raid with no Player-Runs in the scope, which the scope's map leaves out.
 */
export function scopePanel(stats: RaidScopeStats | undefined): ScopePanel {
    if (stats === undefined) return { kind: 'tooFew', line: tooFewLine(0) };
    const n = stats.sampleSize;
    // kda and aggregateKda are null only at sampleSize 0 (ADR 0006); a row that broke that reads
    // as too few rather than as figures with nothing in them.
    if (n < MIN_STATS_SAMPLE || stats.kda === null || stats.aggregateKda === null) return { kind: 'tooFew', line: tooFewLine(n) };
    return {
        kind: 'figures',
        sample: `${n.toLocaleString('en-US')} player-runs`,
        figures: [
            { label: '25th', value: stats.kda.p25.toFixed(2) },
            { label: 'Median', value: stats.kda.p50.toFixed(2) },
            { label: '75th', value: stats.kda.p75.toFixed(2) },
            { label: 'Aggregate', value: stats.aggregateKda.toFixed(2) },
        ],
        classes: classLine(stats.classDistribution),
    };
}

/**
 * The class split as one line of shares, in /gos10k's order (most first, a tie by name), counting
 * Player-Run rows. `Unknown` is a stored class and is a share like the others when a raid has
 * any, so the shares cover the whole sample. One decimal, through /gos10k's formatter, so a small
 * share doesn't print as nobody.
 */
export function classLine(distribution: Record<string, number>): string {
    const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
    return Object.entries(distribution)
        .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB))
        .map(([name, n]) => `${name} ${formatShare(n / total)}`)
        .join(' · ');
}

/**
 * The scope the tab shows for the URL's `scope` over `hoursBack`, and whether the window is one
 * that computes only Full Clears. There the tab shows Full Clears and one line replaces the scope
 * links, whatever the URL's scope; the URL keeps it, so the chart tab still does.
 */
export function statsScopeFor(scope: ActivityScopeOption, hoursBack: number): { shown: ActivityScopeOption; fullClearsOnly: boolean } {
    return {
        shown: isScopeComputed(scope.key, hoursBack) ? scope : FULL_CLEARS,
        fullClearsOnly: ACTIVITY_SCOPES.some((option) => !isScopeComputed(option.key, hoursBack)),
    };
}

const FULL_CLEARS = ACTIVITY_SCOPES.find((option) => option.key === 'fullClear')!;

/** The tab's intro: its span, then the shown scope in #204's own words. */
export function raidStatsIntro(range: ActivityRange, shown: ActivityScopeOption): string {
    return `Clear times and KDA per raid over the last ${range.span}. ${shown.intro}`;
}

/** What {@link peek} saw of a promise. */
export type Peeked<T> = { state: 'pending' } | { state: 'fulfilled'; value: T } | { state: 'rejected'; error: unknown };

export function peek<T>(_promise: Promise<T>): Promise<Peeked<T>> {
    throw new Error('not implemented');
}
