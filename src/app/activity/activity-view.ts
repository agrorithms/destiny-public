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

/**
 * Reads the tab out of the URL. Anything but one exact spelling — missing, unknown, or the key
 * repeated — is the chart, and is not redirected: the page drawn is the one a link with no
 * `view` draws, so every `/activity` link written before #200 still opens the chart.
 */
export function parseActivityView(searchParams: Record<string, string | string[] | undefined>): ActivityViewId {
    const value = searchParams[ACTIVITY_VIEW_PARAM];
    return ACTIVITY_VIEWS.find((view) => view.id === value)?.id ?? 'chart';
}
