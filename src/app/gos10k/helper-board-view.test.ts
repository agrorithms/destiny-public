import { describe, expect, it } from 'vitest';
import {
    DEFAULT_HELPER_BOARD_VIEW,
    HELPER_BOARD_ANCHOR,
    helperBoardHref,
    parseHelperBoardView,
} from './helper-board-view';
import { parseArchiveRangeRequest } from '@/lib/db/archive/range';

/**
 * The Helper board's URL grammar (#90) — pure, so colocated rather than in tests/db/.
 *
 * Two properties are worth pinning here rather than in Chromium. The first is that an
 * unrecognised value renders the default view instead of throwing or rendering nothing:
 * this page degrades rather than erroring on every other parameter (#87), and the e2e
 * Archive canary depends on an unknown parameter being ignored. The second is that this
 * panel's own links carry the active range forward — a "show all" link that quietly
 * dropped the reader's filter would render a board of the whole Archive under a heading
 * saying otherwise, which is exactly the plausible-wrong-page this repo keeps catching.
 */

describe('reading the board view out of the URL', () => {
    it('defaults to time alongside him and the first page of rows', () => {
        expect(parseHelperBoardView({})).toEqual(DEFAULT_HELPER_BOARD_VIEW);
        expect(DEFAULT_HELPER_BOARD_VIEW).toEqual({ measure: 'withSubject', showAll: false });
    });

    it('reads both parameters', () => {
        expect(parseHelperBoardView({ helperTime: 'inRun', helperRows: 'all' })).toEqual({
            measure: 'inRun',
            showAll: true,
        });
    });

    it('degrades an unrecognised value to the default rather than erroring', () => {
        // The whole-page rule: a hand-edited or truncated link renders something, and
        // what it renders is the plain view.
        expect(parseHelperBoardView({ helperTime: 'seconds', helperRows: 'everything' })).toEqual(
            DEFAULT_HELPER_BOARD_VIEW
        );
        expect(parseHelperBoardView({ helperTime: '' })).toEqual(DEFAULT_HELPER_BOARD_VIEW);
    });

    it('ignores a repeated parameter, exactly as the range parser does', () => {
        // Not "first one wins". `range.ts` reads a repeated key as a hand-edited link
        // with no sensible answer and degrades, and both controls on this URL now share
        // its `singleSearchParam`. This test failed the first time it was written the
        // other way round, which is the point of having it: two parsers on one page
        // disagreeing about `?a=x&a=y` is a difference nothing else would surface.
        expect(parseHelperBoardView({ helperTime: ['inRun', 'withSubject'] })).toEqual(
            DEFAULT_HELPER_BOARD_VIEW
        );
        expect(parseHelperBoardView({ helperRows: ['all', 'all'] })).toEqual(
            DEFAULT_HELPER_BOARD_VIEW
        );
    });
});

describe('linking to a view of the board', () => {
    it('omits the defaults so a plain link stays plain', () => {
        expect(helperBoardHref({ kind: 'none' }, DEFAULT_HELPER_BOARD_VIEW)).toBe(
            `/gos10k?tab=rankings#${HELPER_BOARD_ANCHOR}`
        );
    });

    it('stays on the Rankings tab', () => {
        // The board lives on Rankings (#112). A link that dropped `tab` would land the
        // reader on Overview, where the board they just clicked is not rendered.
        const query = new URL(
            helperBoardHref({ kind: 'none' }, { measure: 'inRun', showAll: true }),
            'https://example.test'
        ).searchParams;

        expect(query.get('tab')).toBe('rankings');
    });

    it('carries the active range forward', () => {
        // The failure this exists for: a board link that writes only its own parameters
        // navigates to the unfiltered page, and the reader loses a filter they cannot
        // see they have lost.
        const request = parseArchiveRangeRequest({ clearFrom: '9001', clearTo: '10000' });

        expect(helperBoardHref(request, { measure: 'inRun', showAll: true })).toBe(
            `/gos10k?clearFrom=9001&clearTo=10000&tab=rankings&helperTime=inRun&helperRows=all#${HELPER_BOARD_ANCHOR}`
        );
    });

    it('writes nothing back for a range the URL did not actually describe', () => {
        // A malformed request resolves to the whole Archive, so its links must be the
        // whole Archive's — writing the broken parameters back would make the page keep
        // telling the reader their link was wrong every time they touched this panel.
        const malformed = parseArchiveRangeRequest({ from: '2022-02-01' });

        expect(malformed.kind).toBe('malformed');
        expect(helperBoardHref(malformed, { measure: 'inRun', showAll: false })).toBe(
            `/gos10k?tab=rankings&helperTime=inRun#${HELPER_BOARD_ANCHOR}`
        );
    });

    it('round-trips through the parser', () => {
        const view = { measure: 'inRun', showAll: true } as const;
        const href = helperBoardHref({ kind: 'none' }, view);
        const query = Object.fromEntries(new URL(href, 'https://example.test').searchParams);

        expect(parseHelperBoardView(query)).toEqual(view);
    });
});
