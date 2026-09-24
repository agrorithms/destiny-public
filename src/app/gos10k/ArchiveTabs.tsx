import Link from 'next/link';
import type { ArchiveRangeRequest } from '@/lib/db/archive/range';
import { ARCHIVE_TABS, archiveTabHref, type ArchiveTab } from './archive-tab';

/**
 * The strip between the timeline and the panels (#112).
 *
 * Links with `aria-current` rather than an ARIA tablist: each tab is a URL, and a
 * tablist promises arrow-key switching between panels already in the document, which
 * this page deliberately does not render. The reasoning for URL tabs is in
 * ./archive-tab.ts.
 *
 * Every link carries the range the reader asked for and nothing else, so the Helper
 * board's own parameters are dropped when the reader leaves Rankings.
 */
export function ArchiveTabs({
    tab,
    request,
}: {
    tab: ArchiveTab;
    /** What the URL asked for, so switching tabs keeps the reader's range. */
    request: ArchiveRangeRequest;
}) {
    return (
        <nav aria-label="Archive sections" data-testid="archive-tabs" className="border-b ui-divider">
            {/* No wrap and no scroll: three short labels fit a 360px phone on one row,
                and gos10k-tabs.spec.ts fails if one is added that does not. */}
            <ul className="flex">
                {ARCHIVE_TABS.map(({ id, label }) => {
                    const active = id === tab;
                    return (
                        <li key={id}>
                            <Link
                                href={archiveTabHref(request, id)}
                                aria-current={active ? 'page' : undefined}
                                // `-mb-px` sets the active underline over the strip's own
                                // border, so it reads as one line with a highlighted part.
                                className={`-mb-px block border-b-2 px-3 py-2 text-sm font-medium sm:px-4 ${
                                    active
                                        ? 'border-current ui-accent-text'
                                        : 'border-transparent ui-text-secondary'
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
