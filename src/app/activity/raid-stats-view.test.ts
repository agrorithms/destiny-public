import { describe, expect, it } from 'vitest';
import type { RaidScopeStats, RaidStatsFrameRow } from '@/lib/db/queries';
import { ACTIVITY_RANGES } from './activity-range';
import { ACTIVITY_SCOPES } from './activity-scope';
import {
    MIN_STATS_SAMPLE,
    classLine,
    raidStatsBoard,
    raidStatsIntro,
    scopePanel,
    statsScopeFor,
    tooFewLine,
} from './raid-stats-view';

/**
 * The Raid Stats tab's view model (#200): which cards, in which order, what each panel says, and
 * which scope the tab shows. Pure, so Vitest and Stryker reach the decisions; the components only
 * lay out what this returns.
 */

const [ALL, FRESH, FULL] = ACTIVITY_SCOPES;
const [DAY, WEEK, MONTH] = ACTIVITY_RANGES;

function frameRow(raidKey: string, overrides: Partial<RaidStatsFrameRow> = {}): RaidStatsFrameRow {
    return {
        raidKey,
        fastestClearSeconds: 1500,
        clearTimeQuartiles: { p25: 1800, p50: 2400, p75: 3725 },
        fullClearCount: 3,
        dnfRate: 0.5,
        instanceCount: 6,
        ...overrides,
    };
}

function scopeStats(overrides: Partial<RaidScopeStats> = {}): RaidScopeStats {
    return {
        kda: { p25: 10, p50: 30.5, p75: 70 },
        aggregateKda: 41.25,
        sampleSize: 3,
        classDistribution: { Warlock: 2, Hunter: 1 },
        ...overrides,
    };
}

const DEFINITIONS = {
    salvations_edge: { name: "Salvation's Edge" },
    crotas_end: { name: "Crota's End" },
    last_wish: { name: 'Last Wish' },
};

describe('raidStatsBoard', () => {
    it('is the empty state when no raid has an instance in the window', () => {
        expect(raidStatsBoard([], DEFINITIONS)).toEqual({ kind: 'empty' });
    });

    it('has one card per raid in the frame, in the raid table\'s order, named from it', () => {
        const board = raidStatsBoard([frameRow('crotas_end'), frameRow('last_wish'), frameRow('salvations_edge')], DEFINITIONS);
        expect(board.kind === 'cards' && board.cards.map((card) => [card.raidKey, card.name])).toEqual([
            ['salvations_edge', "Salvation's Edge"],
            ['crotas_end', "Crota's End"],
            ['last_wish', 'Last Wish'],
        ]);
    });

    it('puts a raid the table doesn\'t name last, under its key, rather than dropping it', () => {
        const board = raidStatsBoard([frameRow('zz_unknown'), frameRow('last_wish')], DEFINITIONS);
        expect(board.kind === 'cards' && board.cards.map((card) => [card.raidKey, card.name])).toEqual([
            ['last_wish', 'Last Wish'],
            ['zz_unknown', 'zz_unknown'],
        ]);
    });

    it('shows Fastest, 25th, Median and 75th Clear Time, with the Full Clear count, from three Full Clears', () => {
        const board = raidStatsBoard([frameRow('last_wish')], DEFINITIONS);
        expect(board.kind === 'cards' && board.cards[0].clearTime).toEqual({
            kind: 'figures',
            sample: '3 Full Clears',
            figures: [
                { label: 'Fastest', value: '25:00' },
                { label: '25th', value: '30:00' },
                { label: 'Median', value: '40:00' },
                { label: '75th', value: '1:02:05' },
            ],
        });
    });

    it('says too few under three Full Clears, counting them', () => {
        const board = raidStatsBoard([frameRow('last_wish', { fullClearCount: 2 }), frameRow('crotas_end', {
            fullClearCount: 0,
            fastestClearSeconds: null,
            clearTimeQuartiles: null,
        })], DEFINITIONS);
        expect(board.kind === 'cards' && board.cards.map((card) => card.clearTime)).toEqual([
            { kind: 'tooFew', line: '0 runs, too few to show' },
            { kind: 'tooFew', line: '2 runs, too few to show' },
        ]);
    });
});

describe('a broken invariant reads as too few, never as empty figures', () => {
    it('a Clear Time panel with Full Clears counted but no quartiles', () => {
        const board = raidStatsBoard([frameRow('last_wish', { clearTimeQuartiles: null })], DEFINITIONS);
        expect(board.kind === 'cards' && board.cards[0].clearTime).toEqual({ kind: 'tooFew', line: '3 runs, too few to show' });
    });

    it('a scope with Player-Runs counted but no KDA, or no aggregate', () => {
        expect(scopePanel(scopeStats({ kda: null }))).toEqual({ kind: 'tooFew', line: '3 runs, too few to show' });
        expect(scopePanel(scopeStats({ aggregateKda: null }))).toEqual({ kind: 'tooFew', line: '3 runs, too few to show' });
    });
});

