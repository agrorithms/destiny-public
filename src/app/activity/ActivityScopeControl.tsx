import { activityRangeHref, type ActivityRangeId } from './activity-range';
import { ACTIVITY_SCOPES, type ActivityScopeId } from './activity-scope';
import { ActivityLinkToggle } from './ActivityLinkToggle';

/**
 * The All · Fresh · Full Clears links under the Raid Activity range presets (#204): which raid
 * instances the chart counts (CONTEXT.md, **Scope**).
 *
 * Built like the range presets (./ActivityLinkToggle.tsx): each scope is a URL (`?scope=`,
 * written only when it isn't All Attempts), so a reload or a shared link counts the same runs.
 * They keep the range and the raids the URL named. Each carries its one-sentence `title`;
 * phones show none, so the page's intro says the same in words.
 */
export function ActivityScopeControl({
    scope,
    range,
    raids,
}: {
    scope: ActivityScopeId;
    range: ActivityRangeId;
    raids: readonly string[];
}) {
    const items = ACTIVITY_SCOPES.map(({ id, label, title }) => ({ id, label, title, href: activityRangeHref(range, raids, id) }));
    return <ActivityLinkToggle label="Scope" testId="activity-scope" items={items} current={scope} />;
}
