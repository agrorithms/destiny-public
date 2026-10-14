'use client';

import { getElapsedTime } from '@/components/ActiveSessionCard';
import { fireteamTitle, type RosterMember } from '@/lib/active-session/roster';

interface FireteamRowProps {
    session: {
        membershipId: string;
        membershipType?: number;
        displayName: string;
        startedAt: string;
        playerCount: number;
        partyMembers: RosterMember[];
    };
}

/** One fireteam in list view: "<Fireteam Leader>'s fireteam", the player count and the elapsed time. */
export default function FireteamRow({ session }: FireteamRowProps) {
    const title = fireteamTitle(session);
    const href = typeof title.membershipType === 'number'
        ? `/player/${title.membershipType}/${title.membershipId}`
        : null;
    // The full Name#Code as a tooltip too, for when a phone truncates it. "Unknown player"
    // shows the membership ID instead, the only identity there is.
    const tooltip = title.unknown ? title.membershipId : title.name;

    return (
        <li className="flex items-center gap-3 px-4 py-2.5 min-w-0 text-sm">
            <span className="min-w-0 flex-1 truncate ui-text-primary">
                {href ? (
                    <a
                        href={href}
                        title={tooltip}
                        className="font-semibold hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                        {title.name}
                    </a>
                ) : (
                    <span title={tooltip} className="font-semibold">{title.name}</span>
                )}
                &apos;s fireteam
            </span>
            <span className="shrink-0 text-xs ui-text-muted tabular-nums" title={`${session.playerCount} of 6 players`}>
                {session.playerCount}/6
            </span>
            <span className="shrink-0 w-14 text-right text-xs ui-text-muted tabular-nums" title="Time elapsed">
                {getElapsedTime(session.startedAt)}
            </span>
        </li>
    );
}