describe('sample sizes in the thousands', () => {
    it('are grouped, as the rest of the site prints a count', () => {
        const board = raidStatsBoard([frameRow('last_wish', { fullClearCount: 1234 })], DEFINITIONS);
        expect(board.kind === 'cards' && board.cards[0].clearTime).toMatchObject({ sample: '1,234 Full Clears' });
        expect(scopePanel(scopeStats({ sampleSize: 12345 }))).toMatchObject({ sample: '12,345 player-runs' });
    });
});

describe('scopePanel', () => {
    it('shows 25th, Median, 75th and Aggregate KDA to two places, the Player-Runs and the class line', () => {
        expect(scopePanel(scopeStats())).toEqual({
            kind: 'figures',
            sample: '3 player-runs',
            figures: [
                { label: '25th', value: '10.00' },
                { label: 'Median', value: '30.50' },
                { label: '75th', value: '70.00' },
                { label: 'Aggregate', value: '41.25' },
            ],
            classes: 'Warlock 66.7% · Hunter 33.3%',
        });
    });

    it('replaces KDA and Classes with one line under three Player-Runs', () => {
        expect(scopePanel(scopeStats({ sampleSize: 2 }))).toEqual({ kind: 'tooFew', line: '2 runs, too few to show' });
        expect(scopePanel(scopeStats({ sampleSize: MIN_STATS_SAMPLE }))).toMatchObject({ kind: 'figures' });
    });

    it('reads a raid the scope has nothing for as zero runs', () => {
        expect(scopePanel(undefined)).toEqual({ kind: 'tooFew', line: '0 runs, too few to show' });
        expect(scopePanel(scopeStats({ sampleSize: 0, kda: null, aggregateKda: null, classDistribution: {} }))).toEqual({
            kind: 'tooFew',
            line: '0 runs, too few to show',
        });
    });
});

describe('tooFewLine', () => {
    it('counts runs, one in the singular', () => {
        expect(tooFewLine(0)).toBe('0 runs, too few to show');
        expect(tooFewLine(1)).toBe('1 run, too few to show');
        expect(tooFewLine(2)).toBe('2 runs, too few to show');
    });

    it('is the threshold three', () => {
        expect(MIN_STATS_SAMPLE).toBe(3);
    });
});

// /gos10k's order (getClassDistribution): most first, a tie by name. Unknown is a share like any
// other when a raid has one, so the shares always cover the whole sample.
describe('classLine', () => {
    it('lists the classes most first, each as a share to one place', () => {
        expect(classLine({ Hunter: 2, Warlock: 7 })).toBe('Warlock 77.8% · Hunter 22.2%');
    });

    it('breaks a tie by name', () => {
        expect(classLine({ Warlock: 2, Titan: 1, Hunter: 1 })).toBe('Warlock 50% · Hunter 25% · Titan 25%');
    });

    it('keeps Unknown as a fourth share', () => {
        expect(classLine({ Warlock: 3, Hunter: 3, Titan: 3, Unknown: 1 })).toBe('Hunter 30% · Titan 30% · Warlock 30% · Unknown 10%');
    });
});

// The 30-day rule (ADR 0006, second 2026-11-07 amendment; #200): where a window computes only
// Full Clears, the tab shows Full Clears and one line replaces the scope links, whatever the scope
// (an accepted deviation from the spec, 2026-11-12). Read off isScopeComputed, not the range id.
describe('statsScopeFor', () => {
    it('shows the URL\'s scope where every scope is computed', () => {
        expect(statsScopeFor(ALL, 168)).toEqual({ shown: ALL, fullClearsOnly: false });
        expect(statsScopeFor(FRESH, 24)).toEqual({ shown: FRESH, fullClearsOnly: false });
        expect(statsScopeFor(FULL, 168)).toEqual({ shown: FULL, fullClearsOnly: false });
    });

    it('shows Full Clears, saying so, past 168 hours whatever the scope', () => {
        expect(statsScopeFor(ALL, 720)).toEqual({ shown: FULL, fullClearsOnly: true });
        expect(statsScopeFor(FRESH, 720)).toEqual({ shown: FULL, fullClearsOnly: true });
        expect(statsScopeFor(FULL, 720)).toEqual({ shown: FULL, fullClearsOnly: true });
        expect(statsScopeFor(ALL, 169)).toEqual({ shown: FULL, fullClearsOnly: true });
    });
});

describe('raidStatsIntro', () => {
    it('names the span, then the shown scope in #204\'s words', () => {
        expect(raidStatsIntro(WEEK, ALL)).toBe(
            'Clear times and KDA per raid over the last 7 days. Every raid instance counts, checkpoints and unfinished runs included.'
        );
        expect(raidStatsIntro(DAY, FRESH)).toBe(`Clear times and KDA per raid over the last 24 hours. ${FRESH.intro}`);
        expect(raidStatsIntro(MONTH, FULL)).toBe(`Clear times and KDA per raid over the last 30 days. ${FULL.intro}`);
    });
});
