import type { InsertFullPGCRPlayer } from './queries';

/**
 * One `pgcr_players` row: a Player-Run, folded from all of one player's Entries (CONTEXT.md).
 * It carries no `startSeconds`: a folded row has no single join offset, and the activity's
 * duration is measured from the unfolded Entries before the fold (`insertFullPGCR`).
 */
export type FoldedPlayerRun = Omit<InsertFullPGCRPlayer, 'startSeconds'>;

/**
 * Folds a PGCR's Entries into one row per `membership_id`, per ADR 0006's 2026-11-23 amendment.
 */
export function foldEntriesIntoPlayerRuns(entries: readonly InsertFullPGCRPlayer[]): FoldedPlayerRun[] {
    void entries;
    throw new Error('not implemented');
}
