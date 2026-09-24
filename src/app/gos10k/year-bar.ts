import type { ArchiveYear } from '@/lib/db/archive/queries';

/**
 * The By year bar's two segments (#111), as percentages of the bar's full width.
 *
 * The scale is the one the single-segment bar used before it — the largest year's Runs —
 * so the two segments together are still that year's Runs and still compare across rows.
 * The first is its Full Clears; the second is every other Run: Resets, Checkpoint Runs and
 * the Runs his fireteam cleared without him. The Resets panel gives that breakdown, which
 * is why an 8px bar carries two segments and not four.
 */
export function yearBarSegments(
    year: Pick<ArchiveYear, 'runs' | 'fullClears'>,
    of: number
): { fullClears: number; rest: number } {
    return {
        fullClears: (year.fullClears / of) * 100,
        rest: ((year.runs - year.fullClears) / of) * 100,
    };
}
