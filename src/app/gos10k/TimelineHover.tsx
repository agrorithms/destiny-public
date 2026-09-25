'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { slotAt, slotCentre, tooltipLeft, type TimelinePart } from './timeline-geometry';
import type { TimelineTooltip } from './timeline-tooltips';

/**
 * The timeline's hover tooltips (#114) — the page's first client JavaScript. The other is
 * ./TimelineDrag.tsx (#115), which wraps this one on the main chart.
 *
 * **A wrapper, not the chart.** The line and the bars are still drawn by the server
 * component ./ArchiveTimeline.tsx and arrive here as `children`, so with JavaScript off
 * the page renders exactly what it rendered before #114: the same SVGs, in a plain div.
 * This file adds the pointer handling and the box, and nothing else — it does no fetching
 * (#81's no-client-fetch rule), holds no filter state (the URL is still the only place
 * that lives), and says nothing it was not handed: the copy is worked out on the server
 * by ./timeline-tooltips.ts and arrives as strings. Everything imported here is shipped
 * to the browser, which is why that module is only imported for its type.
 *
 * **Which half of the chart the pointer is over** is read off a `data-timeline-part`
 * attribute the server puts on each SVG — `line` or `bar` — and **which bucket** from the
 * pointer's fraction of the way across, by slot ({@link slotAt}). One answer for both
 * halves, so the line and the bar beneath it always name the same bucket.
 *
 * **Touch (and pen):** a tap shows the tooltip, and a tap anywhere that is neither half
 * of the chart dismisses it. A tap on the chart only
 * moves it: there is nothing on the chart to navigate to, so a tap never changes the
 * range. Anything that is not a mouse is treated as tapping, because a pen, like a
 * finger, "leaves" as it lifts. A tap is read on `pointerup` rather than `pointerdown`,
 * because a finger that starts a scroll on the chart gets a `pointercancel` instead and
 * should not leave a tooltip behind.
 *
 * **Hidden while a drag is under way** (#115): the selection is what the reader is looking
 * at then. The drag wrapper marks itself `data-dragging` and the box and its marker hide
 * under that, so neither component has to know the other's state.
 *
 * **A tooltip that outlives a change of chart width is closed, not moved.** A tapped one
 * stays up until the next tap, so a phone rotated under it would otherwise keep a `left`
 * measured on the old width — past the edge of the new one.
 */

interface Hovered {
    index: number;
    part: TimelinePart;
}

/** The gap between the tooltip's bottom edge and the top of the half it describes, in px. */
const GAP = 4;

/** A mouse hovers; everything else — a finger, a pen — taps. */
function taps(event: React.PointerEvent): boolean {
    return event.pointerType !== 'mouse';
}

