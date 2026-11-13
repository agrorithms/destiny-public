import { activityHref, type ActivityUrlState } from './activity-url';
import { ACTIVITY_VIEWS } from './activity-view';
import { ActivityLinkToggle } from './ActivityLinkToggle';

/**
 * The Raid Activity page's tabs (#200): **Raids in Progress**, the chart, and **Raid Stats**, as
 * links above the range presets (./ActivityLinkToggle.tsx), so each tab is a URL (`?view=stats`,
 * ./activity-view.ts) that works with JavaScript off and survives a reload. A tab link keeps the
 * range and the scope and drops the raids: the stats tab draws none, and the chart tab opened from
 * it lands on the range's own top raids.
 */
export function ActivityViewControl({ state }: { state: ActivityUrlState }) {
    const items = ACTIVITY_VIEWS.map(({ id, label }) => ({ id, label, href: activityHref({ ...state, view: id, raids: [] }) }));
    return <ActivityLinkToggle label="View" testId="activity-view" items={items} current={state.view} />;
}
