import { describe, expect, it } from 'vitest';
import { activityHref, cleanActivityHref, type ActivityUrlState } from './activity-url';

const CHART: ActivityUrlState = { range: '7d', scope: 'all', raids: [], view: 'chart' };
const STATS: ActivityUrlState = { ...CHART, view: 'stats' };

// #200: the tab is a URL choice like the others. Written only for the stats tab, so every link
// written before it still opens the chart.
describe('the tab in a link', () => {
    it('is left out for the chart and written as view=stats for the stats tab, after the scope', () => {
        expect(activityHref(CHART)).toBe('/activity?range=7d');
        expect(activityHref(STATS)).toBe('/activity?range=7d&view=stats');
        expect(activityHref({ ...STATS, range: '30d', scope: 'fresh' })).toBe('/activity?range=30d&scope=fresh&view=stats');
    });
});

// The page redirects a URL that says something other than what is drawn. On the stats tab no
// raids are drawn, so any `raids` goes; on the chart the #198 rule stands.
describe('cleanActivityHref', () => {
    it('sends a stats tab URL with raids to the same URL without them, range, scope and tab kept', () => {
        const state: ActivityUrlState = { range: '24h', scope: 'full', raids: [], view: 'stats' };
        expect(cleanActivityHref({ range: '24h', scope: 'full', view: 'stats', raids: 'last_wish' }, state)).toBe(
            '/activity?range=24h&scope=full&view=stats'
        );
        expect(cleanActivityHref({ view: 'stats', raids: '' }, STATS)).toBe('/activity?range=7d&view=stats');
    });

    it('leaves a stats tab URL with no raids alone', () => {
        expect(cleanActivityHref({ range: '7d', view: 'stats' }, STATS)).toBeNull();
    });

    it('keeps the chart rule: a clean raids is left alone, an unclean one is cleaned', () => {
        const picked: ActivityUrlState = { ...CHART, raids: ['last_wish'] };
        expect(cleanActivityHref({ range: '7d', raids: 'last_wish' }, picked)).toBeNull();
        expect(cleanActivityHref({ range: '7d' }, CHART)).toBeNull();
        expect(cleanActivityHref({ range: '7d', raids: 'last_wish,nope' }, picked)).toBe('/activity?range=7d&raids=last_wish');
    });
});
