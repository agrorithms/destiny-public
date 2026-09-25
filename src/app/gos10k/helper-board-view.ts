import { singleSearchParam, type ArchiveRangeRequest } from '@/lib/db/archive/range';
import { archiveTabHref, type ArchiveTab } from './archive-tab';

/**
 * The Helper board's own two pieces of view state (#90): which time column is shown,
 * and whether the board is showing everyone.
 *
 * ## Why these are URL parameters rather than client state
 *
 * This page has had no client JavaScript in Phase 1. #87 made the range filter two GET
 * forms and put the mode translation on the server precisely so the browser-only
 * surface stayed small; #88's timeline is server-rendered SVG. The obvious reading of
 * "a toggle" is `'use client'` and a `useState`, and it was rejected for three reasons:
 *
 * 1. A pasted link reproduces the view exactly, which is #81's ninth user story and is
 *    what every other control on this page already does.
 * 2. Show-all cannot be client state without the server having sent every row anyway —
 *    several thousand rows of hidden markup on the default view, to save a navigation.
 *    Sending them only when asked is both smaller and simpler.
 * 3. The behaviour becomes assertable at the same seam as everything else. A `<Link>`
 *    that renders the other column is a server render this repo already knows how to
 *    test; a `useState` toggle is only observable in Chromium.
 *
 * The cost, stated plainly: switching the column is a page navigation rather than an
 * instant repaint, and on a `force-dynamic` route it re-runs the Rankings tab's SQL
 * (#112 stopped it re-running every panel's). The Helper board is the heaviest of
 * those — about 170ms against the unfiltered production Archive, a few milliseconds
 * for a narrow range. The board's ranking is by presence in either measure, so the
 * rows do not move underneath the reader when they switch.
 *
 * ## Unknown values degrade, they never throw
 *
 * `?helperTime=nonsense` renders the default column, exactly as a malformed range
 * renders the whole Archive (#87). The canary depends on this class of behaviour too:
 * `/gos10k?tab=rankings&canary=…` carries a parameter no parser recognises and must stay
 * the plain unfiltered Rankings tab.
 */

/** The URL's spelling of this panel's state. Never abbreviated at a call site. */
export const HELPER_BOARD_PARAMS = {
    /** Which time column is displayed. Absent means the default, `withSubject`. */
    time: 'helperTime',
    /** Present as `all` for the whole board. Absent means the first page of rows. */
    rows: 'helperRows',
} as const;

/**
 * Which reading of "presence in hours" the time column shows.
 *
 * `withSubject` is the default because it is the honest answer to "how much of this
 * history did they share with him", and because it is the metric Phase 3's profile
 * route consumes. `inRun` is the alternative offered so a reader can check whether the
 * two disagree — across the top of the board they very nearly do not, which is the
 * point of being able to look.
 */
export const HELPER_TIME_MEASURES = ['withSubject', 'inRun'] as const;

export type HelperTimeMeasure = (typeof HELPER_TIME_MEASURES)[number];

/**
 * One list, three uses: the type above, the recogniser below, and the order the two
 * toggle pills render in. They were three separate literals, which is three places to
 * add a third measure and two places to forget.
 */
function isHelperTimeMeasure(value: string): value is HelperTimeMeasure {
    return (HELPER_TIME_MEASURES as readonly string[]).includes(value);
}

/** The board's `id`, and the fragment every one of its own links ends at. */
export const HELPER_BOARD_ANCHOR = 'helpers';

/**
 * The tab the board is rendered on (#112), which every one of its links must land back
 * on. The page's own tab switch in page.tsx is what actually puts it there.
 */
export const HELPER_BOARD_TAB: ArchiveTab = 'rankings';

export interface HelperBoardView {
    measure: HelperTimeMeasure;
    /** The reader asked for every Helper rather than the first {@link HELPER_BOARD_ROWS}. */
    showAll: boolean;
}

export const DEFAULT_HELPER_BOARD_VIEW: HelperBoardView = {
    measure: 'withSubject',
    showAll: false,
};

/**
 * Reads the board's view out of the URL. Anything unrecognised is the default view.
 *
 * A repeated key is read through the range parser's own {@link singleSearchParam}, not
 * a local copy of it: a repeated parameter is a hand-edited link, `range.ts` answers
 * that with "there is no sensible first one wins", and two controls on the same URL
 * disagreeing about it is a difference no test would think to look for. This file did
 * briefly hold a same-named helper that took `value[0]` instead.
 */
export function parseHelperBoardView(
    searchParams: Record<string, string | string[] | undefined>
): HelperBoardView {
    const measure = singleSearchParam(searchParams[HELPER_BOARD_PARAMS.time]);
    const rows = singleSearchParam(searchParams[HELPER_BOARD_PARAMS.rows]);

    return {
        measure:
            measure && isHelperTimeMeasure(measure)
                ? measure
                : DEFAULT_HELPER_BOARD_VIEW.measure,
        showAll: rows === 'all',
    };
}

/**
 * The link that reaches a view of this board **without losing the active range or the
 * Rankings tab** the board lives on (#112).
 *
 * Built on top of {@link archiveTabHref} rather than beside it: the range's URL
 * grammar has one owner, and a second place spelling out `from`/`to`/`clearFrom`/
 * `clearTo` is how a "show all" link quietly drops the reader's filter. The range
 * request is passed through rather than the resolved range, because a request is what
 * the URL said — a resolved range that degraded would otherwise be written back into
 * the link as though the reader had asked for it.
 *
 * Default values are omitted from the query string, so the plain board's own links are
 * the shortest URL that produces them and `?helperTime=withSubject` never appears in a
 * shared address. `tab=rankings` is always written: the board is not on Overview.
 *
 * Every link ends at the board's own anchor. Without it, switching a column two thirds
 * of the way down a long page returns the reader to the headline, which reads as the
 * click having done something else entirely.
 */
export function helperBoardHref(
    request: ArchiveRangeRequest,
    view: HelperBoardView
): string {
    const params = new URLSearchParams();

    if (view.measure !== DEFAULT_HELPER_BOARD_VIEW.measure) {
        params.set(HELPER_BOARD_PARAMS.time, view.measure);
    }
    if (view.showAll) {
        params.set(HELPER_BOARD_PARAMS.rows, 'all');
    }

    return `${archiveTabHref(request, HELPER_BOARD_TAB, params)}#${HELPER_BOARD_ANCHOR}`;
}
