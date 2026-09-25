import { describe, expect, it } from 'vitest';
import {
    ARCHIVE_TAB_PARAM,
    ARCHIVE_TABS,
    archiveTabHref,
    DEFAULT_ARCHIVE_TAB,
    parseArchiveTab,
} from './archive-tab';
import { parseArchiveRangeRequest } from '@/lib/db/archive/range';

/**
 * The page's tab grammar (#112) — pure, so colocated like ./helper-board-view.test.ts.
 *
 * Two properties are pinned here rather than in Chromium. An unrecognised or missing
 * `tab` is Overview, so the canonical `/gos10k` URL (and its unfurl) is unchanged and a
 * hand-edited link renders the default page rather than an error — the same rule the
 * range and the Helper board's parameters follow. And a tab link carries the range the
 * reader *asked for*, so switching tabs never silently drops or rewrites a filter.
 */

describe('reading the tab out of the URL', () => {
    it('is Overview when the URL says nothing', () => {
        expect(DEFAULT_ARCHIVE_TAB).toBe('overview');
        expect(parseArchiveTab({})).toBe('overview');
    });

    it('reads each tab by its URL spelling', () => {
        for (const tab of ARCHIVE_TABS) {
            expect(parseArchiveTab({ [ARCHIVE_TAB_PARAM]: tab.id })).toBe(tab.id);
        }
    });

    it('degrades an unrecognised or repeated value to Overview rather than erroring', () => {
        expect(parseArchiveTab({ tab: 'helpers' })).toBe('overview');
        expect(parseArchiveTab({ tab: '' })).toBe('overview');
        expect(parseArchiveTab({ tab: 'Rankings' })).toBe('overview');
        // Same answer as the range parser and the Helper board: a repeated key is a
        // hand-edited link, and there is no sensible first one.
        expect(parseArchiveTab({ tab: ['rankings', 'rankings'] })).toBe('overview');
    });
});

describe('linking to a tab', () => {
    it('writes no parameter for Overview, so the canonical URL stays plain', () => {
        expect(archiveTabHref({ kind: 'none' }, 'overview')).toBe('/gos10k');
    });

    it('carries the requested range, then the tab', () => {
        const clears = parseArchiveRangeRequest({ clearFrom: '103', clearTo: '143' });
        const dates = parseArchiveRangeRequest({ from: '2022-02-01', to: '2022-02-28' });

        expect(archiveTabHref(clears, 'rankings')).toBe('/gos10k?clearFrom=103&clearTo=143&tab=rankings');
        expect(archiveTabHref(dates, 'participants')).toBe(
            '/gos10k?from=2022-02-01&to=2022-02-28&tab=participants'
        );
        expect(archiveTabHref(clears, 'overview')).toBe('/gos10k?clearFrom=103&clearTo=143');
    });

    it('writes nothing back for a range the URL did not actually describe', () => {
        // A degraded range is shown as the whole Archive; a tab link that wrote the
        // broken parameters back would keep the "invalid range" notice on every tab.
        const malformed = parseArchiveRangeRequest({ from: '2022-02-01' });

        expect(archiveTabHref(malformed, 'rankings')).toBe('/gos10k?tab=rankings');
    });

    it('appends a panel\'s own parameters after the tab', () => {
        const extra = new URLSearchParams({ helperRows: 'all' });

        expect(archiveTabHref({ kind: 'none' }, 'rankings', extra)).toBe(
            '/gos10k?tab=rankings&helperRows=all'
        );
    });

    it('round-trips through the parser', () => {
        for (const tab of ARCHIVE_TABS) {
            const href = archiveTabHref({ kind: 'none' }, tab.id);
            const query = Object.fromEntries(new URL(href, 'https://example.test').searchParams);
            expect(parseArchiveTab(query)).toBe(tab.id);
        }
    });
});
