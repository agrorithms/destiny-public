import type { RaidScopeStats, RaidStatsFrameRow } from '@/lib/db/queries';
import type { ActivityRange } from './activity-range';
import type { ActivityScopeOption } from './activity-scope';

export const MIN_STATS_SAMPLE = 0;

export interface StatsFigure {
    label: string;
    value: string;
}

export type ClearTimePanel = { kind: 'figures'; sample: string; figures: StatsFigure[] } | { kind: 'tooFew'; line: string };
export type ScopePanel = { kind: 'figures'; sample: string; figures: StatsFigure[]; classes: string } | { kind: 'tooFew'; line: string };

export interface RaidStatsCard {
    raidKey: string;
    name: string;
    clearTime: ClearTimePanel;
}

export type RaidStatsBoard = { kind: 'empty' } | { kind: 'cards'; cards: RaidStatsCard[] };

export function raidStatsBoard(_frame: readonly RaidStatsFrameRow[], _definitions: Record<string, { name: string }>): RaidStatsBoard {
    throw new Error('not implemented');
}

export function scopePanel(_stats: RaidScopeStats | undefined): ScopePanel {
    throw new Error('not implemented');
}

export function tooFewLine(_n: number): string {
    throw new Error('not implemented');
}

export function classLine(_distribution: Record<string, number>): string {
    throw new Error('not implemented');
}

export function statsScopeFor(_scope: ActivityScopeOption, _hoursBack: number): { shown: ActivityScopeOption; fullClearsOnly: boolean } {
    throw new Error('not implemented');
}

export function raidStatsIntro(_range: ActivityRange, _shown: ActivityScopeOption): string {
    throw new Error('not implemented');
}
