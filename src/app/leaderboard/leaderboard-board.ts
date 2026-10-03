import type { LeaderboardBoard } from '@/lib/cache/leaderboard-cache';

export type { LeaderboardBoard };

/**
 * Which board the leaderboard page shows (#130): Full Clears or Fastest Clears.
 *
 * ## Why a URL parameter
 *
 * So a link can open straight onto Fastest Clears, and so back and refresh behave. The
 * filters stay in browser storage as before and are shared by both tabs; only the tab
 * itself is in the URL. Prior art: the GoS 10k page's tabs (src/app/gos10k/archive-tab.ts).
 *
 * ## No parameter is Full Clears, and so is anything unrecognised
 *
 * The page has always opened on the count board, and `/leaderboard` still does. A
 * hand-edited `?board=nope` is the default page, as `?tab=nope` is on /gos10k.
 */

/** The URL's spelling of the tab. Absent means Full Clears. */
export const LEADERBOARD_BOARD_PARAM = 'board';

/** One list, three uses: the recogniser, the strip's render order and its labels. */
export const LEADERBOARD_BOARDS = [
    { id: 'fullClears', label: 'Full Clears' },
    { id: 'fastest', label: 'Fastest Clears' },
] as const satisfies readonly { id: LeaderboardBoard; label: string }[];

export const DEFAULT_LEADERBOARD_BOARD: LeaderboardBoard = 'fullClears';

function isLeaderboardBoard(value: string): value is LeaderboardBoard {
    return LEADERBOARD_BOARDS.some((board) => board.id === value);
}

/** Reads the tab out of the URL. A repeated key, like an unknown value, is Full Clears. */
export function parseLeaderboardBoard(
    searchParams: Record<string, string | string[] | undefined>
): LeaderboardBoard {
    const value = searchParams[LEADERBOARD_BOARD_PARAM];
    return typeof value === 'string' && isLeaderboardBoard(value) ? value : DEFAULT_LEADERBOARD_BOARD;
}

/** The link to `board`: bare `/leaderboard` for Full Clears, so the default URL is unchanged. */
export function leaderboardBoardHref(board: LeaderboardBoard): string {
    return board === DEFAULT_LEADERBOARD_BOARD
        ? '/leaderboard'
        : `/leaderboard?${new URLSearchParams({ [LEADERBOARD_BOARD_PARAM]: board })}`;
}
