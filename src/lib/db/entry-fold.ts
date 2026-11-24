import type { InsertFullPGCRPlayer } from './queries';

/**
 * One `pgcr_players` row: a Player-Run, folded from all of one player's Entries (CONTEXT.md).
 * It carries no `startSeconds`: a folded row has no single join offset, and the activity's
 * duration is measured from the unfolded Entries before the fold (`insertFullPGCR`).
 */
export type FoldedPlayerRun = Omit<InsertFullPGCRPlayer, 'startSeconds'>;

/**
 * Folds a PGCR's Entries into one row per `membership_id`, in the order each player first
 * appears. The rules are ADR 0006's 2026-11-23 amendment:
 *
 * - `completed` if **any** Entry completed. Entry order is not time order, so no single Entry's
 *   flag can stand for the player.
 * - kills, deaths, assists and time played are summed.
 * - class and light level both come from the Entry played longest (ties to the first), so the
 *   row still describes a character that existed.
 * - membership and name fields come from the first Entry.
 */
export function foldEntriesIntoPlayerRuns(entries: readonly InsertFullPGCRPlayer[]): FoldedPlayerRun[] {
    const folded = new Map<string, { row: FoldedPlayerRun; longestEntrySeconds: number }>();

    for (const entry of entries) {
        const existing = folded.get(entry.membershipId);
        if (!existing) {
            const row: FoldedPlayerRun = {
                instanceId: entry.instanceId,
                membershipId: entry.membershipId,
                membershipType: entry.membershipType,
                displayName: entry.displayName,
                bungieGlobalDisplayName: entry.bungieGlobalDisplayName,
                characterClass: entry.characterClass,
                lightLevel: entry.lightLevel,
                completed: entry.completed,
                kills: entry.kills,
                deaths: entry.deaths,
                assists: entry.assists,
                timePlayedSeconds: entry.timePlayedSeconds,
            };
            folded.set(entry.membershipId, { row, longestEntrySeconds: entry.timePlayedSeconds });
            continue;
        }

        const { row } = existing;
        row.completed = row.completed || entry.completed;
        row.kills += entry.kills;
        row.deaths += entry.deaths;
        row.assists += entry.assists;
        row.timePlayedSeconds += entry.timePlayedSeconds;
        if (entry.timePlayedSeconds > existing.longestEntrySeconds) {
            existing.longestEntrySeconds = entry.timePlayedSeconds;
            row.characterClass = entry.characterClass;
            row.lightLevel = entry.lightLevel;
        }
    }

    return [...folded.values()].map(({ row }) => row);
}
