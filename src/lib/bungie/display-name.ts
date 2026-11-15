// How a player's name is written: `Name#Code` whenever both halves are known (CLAUDE.md, "Player
// identity is `Name#Code`"). Pure and browser-safe, so the profile page names a live Roster with
// the same rule the server uses (#9001); `src/lib/db/queries.ts` re-exports it.

export interface BungieDisplayNameParts {
    membershipId: string;
    displayName?: string | null;
    bungieGlobalDisplayName?: string | null;
    bungieGlobalDisplayNameCode?: number | null;
}

/** `Name#Code` with the code zero-padded to four digits, else the best name there is, else the id. */
export function formatBungieDisplayName(player: BungieDisplayNameParts): string {
    if (player.bungieGlobalDisplayName && player.bungieGlobalDisplayNameCode != null) {
        return `${player.bungieGlobalDisplayName}#${String(player.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }

    return player.bungieGlobalDisplayName || player.displayName || player.membershipId;
}
