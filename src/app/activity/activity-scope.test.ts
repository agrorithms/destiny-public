import { describe, expect, it } from 'vitest';
import { ACTIVITY_SCOPES, parseActivityScope } from './activity-scope';

/**
 * The Raid Activity Scope (#204): which raid instances the chart counts — All Attempts, Fresh
 * Runs or Full Clears — kept in `?scope=` so a reload or a shared link counts the same runs.
 * Like the range, a link someone mangled still shows a chart (All Attempts) rather than an error,
 * and is not redirected. The labels, tooltips and intro sentences are the spec's wording, so
 * they are pinned word for word: phones show no `title`, and the intro is what tells a phone
 * reader which runs are counted.
 */

describe('reading the scope from the URL', () => {
    it('reads each scope by its spelling in the URL, and names the series it draws', () => {
        expect(parseActivityScope({ scope: 'all' })).toMatchObject({ id: 'all', key: 'allAttempts' });
        expect(parseActivityScope({ scope: 'fresh' })).toMatchObject({ id: 'fresh', key: 'freshRuns' });
        expect(parseActivityScope({ scope: 'full' })).toMatchObject({ id: 'full', key: 'fullClear' });
    });

    it('counts All Attempts when the URL has no scope, so every link from before #204 still means what it did', () => {
        expect(parseActivityScope({}).id).toBe('all');
        expect(parseActivityScope({ range: '30d' }).id).toBe('all');
    });

    it('reads an unknown, empty or differently spelled scope as All Attempts', () => {
        for (const scope of ['nonsense', '', 'Full', 'fullClear', ' fresh', 'full ']) {
            expect(parseActivityScope({ scope }).id, scope).toBe('all');
        }
    });

    it('reads a repeated scope as All Attempts, even with known values', () => {
        // `?scope=fresh&scope=full` names two populations; picking one would be a guess.
        expect(parseActivityScope({ scope: ['fresh', 'full'] }).id).toBe('all');
        expect(parseActivityScope({ scope: ['full'] }).id).toBe('all');
    });
});

describe('the scopes', () => {
    it('are All, Fresh and Full Clears, in that order, each narrower than the one before', () => {
        expect(ACTIVITY_SCOPES.map((scope) => [scope.id, scope.label])).toEqual([
            ['all', 'All'],
            ['fresh', 'Fresh'],
            ['full', 'Full Clears'],
        ]);
    });

    it('carry the spec\'s tooltip for each link', () => {
        expect(ACTIVITY_SCOPES.map((scope) => scope.title)).toEqual([
            'Every raid, checkpoints and unfinished runs included.',
            'Raids started at the first encounter, finished or not.',
            'Raids started at the first encounter that someone finished.',
        ]);
    });

    it('give the intro a second sentence for each, All Attempts\' unchanged from before #204', () => {
        expect(ACTIVITY_SCOPES.map((scope) => scope.intro)).toEqual([
            'Every raid instance counts, checkpoints and unfinished runs included.',
            'Only Fresh Runs count: raids started at the first encounter, finished or not.',
            'Only Full Clears count: raids started at the first encounter that someone finished.',
        ]);
    });
});
