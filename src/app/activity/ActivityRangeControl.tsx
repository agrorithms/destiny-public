import { ACTIVITY_RANGES, activityRangeHref, type ActivityRangeId } from './activity-range';
import type { ActivityScopeId } from './activity-scope';
import { ActivityLinkToggle } from './ActivityLinkToggle';

/**
 * The 24h / 7d / 30d presets above the Raid Activity chart (#195), as links
 * (./ActivityLinkToggle.tsx). Why the range is in the URL: ./activity-range.ts. The links
 * carry the raids the URL named (#198), so a range switch keeps the reader's comparison; with
 * none named they carry none, and each range picks its own top raids. They carry the scope
 * too (#204).
 */
export function ActivityRangeControl({
    range,
    raids,
    scope,
}: {
    range: ActivityRangeId;
    raids: readonly string[];
    scope: ActivityScopeId;
}) {
    const items = ACTIVITY_RANGES.map(({ id, label }) => ({ id, label, href: activityRangeHref(id, raids, scope) }));
    return <ActivityLinkToggle label="Range" testId="activity-range" items={items} current={range} />;
}
