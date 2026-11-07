import Link from 'next/link';
import { activityRangeHref, type ActivityRangeId } from './activity-range';
import { ACTIVITY_SCOPES, type ActivityScopeId } from './activity-scope';

/**
 * The All · Fresh · Full Clears links under the Raid Activity range presets (#204): which raid
 * instances the chart counts (CONTEXT.md, **Scope**).
 *
 * Links with `aria-current`, built like the range presets (./ActivityRangeControl.tsx): each
 * scope is a URL (`?scope=`, written only when it isn't All Attempts), so a reload or a shared
 * link counts the same runs, and with JavaScript off each one is a plain link. They keep the
 * range and the raids the URL named. Each carries its one-sentence `title`; phones show none,
 * so the page's intro says the same in words.
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
    return (
        <nav aria-label="Scope" data-testid="activity-scope">
            {/* No wrap and no scroll: three short labels fit a 360px phone on one row, and
                activity-scope.spec.ts fails if they stop doing so. */}
            <ul className="inline-flex overflow-hidden rounded-lg border ui-divider text-sm">
                {ACTIVITY_SCOPES.map(({ id, label, title }) => {
                    const active = id === scope;
                    return (
                        <li key={id} className="border-l ui-divider first:border-l-0">
                            <Link
                                href={activityRangeHref(range, raids, id)}
                                scroll={false}
                                title={title}
                                aria-current={active ? 'page' : undefined}
                                className={`block px-3 py-1.5 whitespace-nowrap transition-colors ${
                                    active ? 'ui-toggle-active' : 'ui-toggle-idle'
                                }`}
                            >
                                {label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
