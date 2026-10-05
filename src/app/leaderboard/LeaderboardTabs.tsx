import Link from 'next/link';
import { LEADERBOARD_BOARDS, leaderboardBoardHref, type LeaderboardBoard } from './leaderboard-board';

/**
 * The Full Clears / Fastest Clears strip (#130).
 *
 * Links with `aria-current` rather than an ARIA tablist, as on /gos10k (ArchiveTabs):
 * each tab is a URL, so Tab reaches each one and Enter follows it. Next's client
 * navigation means switching updates the URL without a full reload, and `scroll={false}`
 * keeps the reader where they were. Why the tab is in the URL: ./leaderboard-board.ts.
 */
export function LeaderboardTabs({ board }: { board: LeaderboardBoard }) {
    return (
        <nav aria-label="Leaderboards" data-testid="leaderboard-tabs" className="border-b ui-divider mb-4">
            {/* No wrap and no scroll: two short labels fit a 360px phone on one row,
                and leaderboard-fastest.spec.ts fails if they stop doing so. */}
            <ul className="flex">
                {LEADERBOARD_BOARDS.map(({ id, label }) => {
                    const active = id === board;
                    return (
                        <li key={id}>
                            <Link
                                href={leaderboardBoardHref(id)}
                                scroll={false}
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
