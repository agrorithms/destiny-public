import Link from 'next/link';

/** One link in an {@link ActivityLinkToggle}. */
export interface ActivityLinkToggleItem {
    id: string;
    label: string;
    href: string;
    /** A one-sentence tooltip, for a mouse; phones show none. */
    title?: string;
}

/**
 * A row of links above the Raid Activity chart, one of them current: the range presets
 * (./ActivityRangeControl.tsx, #195) and the scope links (./ActivityScopeControl.tsx, #204).
 *
 * Links with `aria-current`, like the leaderboard's and /gos10k's tabs: each choice is a URL,
 * so a reload or a shared link shows the same chart, and with JavaScript off each one is a
 * plain link the browser follows. With it on, Next's client navigation re-renders the server
 * component without a full reload, and `scroll={false}` keeps the reader where they were.
 */
export function ActivityLinkToggle({
    label,
    testId,
    items,
    current,
}: {
    /** The `nav`'s accessible name. */
    label: string;
    testId: string;
    items: readonly ActivityLinkToggleItem[];
    /** The id of the item the page shows. */
    current: string;
}) {
    return (
        <nav aria-label={label} data-testid={testId}>
            {/* No wrap and no scroll: each row's three short labels fit a 360px phone on one
                row, and activity.spec.ts and activity-scope.spec.ts fail if they stop doing so. */}
            <ul className="inline-flex overflow-hidden rounded-lg border ui-divider text-sm">
                {items.map(({ id, label: text, href, title }) => {
                    const active = id === current;
                    return (
                        <li key={id} className="border-l ui-divider first:border-l-0">
                            <Link
                                href={href}
                                scroll={false}
                                title={title}
                                aria-current={active ? 'page' : undefined}
                                // The leaderboard's View toggle's warm tokens: the chosen link
                                // filled with the accent, the others on the input surface.
                                className={`block px-3 py-1.5 whitespace-nowrap tabular-nums transition-colors ${
                                    active ? 'ui-toggle-active' : 'ui-toggle-idle'
                                }`}
                            >
                                {text}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
