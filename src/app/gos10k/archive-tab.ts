import {
    archiveRangeHref,
    singleSearchParam,
    type ArchiveRangeRequest,
} from '@/lib/db/archive/range';

/**
 * Which third of the page is showing (#112): Overview, Rankings or Participants.
 *
 * ## Why a URL parameter rather than client tabs
 *
 * The same three reasons as the Helper board's view state (./helper-board-view.ts): a
 * pasted link reproduces the tab, the page still ships no client JavaScript, and — the
 * reason that is specific to tabs — only the active tab's panels run their SQL. Client
 * tabs would render every panel and hide two thirds of them, so every request would pay
 * for queries nobody sees.
 *
 * The header, the range filter and the timeline sit above the tabs and show on every
 * one of them. The timeline is the filter's companion rather than an Overview panel, and
 * the range applies to every tab.
 *
 * ## No parameter is Overview, and so is anything unrecognised
 *
 * The canonical `/gos10k` URL and its unfurl are unchanged by the tabs, and `?tab=nope`
 * renders Overview exactly as a malformed range renders the whole Archive (#87).
 *
 * ## What each tab's links carry
 *
 * The range the reader *asked for* — the request, never the resolved range, for the
 * reason {@link archiveRangeHref} gives. Nothing else: a panel's own parameters (the
 * Helper board's show-all and time column) belong to the tab that panel is on, so they
 * are dropped when the reader leaves it.
 *
 * The range control has to carry the tab the other way, since its GET forms submit only
 * their own inputs; see ArchiveRangeFilter.
 */

/** The URL's spelling of the tab. Absent means Overview. */
export const ARCHIVE_TAB_PARAM = 'tab';

/**
 * One list, three uses: the type below, the recogniser, and the strip's render order.
 *
 * "Rankings" rather than "Helpers": all three panels on it are ranked lists, and
 * "Leaderboards" would collide with the Tracker's own Leaderboard. "Helper" stays the
 * glossary term and "Who helped most" stays that panel's heading.
 */
export const ARCHIVE_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'rankings', label: 'Rankings' },
    { id: 'participants', label: 'Participants' },
] as const;

export type ArchiveTab = (typeof ARCHIVE_TABS)[number]['id'];

export const DEFAULT_ARCHIVE_TAB: ArchiveTab = 'overview';

function isArchiveTab(value: string): value is ArchiveTab {
    return ARCHIVE_TABS.some((tab) => tab.id === value);
}

/**
 * Reads the tab out of the URL. Anything unrecognised is Overview.
 *
 * A repeated key goes through the range parser's {@link singleSearchParam}, for the
 * reason helper-board-view.ts gives: three parsers on one URL disagreeing about
 * `?tab=a&tab=b` is a difference nothing else would surface.
 */
export function parseArchiveTab(
    searchParams: Record<string, string | string[] | undefined>
): ArchiveTab {
    const tab = singleSearchParam(searchParams[ARCHIVE_TAB_PARAM]);
    return tab && isArchiveTab(tab) ? tab : DEFAULT_ARCHIVE_TAB;
}

/**
 * The `tab` parameter a URL needs to land on `tab`: nothing for Overview, so the
 * default page's links stay the shortest URL that produces them.
 */
export function archiveTabParams(tab: ArchiveTab): URLSearchParams {
    const params = new URLSearchParams();
    if (tab !== DEFAULT_ARCHIVE_TAB) params.set(ARCHIVE_TAB_PARAM, tab);
    return params;
}

/**
 * The link to `tab` under the reader's range, optionally with a panel's own parameters.
 *
 * Built on {@link archiveRangeHref} so the range's grammar keeps one owner. A shared
 * link reads range, then tab, then panel, however it was built.
 */
export function archiveTabHref(
    request: ArchiveRangeRequest,
    tab: ArchiveTab,
    extra?: URLSearchParams
): string {
    const params = archiveTabParams(tab);
    for (const [key, value] of extra ?? []) {
        params.append(key, value);
    }
    return archiveRangeHref(request, params);
}
