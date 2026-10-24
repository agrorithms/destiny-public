import type { RaidsInProgressPoint, RaidsInProgressSeries } from '@/lib/db/queries';
import { formatRaidCount, raidNoun } from './activity-geometry';
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
}

/** One slot per point, in the series' order. */
export function activitySlots(points: RaidsInProgressPoint[]): ActivitySlot[] {
    return points.map((point) => {
        const count = formatRaidCount(point.total);
        return {
            start: point.start,
            end: point.end,
            value: `${count} average ${raidNoun(count)} in progress`,
            estimate: point.provisional,
        };
    });
}

/**
 * The tooltip's text: the average, the step's window and, on an estimate, that it is one.
 * In UTC, with the suffix, when there is no offset.
 */
export function tooltipText(slot: ActivitySlot, offsetOf: OffsetOf): string {
    const text = `${slot.value}, ${formatStepWindow(slot.start, slot.end, offsetOf)}`;
    return slot.estimate ? `${text} · ${ESTIMATE_TAIL}` : text;
}

/**
 * What it takes to place a step on the chart: the window the x-axis spans, and where the
 * steps start and how many there are. The steps run on from `firstStart` without a gap.
 */
export interface SlotLocator {
    from: number;
    to: number;
    firstStart: number;
    stepSeconds: number;
    count: number;
}

export function locatorOf(
    series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'stepSeconds' | 'countedFrom' | 'points'>
): SlotLocator {
    return {
        from: series.from,
        to: series.to,
        firstStart: series.countedFrom,
        stepSeconds: series.stepSeconds,
        count: series.points.length,
    };
}

/**
 * The step a pointer `fraction` of the way across the chart is over, or null where there is
 * none: the bare part-step at the left, the shaded spans at either end, anywhere past the
 * last step. By time, not by an equal share of the width, because the chart's axis is the
 * window `[from, to]`, which neither starts on a step boundary nor ends on one.
 */
export function slotAtFraction(fraction: number, locator: SlotLocator): number | null {
    const at = locator.from + fraction * (locator.to - locator.from);
    const index = Math.floor((at - locator.firstStart) / locator.stepSeconds);
    return index >= 0 && index < locator.count ? index : null;
}

/** How far across the chart step `index`'s window is centred: where the line draws its vertex. */
export function slotCentreFraction(index: number, locator: SlotLocator): number {
    const middle = locator.firstStart + (index + 0.5) * locator.stepSeconds;
    return (middle - locator.from) / (locator.to - locator.from);
}
