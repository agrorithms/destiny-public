import type { RaidsInProgressPoint } from '@/lib/db/queries';
// Type only: this module is server-safe, and no client component code may land in it.
import type { RaidOption } from '@/components/RaidMultiSelect';
import { formatRaidCount, hasEstimate, raidNoun, stepCentrePercent } from './activity-geometry';
import { formatStepWindow, type OffsetOf } from './activity-time';

/**
 * What the Raid Activity tooltips say, and which step a pointer is over (#197). Worked out
 * on the server and handed to the browser as plain data, as /gos10k's are
 * (src/app/gos10k/timeline-tooltips.ts) — with one difference. A tooltip names a time window,
 * and the window is in the reader's time zone, which the server cannot know. So the server
 * decides the number and the wording ({@link activitySlots}) and the browser finishes the
 * sentence from the step's two timestamps ({@link tooltipText}), through the same formatter
 * every other label on the chart uses.
 *
 * Browser code as well as server code, so it imports no database module: anything on its
 * import path is shipped to the reader.
 */

/** What a tooltip says about a step that is an estimate rather than a count. */
export const ESTIMATE_TAIL = 'estimate, still arriving';

/** One step's tooltip, minus the clock window the browser adds. */
export interface ActivitySlot {
    start: number;
    end: number;
    /** `1,828 average raids in progress`: the step's average, rounded. */
    value: string;
    /** True for a Provisional step, whose number can still change. */
    estimate: boolean;
    /**
     * One line per raid picked, `Last Wish: 4`, in the picked order. On a Provisional step a
     * raid's line is marked as an estimate like the total's, or reads `no estimate` for a raid
     * the step carries no estimate for (#199).
     */
    raids: string[];
}

/**
 * One slot per point, in the series' order. `raids` are the ones the bottom panel draws, in
 * its order: each slot carries a line for each.
 */
export function activitySlots(points: RaidsInProgressPoint[], raids: readonly RaidOption[] = []): ActivitySlot[] {
    return points.map((point) => {
        const count = formatRaidCount(point.total);
        return {
            start: point.start,
            end: point.end,
            value: `${count} average ${raidNoun(count)} in progress`,
            estimate: point.provisional,
            raids: raids.map(({ key, name }) => raidLine(name, point, key)),
        };
    });
}

/** One raid's tooltip line: its value, and on a Provisional step that it is an estimate or that there is none. */
function raidLine(name: string, point: RaidsInProgressPoint, key: string): string {
    const value = `${name}: ${formatRaidCount(point.raids?.[key] ?? 0)}`;
    if (!point.provisional) return value;
    return hasEstimate(point, key) ? `${value} · ${ESTIMATE_TAIL}` : `${name}: no estimate`;
}

/**
 * The tooltip's text: the average, the step's window and, on an estimate, that it is one,
 * then a line for each raid the bottom panel draws (#198). In UTC, with the suffix, when
 * there is no offset.
 */
export function tooltipText(slot: ActivitySlot, offsetOf: OffsetOf): string {
    const text = `${slot.value}, ${formatStepWindow(slot.start, slot.end, offsetOf)}`;
    return [slot.estimate ? `${text} · ${ESTIMATE_TAIL}` : text, ...slot.raids].join('\n');
}

/**
 * The step a pointer `fraction` of the way across the chart is over, or null where there is
 * none: the bare part-step at the left, the shaded spans at either end, anywhere past the
 * last step. Both panels draw the Provisional steps (#199), so the one answer serves either.
 * By time, not by an equal share of the width, because the
 * chart's axis is the window `[from, to]`, which neither starts on a step boundary nor ends
 * on one.
 */
export function slotAtFraction(fraction: number, slots: readonly ActivitySlot[], from: number, to: number): number | null {
    const at = from + fraction * (to - from);
    const index = slots.findIndex((slot) => slot.start <= at && at < slot.end);
    return index === -1 ? null : index;
}

/**
 * How far across the chart step `index`'s window is centred: where the line draws its
 * vertex, placed by the same {@link stepCentrePercent} as the line.
 */
export function slotCentreFraction(index: number, slots: readonly ActivitySlot[], from: number, to: number): number {
    const { start, end } = slots[index];
    return stepCentrePercent(start, end, from, to) / 100;
}
