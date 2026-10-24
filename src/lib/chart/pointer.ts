/**
 * Stub for the red commit (#193): the pointer helpers are being moved here from
 * src/app/gos10k/timeline-geometry.ts. These throw so the moved tests fail for the right
 * reason (the code is not here yet) rather than for a missing module.
 */
export function isMouse(_event: { pointerType: string }): boolean {
    throw new Error('not moved yet');
}

export function chartFraction(_clientX: number, _box: { left: number; width: number }): number {
    throw new Error('not moved yet');
}

export function slotAt(_fraction: number, _count: number): number | null {
    throw new Error('not moved yet');
}

export function slotCentre(_index: number, _count: number, _chartWidth: number): number {
    throw new Error('not moved yet');
}

export function tooltipLeft(_anchor: number, _tooltipWidth: number, _chartWidth: number): number {
    throw new Error('not moved yet');
}
