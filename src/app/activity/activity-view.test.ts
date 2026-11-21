import { describe, expect, it } from 'vitest';
import { ACTIVITY_VIEWS, parseActivityView } from './activity-view';

// The Raid Activity page's tabs (#200): `?view=stats` is the Raid Stats tab; anything else is the
// chart, with no redirect, as `range` and `scope` read a bad value.
describe('parseActivityView', () => {
    it('reads stats as the Raid Stats tab', () => {
        expect(parseActivityView({ view: 'stats' })).toBe('stats');
    });

    it('reads the chart when the key is absent, unknown, repeated or the chart spelled out', () => {
        expect(parseActivityView({})).toBe('chart');
        expect(parseActivityView({ view: 'Stats' })).toBe('chart');
        expect(parseActivityView({ view: ['stats', 'stats'] })).toBe('chart');
        expect(parseActivityView({ view: 'chart' })).toBe('chart');
    });

    it('labels the tabs Raids in Progress and Raid Stats, the chart first', () => {
        expect(ACTIVITY_VIEWS.map((view) => [view.id, view.label])).toEqual([
            ['chart', 'Raids in Progress'],
            ['stats', 'Raid Stats'],
        ]);
    });
});
