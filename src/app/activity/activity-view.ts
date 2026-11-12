/**
 * The Raid Activity page's two tabs (#200): **Raids in Progress**, the chart, and **Raid
 * Stats**, one card per raid. Kept in `?view=`, like `?range=` and `?scope=`, so a reload or
 * a shared link opens the same tab.
 *
 * Types and literals only, so the page and the controls can import it without pulling the
 * database onto a client path.
 */

/** The URL's spelling of the tab. Absent means the chart. */
export const ACTIVITY_VIEW_PARAM = 'view';

/** One list, two uses: the recogniser and the tab strip's order and labels. */
export const ACTIVITY_VIEWS = [
    { id: 'chart', label: 'Raids in Progress' },
    { id: 'stats', label: 'Raid Stats' },
] as const;

export type ActivityViewId = (typeof ACTIVITY_VIEWS)[number]['id'];
