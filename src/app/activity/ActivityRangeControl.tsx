import { ACTIVITY_RANGES } from './activity-range';
import { activityHref, type ActivityUrlState } from './activity-url';
import { ActivityLinkToggle } from './ActivityLinkToggle';

/**
 * The 24h / 7d / 30d presets above the Raid Activity chart (#195), as links
 * (./ActivityLinkToggle.tsx). Why the range is in the URL: ./activity-range.ts. The links
 * carry the raids the URL named (#198), so a range switch keeps the reader's comparison; with
 * none named they carry none, and each range picks its own top raids. They carry the scope
 * (#204) and the tab (#200) too: each link is the page's own URL state with its range changed.
 */
export function ActivityRangeControl({ state }: { state: ActivityUrlState }) {
    const items = ACTIVITY_RANGES.map(({ id, label }) => ({ id, label, href: activityHref({ ...state, range: id }) }));
    return <ActivityLinkToggle label="Range" testId="activity-range" items={items} current={state.range} />;
}
