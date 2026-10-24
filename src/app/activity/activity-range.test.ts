import { describe, expect, it } from 'vitest';
import { ACTIVITY_RANGES, activityRangeHref, parseActivityRange } from './activity-range';

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
        expect(ACTIVITY_RANGES.map((range) => activityRangeHref(range.id))).toEqual([
            '/activity?range=24h',
            '/activity?range=7d',
            '/activity?range=30d',
        ]);
    });
});
