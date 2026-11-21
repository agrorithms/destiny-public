import { ACTIVITY_SCOPES } from './activity-scope';
import { activityHref, type ActivityUrlState } from './activity-url';
import { ActivityLinkToggle } from './ActivityLinkToggle';

/**
 * The All · Fresh · Full Clears links under the Raid Activity range presets (#204): which raid
 * instances the chart counts (CONTEXT.md, **Scope**).
 *
 * Built like the range presets (./ActivityLinkToggle.tsx): each scope is a URL (`?scope=`,
 * written only when it isn't All Attempts), so a reload or a shared link counts the same runs.
 * They keep the range, the raids the URL named and the tab (#200): each link is the page's own
 * URL state with its scope changed. Each carries its one-sentence `title`; phones show none, so
 * the page's intro says the same in words.
 */
export function ActivityScopeControl({ state }: { state: ActivityUrlState }) {
    const items = ACTIVITY_SCOPES.map(({ id, label, title }) => ({ id, label, title, href: activityHref({ ...state, scope: id }) }));
    return <ActivityLinkToggle label="Scope" testId="activity-scope" items={items} current={state.scope} />;
}
