/**
 * The pointer arithmetic any hover-and-tap chart needs — moved here from the /gos10k
 * timeline's geometry module by #193 so a Tracker page can use it too (#51, #197).
 *
 * **Knows nothing about the Archive or the Tracker.** Nothing here imports from
 * `src/lib/db/*`, and nothing should: ADR 0007 keeps the Archive's modules off the Tracker's
 * pages, and this is the module both sides may share. It deals only in numbers — a pointer's
 * x, a chart's box, a count of equal-width slots.
 *
 * **Browser code.** The hover wrapper (src/components/chart/ChartHover.tsx) and /gos10k's
 * drag both call these in the client, so they stay free of anything that touches a
 * database or Node.
 */

/**
 * Whether a pointer is a mouse (#114, #115). A mouse hovers and drags; everything else — a
 * finger, a pen — taps, and never drags. One answer for both client components, so the
 * tooltip and the drag cannot disagree about which kind of pointer they are looking at.
 */
export function isMouse(event: { pointerType: string }): boolean {
    return event.pointerType === 'mouse';
}

/**
 * How far across a chart a pointer at `clientX` is, as a fraction of its width — unclamped,
 * so a captured drag past either edge reads as below 0 or above 1 ({@link slotAt} clamps).
 */
export function chartFraction(clientX: number, box: { left: number; width: number }): number {
    return (clientX - box.left) / box.width;
}

/**
 * Which of `count` slots a pointer `fraction` of the way across the main chart is over,
 * or null when there are none (#114) — the bucket a tooltip describes.
 *
 * By slot, like the bars, so it is one calculation for both the line and the bars: the
 * line's point for a bucket is drawn at its slot's right-hand edge, and the vertex
 * nearest the pointer is half a slot off the bar beneath it. Picking the slot instead
 * means hovering the line and hovering the bar under it always name the same bucket.
 *
 * Clamped to the end slots, because the pointer's last pixel measures as 100% of the
 * width and a pointer event can land a fraction outside the box.
 */
export function slotAt(fraction: number, count: number): number | null {
    if (count === 0) return null;
    return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}

/**
 * Where the tooltip for slot `index` of `count` points, in pixels from the chart's left
 * (#114): the middle of the slot, which is where its bar is drawn. {@link slotAt}'s
 * inverse, here beside it so the two cannot disagree about where a slot is.
 */
export function slotCentre(index: number, count: number, chartWidth: number): number {
    return ((index + 0.5) / count) * chartWidth;
}

/**
 * The tooltip's left edge in pixels from the chart's left (#114): centred over `anchor`
 * where there is room, and slid back inside the chart where there is not.
 *
 * The chart is the page column, so inside the chart is inside the viewport — at 360px
 * and at the chart's first and last bars, which is where a centred box would hang off.
 * A tooltip wider than the chart starts at its left edge: the bucket's name leads the
 * text, and overflow on the right cuts the end of it rather than the start.
 */
export function tooltipLeft(anchor: number, tooltipWidth: number, chartWidth: number): number {
    const furthest = Math.max(0, chartWidth - tooltipWidth);
    return Math.min(furthest, Math.max(0, anchor - tooltipWidth / 2));
}
