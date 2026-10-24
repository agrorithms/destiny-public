/**
 * Clock labels for the Raid Activity chart in a reader's time zone (#197). Stub, red first.
 */

/** Minutes east of UTC at an instant (unix seconds), or null for UTC. */
export type OffsetOf = ((at: number) => number) | null;

export function dayLabel(at: number, offsetOf: OffsetOf): string {
    throw new Error(`not implemented ${at} ${offsetOf}`);
}
export function dateLabel(at: number, offsetOf: OffsetOf): string {
    throw new Error(`not implemented ${at} ${offsetOf}`);
}
export function clock(at: number, offsetOf: OffsetOf): string {
    throw new Error(`not implemented ${at} ${offsetOf}`);
}
export function formatStepWindow(start: number, end: number, offsetOf: OffsetOf = null): string {
    throw new Error(`not implemented ${start} ${end} ${offsetOf}`);
}
export function formatInstant(at: number, offsetOf: OffsetOf = null): string {
    throw new Error(`not implemented ${at} ${offsetOf}`);
}
export function describeTimeZone(zone: string | null): string {
    throw new Error(`not implemented ${zone}`);
}
