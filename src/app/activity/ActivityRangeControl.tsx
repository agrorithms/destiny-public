import Link from 'next/link';
import { ACTIVITY_RANGES, activityRangeHref, type ActivityRangeId } from './activity-range';

/**
 * The 24h / 7d / 30d presets above the Raid Activity chart (#195).
 *
 * Links with `aria-current`, like the leaderboard's and /gos10k's tabs: each preset is a
 * URL (`?range=`), so a reload or a shared link shows the same chart, and with JavaScript
 * off each one is a plain link the browser follows. With it on, Next's client navigation
 * re-renders the server component without a full reload, and `scroll={false}` keeps the
 * reader where they were. Why the range is in the URL: ./activity-range.ts.
 */
export function ActivityRangeControl({ range }: { range: ActivityRangeId }) {
    return (
        <nav aria-label="Range" data-testid="activity-range">
            {/* No wrap and no scroll: three short labels fit a 360px phone on one row, and
                activity.spec.ts fails if they stop doing so. */}
            <ul className="inline-flex overflow-hidden rounded-lg border ui-divider text-sm">
                {ACTIVITY_RANGES.map(({ id, label }) => {
                    const active = id === range;
                    return (
                        <li key={id} className="border-l ui-divider first:border-l-0">
                            <Link
                                href={activityRangeHref(id)}
                                scroll={false}
                                aria-current={active ? 'page' : undefined}
                                // The leaderboard's View toggle's warm tokens: the chosen preset
                                // filled with the accent, the others on the input surface.
                                className={`block px-3 py-1.5 tabular-nums transition-colors ${
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
