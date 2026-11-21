/**
 * Every choice the Raid Activity page keeps in its URL, and the one function that writes a
 * link from them (#200, the `/activity` half of #209). Each control — the range presets, the
 * scope links, the raid picker, the tab strip and the page's own redirect — reads the state
 * the page was drawn from and changes its one field, so adding a choice is a field here, not
 * a new positional argument on every link.
 *
 * Types and literals only, like the modules each choice comes from, so client code can
 * import it without pulling the database in.
 */

import { ACTIVITY_RAIDS_PARAM, isRaidsParamClean } from './activity-raids';
import { ACTIVITY_RANGE_PARAM, type ActivityRangeId } from './activity-range';
import { ACTIVITY_SCOPE_PARAM, type ActivityScopeId } from './activity-scope';
import { ACTIVITY_VIEW_PARAM, type ActivityViewId } from './activity-view';

/** What a Raid Activity URL says: which range, which scope, which raids and which tab. */
export interface ActivityUrlState {
    range: ActivityRangeId;
    scope: ActivityScopeId;
    /** The bottom panel's raids, in the URL's order; empty means the range's top raids. */
    raids: readonly string[];
    view: ActivityViewId;
}

/**
 * The link to `state`. The range is always spelled out, 7 days included, so every URL says
 * which chart it is. The scope is written only when it isn't All Attempts (#204) and the view
 * only for the stats tab (#200), so every link written before either still means what it did.
 * `raids` (#198) go last and only when there are some, so a link without any leaves the panel
 * on the range's own top raids; the keys are percent-encoded but not their commas, so a shared
 * link stays readable. The order is `?range=…&scope=…&view=…&raids=…`.
 */
export function activityHref({ range, scope, raids, view }: ActivityUrlState): string {
    const params = new URLSearchParams({ [ACTIVITY_RANGE_PARAM]: range });
    if (scope !== 'all') params.set(ACTIVITY_SCOPE_PARAM, scope);
    if (view !== 'chart') params.set(ACTIVITY_VIEW_PARAM, view);
    const base = `/activity?${params}`;
    return raids.length === 0 ? base : `${base}&${ACTIVITY_RAIDS_PARAM}=${raids.map(encodeURIComponent).join(',')}`;
}

/**
 * Where the page redirects a URL that says something other than what is drawn, or `null` to draw
 * it as it is: a `raids` that isn't exactly what was read from it (#198, {@link isRaidsParamClean}),
 * cleaned up with range, scope and tab kept. `state` is what the page read from the URL, and the
 * stats tab reads no raids, since it draws none (#200), so there any `raids` at all is redirected
 * away by the same rule. The redirect throws in Next, so the page calls this outside its try.
 */
export function cleanActivityHref(
    searchParams: Record<string, string | string[] | undefined>,
    state: ActivityUrlState
): string | null {
    return isRaidsParamClean(searchParams, state.raids) ? null : activityHref(state);
}
