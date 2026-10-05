'use client';

import { useId } from 'react';
import { formatRunDuration } from '@/lib/utils/helpers';

/** Which number the right-hand column shows: a Full Clears count, or a Clear Time. */
export type LeaderboardMetric = 'completions' | 'clearTime';

/** Live movement, set on a row by the page before it is drawn. Both tabs carry it. */
export interface RowMovement {
    /** Rank change vs when the viewer opened the page (positive = moved up). */
    rankDelta?: number;
    /** Entered the board mid-session and hasn't changed rank since. */
    isNew?: boolean;
    /** Set when this row's rank or board value changed on a refresh; bumping it re-triggers the flash. */
    changeStamp?: number;
}

interface LeaderboardEntry extends RowMovement {
    membershipId: string;
    membershipType: number;
    displayName: string;
    /** Set on the Full Clears board. */
    completions?: number;
    /** Set on the Fastest Clears board, in seconds. */
    clearTimeSeconds?: number;
    /** Fastest Clears: the run that set the Clear Time, for its raid.report link. */
    instanceId?: string;
    /** Fastest Clears: when that run ended, unix seconds, for the date tooltip. */
    endedAt?: number;
    /** Competition rank from the server (ties share a rank number). */
    rank: number;
}

let runEndFormat: Intl.DateTimeFormat | undefined;

/**
 * A run's end as a date and time in the viewer's own zone and locale, e.g.
 * `4 Oct 2026, 16:56`. Call it only on the client, or the server's zone is drawn.
 *
 * One shared formatter, built on first use: `toLocaleString` with options builds a new
 * `Intl.DateTimeFormat` per call, which across a full Fastest Clears page (#133) is
 * tens of milliseconds a render.
 */
function formatRunEnd(unix: number): string {
    runEndFormat ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return runEndFormat.format(unix * 1000);
}

/**
 * The Clear Time as a link to the run on raid.report, with when it ended as a tooltip,
 * so the row stays as wide as it was (#133). A bare `title` would not show on keyboard
 * focus. The date is drawn in the viewer's zone: callers pass only client-fetched rows,
 * so this never renders on the server and can't mismatch on hydration.
 */
