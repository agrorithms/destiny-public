'use client';

import { useId, type MouseEvent } from 'react';
import { getElapsedTime } from '@/components/ActiveSessionCard';
import { fireteamTitle, otherRosterMembers, type RosterMember, type RosterSession } from '@/lib/active-session/roster';

interface FireteamRowProps {
    session: RosterSession & {
        startedAt: string;
        playerCount: number;
    };
    /** Whether the row shows the rest of its Roster. The page owns this, so it survives refreshes. */
    open: boolean;
    onToggle: () => void;
}

/** A Roster member's player page, or null when the API doesn't know their membership type. */
function playerHref(member: Pick<RosterMember, 'membershipId' | 'membershipType'>): string | null {
    return typeof member.membershipType === 'number'
        ? `/player/${member.membershipType}/${member.membershipId}`
        : null;
}

/**
 * One fireteam in list view: "<Fireteam Leader>'s fireteam", the player count and the elapsed
 * time, and when open, everyone else in the Roster.
 */
export default function FireteamRow({ session, open, onToggle }: FireteamRowProps) {
    const title = fireteamTitle(session);
    const href = playerHref(title);
    const membersId = useId();
    const others = otherRosterMembers(session);
    // A fireteam of one has nobody to list besides the member it is titled after, so its row
    // offers nothing to open: no chevron, no click, no hover.
    const expandable = others.length > 0;

    // A click anywhere on the row toggles it, except on its own links and buttons: the
    // title link navigates, and the chevron button toggles by itself. Any link or button
    // added to the row later (#160's copy button) is left alone the same way. Only controls
    // inside this row count, so an ancestor link or button can't swallow every row's click.
    function handleRowClick(event: MouseEvent<HTMLDivElement>) {
        const control = (event.target as Element).closest('a, button');
        if (control && event.currentTarget.contains(control)) return;
        onToggle();
    }

    return (
        <li className="text-sm">
            {/* The one-line row. The member list sits below it, outside the truncated title. */}
            <div
                onClick={expandable ? handleRowClick : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 min-w-0 ${expandable ? 'cursor-pointer' : ''}`}
            >
                <span className="min-w-0 flex-1 truncate ui-text-primary">
                    {href ? (
                        <a
                            href={href}
                            title={title.tooltip}
                            className="font-semibold hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                            {title.name}
                        </a>
                    ) : (
                        <span title={title.tooltip} className="font-semibold">{title.name}</span>
                    )}
                    &apos;s fireteam
                </span>
                <span className="shrink-0 text-xs ui-text-muted tabular-nums" title={`${session.playerCount} of 6 players`}>
                    {session.playerCount}/6
                </span>
                <span className="shrink-0 w-14 text-right text-xs ui-text-muted tabular-nums" title="Time elapsed">
                    {getElapsedTime(session.startedAt)}
                </span>
                {expandable ? (
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={open}
                        aria-controls={membersId}
                        aria-label="Fireteam members"
                        className="shrink-0 -my-1 p-1 rounded ui-text-muted hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                        <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                            className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
                        >
                            <path
                                fillRule="evenodd"
                                d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </button>
                ) : (
                    // The chevron's width (a 16px icon in 4px of padding each side), so the
                    // count and elapsed time line up with the rows that have one.
                    <span aria-hidden="true" className="shrink-0 w-6" />
                )}
            </div>

            {/* `expandable` too: a row opened as two players that shrinks to one stays open
                in the page's state, and would otherwise open onto an empty list. */}
            {open && expandable && (
                <ul id={membersId} aria-label="Other fireteam members" className="flex flex-col gap-1 pl-8 pr-4 pb-2.5">
                    {others.map((member) => {
                        const memberHref = playerHref(member);
                        // Like the tiles: the name as the API sends it, or the ID when it sends none.
                        const name = member.displayName || member.membershipId;
                        return (
                            <li key={member.membershipId} className="min-w-0 truncate ui-text-primary">
                                {memberHref ? (
                                    <a
                                        href={memberHref}
                                        title={name}
                                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        {name}
                                    </a>
                                ) : (
                                    <span title={name}>{name}</span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </li>
    );
}
