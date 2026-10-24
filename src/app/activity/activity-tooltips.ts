import type { RaidsInProgressPoint, RaidsInProgressSeries } from '@/lib/db/queries';
import type { OffsetOf } from './activity-time';

/** Stub, red first (#197). */
export const ESTIMATE_TAIL = 'estimate, still arriving';

export interface ActivitySlot {
    start: number;
    end: number;
    value: string;
    estimate: boolean;
}

export interface SlotLocator {
    from: number;
    to: number;
    firstStart: number;
    stepSeconds: number;
    count: number;
}

export function activitySlots(points: RaidsInProgressPoint[]): ActivitySlot[] {
    throw new Error(`not implemented ${points.length}`);
}

export function tooltipText(slot: ActivitySlot, offsetOf: OffsetOf): string {
    throw new Error(`not implemented ${slot.start} ${offsetOf}`);
}

export function locatorOf(series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'stepSeconds' | 'countedFrom' | 'points'>): SlotLocator {
    throw new Error(`not implemented ${series.from}`);
}

export function slotAtFraction(fraction: number, locator: SlotLocator): number | null {
    throw new Error(`not implemented ${fraction} ${locator.count}`);
}

export function slotCentreFraction(index: number, locator: SlotLocator): number {
    throw new Error(`not implemented ${index} ${locator.count}`);
}