export function TimelineHover({ tooltips, children }: { tooltips: TimelineTooltip[]; children: React.ReactNode }) {
    const [hovered, setHovered] = useState<Hovered | null>(null);
    const chartRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const markerRef = useRef<HTMLDivElement>(null);

    function show(event: React.PointerEvent<HTMLDivElement>) {
        const chart = chartRef.current;
        const part = (event.target as Element).closest('[data-timeline-part]')?.getAttribute('data-timeline-part');
        if (!chart) return;
        if (part !== 'line' && part !== 'bar') {
            // A tap between the two halves is a tap on neither, so it dismisses. That is a
            // pen's case: a finger cannot land in a 4px gap, because the browser's touch
            // adjustment retargets the tap onto the nearer SVG (measured in Chromium). A
            // mouse crossing the gap keeps the tooltip rather than flickering it.
            if (taps(event)) setHovered(null);
            return;
        }

        const box = chart.getBoundingClientRect();
        const index = slotAt((event.clientX - box.left) / box.width, tooltips.length);
        if (index === null) return;

        // Only on a change: a mouse fires pointermove for every pixel it crosses, and
        // most of those pixels are inside the bucket the tooltip already describes.
        if (hovered?.index !== index || hovered.part !== part) setHovered({ index, part });
    }

    // Positioned after render and before paint: the box's width is only known once its
    // text is in it, and centring it — then sliding it back inside the chart at either end
    // — needs that width. Written straight onto the element rather than into state, which
    // would render twice to arrive at the same pixels. Re-run on the strings as well as the
    // bucket: a new range with as many buckets puts different text, of a different width,
    // under the same index.
    useLayoutEffect(() => {
        const chart = chartRef.current;
        const tooltip = tooltipRef.current;
        const marker = markerRef.current;
        if (!hovered || !chart || !tooltip || !marker) return;

        const partBox = chart.querySelector(`[data-timeline-part="${hovered.part}"]`)?.getBoundingClientRect();
        if (!partBox) return;
        const chartBox = chart.getBoundingClientRect();
        const anchor = slotCentre(hovered.index, tooltips.length, chartBox.width);
        const top = partBox.top - chartBox.top;

        tooltip.style.left = `${tooltipLeft(anchor, tooltip.offsetWidth, chartBox.width)}px`;
        tooltip.style.top = `${top - tooltip.offsetHeight - GAP}px`;
        marker.style.left = `${anchor}px`;
        marker.style.top = `${top}px`;
        marker.style.height = `${partBox.height}px`;
    }, [hovered, tooltips]);

    // A tap anywhere outside the chart dismisses the tooltip. Listened for only while one
    // is showing, so the page carries no document listener the rest of the time.
    useEffect(() => {
        if (!hovered) return;
        function dismiss(event: PointerEvent) {
            if (!chartRef.current?.contains(event.target as Node)) setHovered(null);
        }
        document.addEventListener('pointerdown', dismiss);

        // Width only: on a phone the viewport's *height* changes whenever the address bar
        // slides away mid-scroll, and that moves nothing sideways. The observer reports
        // the current size as soon as it starts, which is the width to compare against.
        const chart = chartRef.current;
        let width: number | null = null;
        const resized = new ResizeObserver(([entry]) => {
            if (width === null) width = entry.contentRect.width;
            else if (entry.contentRect.width !== width) setHovered(null);
        });
        if (chart) resized.observe(chart);

        return () => {
            document.removeEventListener('pointerdown', dismiss);
            resized.disconnect();
        };
    }, [hovered]);

    const tooltip = hovered ? tooltips[hovered.index] : undefined;

    return (
        <div
            ref={chartRef}
            className="relative space-y-1"
            onPointerMove={(event) => {
                if (!taps(event)) show(event);
            }}
            onPointerUp={(event) => {
                if (taps(event)) show(event);
            }}
            onPointerLeave={(event) => {
                // A finger or a pen "leaves" as it lifts, which would dismiss the tooltip
                // its own tap just opened. A tap elsewhere dismisses those instead.
                if (!taps(event)) setHovered(null);
            }}
        >
            {children}
            {hovered && tooltip && (
                <>
                    {/* Which bucket, on the chart itself: the tooltip is slid inwards at
                        either end, so its position alone cannot say which bar it means. */}
                    <div
                        ref={markerRef}
                        aria-hidden
                        className="ui-accent-text pointer-events-none absolute w-px bg-current opacity-60 group-data-[dragging]/drag:hidden"
                    />
                    {/* `w-max max-w-full`: as wide as its text, never wider than the chart.
                        Without `w-max` an absolute box shrinks to the room right of its
                        `left`, so near the right-hand end it would wrap into a narrow column
                        before it was measured and slid back. */}
                    <div
                        ref={tooltipRef}
                        role="tooltip"
                        data-testid="archive-timeline-tooltip"
                        className="ui-card ui-text-primary pointer-events-none absolute z-10 w-max max-w-full rounded-md border px-2 py-1 text-xs tabular-nums shadow-sm group-data-[dragging]/drag:hidden"
                    >
                        {hovered.part === 'line' ? tooltip.line : tooltip.bar}
                    </div>
                </>
            )}
        </div>
    );
}