function ClearTimeLink({ entry }: { entry: LeaderboardEntry }) {
    const tooltipId = useId();
    return (
        <>
            <a
                href={`https://raid.report/pgcr/${entry.instanceId}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-describedby={tooltipId}
                className="peer hover:text-blue-600 transition-colors dark:hover:text-blue-400"
            >
                {formatRunDuration(entry.clearTimeSeconds)}
                {/* Hidden text, not an aria-label, so the time stays in the link's name. */}
                <span className="sr-only"> on raid.report, opens in a new tab</span>
            </a>
            {/* Above the cell, not below: the table's wrapper clips overflow, and above
                the first row is the header. */}
            <span
                id={tooltipId}
                role="tooltip"
                className="ui-card ui-text-primary pointer-events-none absolute bottom-full right-1.5 sm:right-2 z-10 hidden w-max rounded-md border px-2 py-0.5 font-sans text-xs font-normal shadow-sm peer-hover:block peer-focus-visible:block"
            >
                {entry.endedAt === undefined ? '' : formatRunEnd(entry.endedAt)}
            </span>
        </>
    );
}

interface LeaderboardTableProps {
    entries: LeaderboardEntry[];
    loading?: boolean;
    title?: string;
    showRaidColumn?: boolean;
    raidName?: string;
    metric?: LeaderboardMetric;
}

export default function LeaderboardTable({
    entries,
    loading = false,
    title,
    showRaidColumn = false,
    raidName,
    metric = 'completions',
}: LeaderboardTableProps) {
    const isClearTime = metric === 'clearTime';

    if (loading) {
        return (
            <div className="space-y-2">
                {title && <h3 className="text-lg font-bold ui-text-primary mb-3">{title}</h3>}
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-10 ui-skeleton rounded animate-pulse" />
                ))}
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="text-center py-12 ui-text-muted">
                {title && <h3 className="text-lg font-bold ui-text-primary mb-3">{title}</h3>}
                <p className="text-lg">{isClearTime ? 'No Completions match these filters' : 'No completions found'}</p>
                <p className="text-sm mt-1">
                    {isClearTime ? 'Try a longer time range or a different Players filter' : 'Try adjusting the time range or raid filter'}
                </p>
            </div>
        );
    }

    return (
        <div>
            {title && <h3 className="text-lg font-bold ui-text-primary mb-3">{title}</h3>}
            <div className="overflow-hidden">
                <table className="w-full table-fixed text-sm">
                    <colgroup>
                        <col className="w-[2.25rem] sm:w-10" />
                        {/* Rank-change badges get a permanently reserved slot so appearing
                            badges never push other columns out of alignment. */}
                        <col className="w-6 sm:w-7" />
                        <col />
                        {showRaidColumn && <col className="w-[5.5rem] sm:w-28" />}
                        {/* Wider for a Clear Time: the "Clear Time" heading and an
                            "1:23:45" both outgrow the Clears column. */}
                        <col className={isClearTime ? 'w-[5.5rem] sm:w-24' : 'w-[4.25rem] sm:w-20'} />
                    </colgroup>
                    <thead>
                        <tr className="border-b ui-divider ui-text-muted">
                            <th className="text-center py-1 pl-1.25 pr-0.5 sm:pl-1 sm:pr-0.5">#</th>
                            <th className="py-1 pl-0 pr-1 text-center">
                                <span className="sr-only">Rank change</span>
                            </th>
                            <th className="text-left py-1 pl-0.5 pr-1.5 sm:pl-1 sm:pr-2">Player</th>
                            {showRaidColumn && <th className="text-left py-1 px-1.5 sm:px-2">Raid</th>}
                            <th className="text-right py-1 px-1.5 sm:px-2 whitespace-nowrap">{isClearTime ? 'Clear Time' : 'Clears'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry) => (
                            <tr
                                key={`${entry.membershipId}-${entry.changeStamp ?? 0}`}
                                className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${entry.changeStamp ? 'row-flash' : ''}`}
                            >
                                <td className="py-1.25 pl-1.25 pr-0.5 sm:pl-1 sm:pr-0.5 text-center ui-text-muted">
                                    {entry.rank <= 3 ? (
                                        <span className={`font-bold ${entry.rank === 1 ? 'text-yellow-400' :
                                            entry.rank === 2 ? 'text-gray-500 dark:text-gray-300' :
                                                'text-amber-600'
                                            }`}>
                                            {entry.rank}
                                        </span>
                                    ) : (
                                        entry.rank
                                    )}
                                </td>
                                <td className="py-1.25 pl-0 pr-1 text-center leading-none whitespace-nowrap">
                                    {entry.rankDelta !== undefined && entry.rankDelta !== 0 ? (
                                        <span
                                            className={`text-xs ${entry.rankDelta > 0
                                                ? 'text-green-600 dark:text-green-400'
                                                : 'text-red-600 dark:text-red-400'}`}
                                            title="Moved since you opened this page"
                                        >
                                            {entry.rankDelta > 0 ? `▲${entry.rankDelta}` : `▼${-entry.rankDelta}`}
                                        </span>
                                    ) : entry.isNew && (
                                        <span
                                            className="text-[0.65rem] text-yellow-600 dark:text-yellow-400"
                                            title="Entered the board since you opened this page"
                                        >
                                            NEW
                                        </span>
                                    )}
                                </td>
                                <td className="min-w-0 overflow-hidden py-1.25 pl-0.5 pr-1.5 sm:pl-1 sm:pr-2">
                                    <a
                                        href={`/player/${entry.membershipType}/${entry.membershipId}`}
                                        className="block min-w-0 truncate ui-text-primary hover:text-blue-600 transition-colors dark:hover:text-blue-400"
                                        title={entry.displayName}
                                    >
                                        {entry.displayName}
                                    </a>
                                </td>
                                {showRaidColumn && (
                                    <td className="truncate py-1.25 px-1.5 sm:px-2 ui-text-muted" title={raidName}>
                                        {raidName}
                                    </td>
                                )}
                                {/* `relative` anchors the Clear Time's tooltip; the Clears cell has none. */}
                                <td className={`${isClearTime ? 'relative ' : ''}py-1.25 px-1.5 sm:px-2 text-right font-mono font-bold whitespace-nowrap ui-text-primary`}>
                                    {isClearTime ? <ClearTimeLink entry={entry} /> : entry.completions}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
