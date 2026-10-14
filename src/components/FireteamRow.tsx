'use client';

import { getElapsedTime } from '@/components/ActiveSessionCard';
import { fireteamTitle, type RosterSession } from '@/lib/active-session/roster';

interface FireteamRowProps {
    session: RosterSession & {
        startedAt: string;
        playerCount: number;
    };
}

/** One fireteam in list view: "<Fireteam Leader>'s fireteam", the player count and the elapsed time. */
export default function FireteamRow({ session }: FireteamRowProps) {
    const title = fireteamTitle(session);
    const href = typeof title.membershipType === 'number'
        ? `/player/${title.membershipType}/${title.membershipId}`
        : null;

    return (
        <li className="flex items-center gap-3 px-4 py-2.5 min-w-0 text-sm">
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
        </li>
    );
}
