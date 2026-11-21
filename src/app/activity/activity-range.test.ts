import { describe, expect, it } from 'vitest';
import { ACTIVITY_RANGES, DAY, HOUR, MINUTE, parseActivityRange, rangeOfSeries } from './activity-range';
import { activityHref } from './activity-url';

/**
 * The Raid Activity range presets (#195): which chart a URL asks for, and the links that
 * ask for each. The range lives in `?range=` so a reload or a shared link shows the same
 * chart, and a link someone mangled must still show one — the 7-day default — rather than
 * an error or an empty page.
 */

describe('reading the range from the URL', () => {
    it('reads each preset by its spelling in the URL', () => {
        expect(parseActivityRange({ range: '24h' }).id).toBe('24h');
        expect(parseActivityRange({ range: '7d' }).id).toBe('7d');
        expect(parseActivityRange({ range: '30d' }).id).toBe('30d');
    });

    it('opens on 7 days when the URL has no range', () => {
        // The default view: both the daily cycle and the weekday/weekend difference.
        expect(parseActivityRange({}).id).toBe('7d');
    });

    it('falls back to 7 days for an unknown, empty or differently spelled range', () => {
        // A bad link still shows a chart. Only the exact spellings the control writes count.
        for (const range of ['nonsense', '', '24H', '1d', ' 30d']) {
            expect(parseActivityRange({ range }).id, range).toBe('7d');
        }
    });

    it('falls back to 7 days when the range is repeated, even with known values', () => {
        // `?range=24h&range=30d` names two charts; picking one would be a guess.
        expect(parseActivityRange({ range: ['24h', '30d'] }).id).toBe('7d');
    });
});

describe('the presets', () => {
    it('steps 24 hours by 10 minutes, 7 days by the hour and 30 days by 3 hours', () => {
        // The ticket's step sizes, and so its window of 144, 168 and 240 steps.
        expect(ACTIVITY_RANGES.map((range) => [range.id, range.rangeSeconds, range.stepSeconds])).toEqual([
            ['24h', 86_400, 600],
            ['7d', 604_800, 3_600],
            ['30d', 2_592_000, 10_800],
        ]);
        expect(ACTIVITY_RANGES.map((range) => range.rangeSeconds / range.stepSeconds)).toEqual([144, 168, 240]);
    });

    it('links to each preset with its range spelled out, 7 days included', () => {
        // Every preset sets `?range=`, so the URL always says which chart it is — the
        // default too, rather than a bare /activity that depends on what the default is.
        expect(ACTIVITY_RANGES.map((range) => activityHref({ range: range.id, scope: 'all', raids: [], view: 'chart' }))).toEqual([
            '/activity?range=24h',
            '/activity?range=7d',
            '/activity?range=30d',
        ]);
    });
});

describe('the scope in a link (#204)', () => {
    it('leaves All Attempts out, so a link written before #204 and one written after say the same', () => {
        expect(activityHref({ range: '7d', scope: 'all', raids: [], view: 'chart' })).toBe('/activity?range=7d');
        expect(activityHref({ range: '24h', scope: 'all', raids: ['last_wish'], view: 'chart' })).toBe('/activity?range=24h&raids=last_wish');
    });

    it('writes a narrower scope after the range', () => {
        expect(activityHref({ range: '30d', scope: 'fresh', raids: [], view: 'chart' })).toBe('/activity?range=30d&scope=fresh');
        expect(activityHref({ range: '24h', scope: 'full', raids: [], view: 'chart' })).toBe('/activity?range=24h&scope=full');
    });

    it('keeps the raids, after the scope, when the link carries both', () => {
        // A range or scope switch keeps the reader's comparison.
        expect(activityHref({ range: '7d', scope: 'full', raids: ['last_wish', 'kings_fall'], view: 'chart' })).toBe(
            '/activity?range=7d&scope=full&raids=last_wish,kings_fall'
        );
    });
});

describe('the preset a series was built for', () => {
    // The chart words its caption and picks its ticks from the series it draws, so a
    // series and the range it is described as can never disagree (#195 review, S2).
    const NOW = 1_760_000_000;

    it('reads each preset back off its window and step', () => {
        for (const range of ACTIVITY_RANGES) {
            const series = { from: NOW - range.rangeSeconds, to: NOW, stepSeconds: range.stepSeconds };
            expect(rangeOfSeries(series).id, range.id).toBe(range.id);
        }
    });

    it('refuses a series whose window is one preset\'s and whose step is another\'s', () => {
        // 7 days at 10-minute steps: neither "Busiest hour" nor "Busiest 10 minutes" over
        // the last 7 days describes it truthfully.
        expect(() => rangeOfSeries({ from: NOW - 7 * DAY, to: NOW, stepSeconds: 10 * MINUTE })).toThrow();
        expect(() => rangeOfSeries({ from: NOW - DAY, to: NOW, stepSeconds: HOUR })).toThrow();
    });

    it('names the span and step it was given when it refuses', () => {
        // The error is a 500 on the page, so it has to say which series reached the chart:
        // the span and the step, in seconds, whatever the sentence around them.
        expect(() => rangeOfSeries({ from: NOW - DAY, to: NOW, stepSeconds: HOUR })).toThrow(/86400(?=.*3600)/);
    });

    it('refuses a series whose window is no preset\'s', () => {
        expect(() => rangeOfSeries({ from: NOW - 2 * DAY, to: NOW, stepSeconds: HOUR })).toThrow();
    });
});
