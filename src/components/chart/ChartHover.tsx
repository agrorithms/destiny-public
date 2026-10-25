'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chartFraction, isMouse, slotAt, slotCentre, tooltipLeft } from '@/lib/chart/pointer';

/**
 * Hover and tap tooltips for a chart (#114), shared by #193 and used by two charts: the
 * /gos10k timeline (the page's first client JavaScript; the other is
 * src/app/gos10k/TimelineDrag.tsx (#115), which wraps this one on the main chart) and the Raid
 * Activity chart (#197, through src/app/activity/ActivityLocal.tsx). Lifted here so the Raid
 * Activity page can use it without importing anything from the Archive.
 *
 * **Knows nothing about the Archive or the Tracker.** It is handed one record of strings per
 * slot, keyed by *part* — a part being one of the chart's stacked graphics, named by the
 * `parts` prop — and the server marks each graphic with `data-timeline-part="<part>"`. The
 * Archive's parts are `line` and `bar`; the Raid Activity chart has one, `total`. The
 * attribute keeps its `timeline` name because the browser spec finds /gos10k's graphics by it.
 *
 * **A wrapper, not the chart.** The line and the bars are still drawn by the server
 * component (for /gos10k, src/app/gos10k/ArchiveTimeline.tsx) and arrive here as `children`,
 * so with JavaScript off the page renders exactly what it rendered before #114: the same
 * SVGs, in a plain div.
 * This file adds the pointer handling and the box, and nothing else — it does no fetching
 * (#81's no-client-fetch rule), holds no filter state (the URL is still the only place
 * that lives), and says nothing it was not handed: the copy is worked out on the server
 * (for /gos10k, by src/app/gos10k/timeline-tooltips.ts) and arrives as strings. Everything
 * imported here is shipped to the browser, so this file imports only the pointer helpers.
 *
 * **Which graphic the pointer is over** is read off a `data-timeline-part` attribute the
 * server puts on each SVG — for /gos10k `line` or `bar` — and **which slot** from the
 * pointer's fraction of the way across. By default the slots are equal shares of the width
 * ({@link slotAt}), one answer for every graphic, so the line and the bar beneath it always
 * name the same bucket. A chart whose slots are not equal shares — the Raid Activity
 * chart's steps sit inside a window that starts and ends mid-step, with shaded spans at
 * either end — hands in a `locate` of its own, and a pointer over no slot shows nothing.
 *
 * **Touch (and pen):** a tap shows the tooltip, and a tap anywhere that is neither a
 * graphic of the chart nor a slot of it dismisses it. A tap on the chart only
 * moves it: there is nothing on the chart to navigate to, so a tap never changes the
 * range. Anything that is not a mouse is treated as tapping, because a pen, like a
 * finger, "leaves" as it lifts. A tap is read on `pointerup` rather than `pointerdown`,
 * because a finger that starts a scroll on the chart gets a `pointercancel` instead and
 * should not leave a tooltip behind.
 *
 * **Hidden while a drag is under way** (#115): the drag span is what the reader is
 * looking at then. The drag wrapper marks itself `data-dragging` and the box and its marker hide
 * under that, through the class the caller passes as `hideClass`, so neither component has
 * to know the other's state. A chart with no drag passes none.
 *
 * **Several lines in one box** (#198): a slot's text may hold newlines, which the box keeps, and
 * a chart that stacks panels sharing one time axis can have its marker run through all of them
 * ({@link markerSpansParts}).
 *
 * **A tooltip that outlives a change of chart width is closed, not moved.** A tapped one
 * stays up until the next tap, so a phone rotated under it would otherwise keep a `left`
 * measured on the old width — past the edge of the new one.
 */

interface Hovered<Part extends string> {
    index: number;
    part: Part;
}

/** The gap between the tooltip's bottom edge and the top of the graphic it describes, in px. */
const GAP = 4;

/**
 * Where a chart's slots are: which slot a pointer a `fraction` of the way across is over (or
 * none) on the graphic named `part`, and where in pixels a slot's anchor sits on a chart
 * `chartWidth` wide. The part is for a chart whose graphics shade different spans: the Raid
 * Activity chart's per-raid panel (#198) stops two hours before its total does.
 */
export interface SlotLocator<Part extends string = string> {
    slotAt: (fraction: number, part: Part) => number | null;
    centre: (index: number, chartWidth: number) => number;
}

/** The default: `count` slots, each an equal share of the width. */
function equalShares(count: number): SlotLocator {
    return {
        slotAt: (fraction) => slotAt(fraction, count),
        centre: (index, chartWidth) => slotCentre(index, count, chartWidth),
    };
}

export function ChartHover<Part extends string>({
    tooltips,
    parts,
    testId,
    locate,
    hideClass = '',
    markerSpansParts = false,
    children,
}: {
    /** One record per slot, in axis order: the text each part shows when its slot is hovered or tapped. */
    tooltips: Record<Part, string>[];
    /** The `data-timeline-part` values that count as a part of the chart. Any other target is "neither half". */
    parts: readonly Part[];
    /** The tooltip box's `data-testid`, so each chart's browser spec can find its own. */
    testId: string;
    /** Where the slots are, for a chart whose slots are not `tooltips.length` equal shares of its width. */
    locate?: SlotLocator<Part>;
    /** A class that hides the box and its marker, for a chart that has something else to show some of the time. */
    hideClass?: string;
    /**
     * Draw the marker from the top of the first graphic to the bottom of the last, one line
     * through a stack of panels that share a time axis (#198), instead of over the hovered
     * graphic alone.
     */
    markerSpansParts?: boolean;
    children: React.ReactNode;
}) {
    const [hovered, setHovered] = useState<Hovered<Part> | null>(null);
    const chartRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const markerRef = useRef<HTMLDivElement>(null);
    const where = useMemo<SlotLocator<Part>>(() => locate ?? equalShares(tooltips.length), [locate, tooltips.length]);

    /** Whether a `data-timeline-part` value names one of this chart's graphics. */
    function isPart(value: string | null | undefined): value is Part {
        return value != null && (parts as readonly string[]).includes(value);
    }

    function show(event: React.PointerEvent<HTMLDivElement>) {
        const chart = chartRef.current;
        const part = (event.target as Element).closest('[data-timeline-part]')?.getAttribute('data-timeline-part');
        if (!chart) return;
        if (!isPart(part)) {
            // A tap between two stacked graphics is a tap on neither, so it dismisses. That is
            // a pen's case: a finger cannot land in a thin gap, because the browser's touch
            // adjustment retargets the tap onto the nearer SVG (measured in Chromium). A
            // mouse crossing the gap keeps the tooltip rather than flickering it.
            if (!isMouse(event)) setHovered(null);
            return;
        }

        const fraction = chartFraction(event.clientX, chart.getBoundingClientRect());
        const index = where.slotAt(fraction, part);
        if (index === null) {
            // Over no slot — a shaded span, say — there is nothing to say, and what the
            // pointer has just left is no longer under it.
            setHovered(null);
            return;
        }

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
        const anchor = where.centre(hovered.index, chartBox.width);
        const top = partBox.top - chartBox.top;

        // The marker's extent: the hovered graphic, or every graphic's together.
        let markerTop = top;
        let markerHeight = partBox.height;
        if (markerSpansParts) {
            const boxes = [...chart.querySelectorAll('[data-timeline-part]')].map((part) => part.getBoundingClientRect());
            markerTop = Math.min(...boxes.map((box) => box.top)) - chartBox.top;
            markerHeight = Math.max(...boxes.map((box) => box.bottom)) - chartBox.top - markerTop;
        }

        tooltip.style.left = `${tooltipLeft(anchor, tooltip.offsetWidth, chartBox.width)}px`;
        tooltip.style.top = `${top - tooltip.offsetHeight - GAP}px`;
        marker.style.left = `${anchor}px`;
        marker.style.top = `${markerTop}px`;
        marker.style.height = `${markerHeight}px`;
    }, [hovered, tooltips, where, markerSpansParts]);

    // A tap anywhere outside the chart dismisses the tooltip. Listened for only while one
    // is showing, so the page carries no document listener the rest of the time — and
    // keyed on *whether* one is showing, not which bucket, so a mouse sweeping across the
    // chart does not tear the listener and the observer down at every bucket it crosses.
    const open = hovered !== null;
    useEffect(() => {
        if (!open) return;
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
    }, [open]);

    const tooltip = hovered ? tooltips[hovered.index] : undefined;

    return (
        <div
            ref={chartRef}
            className="relative space-y-1"
            onPointerMove={(event) => {
                if (isMouse(event)) show(event);
            }}
            onPointerUp={(event) => {
                if (!isMouse(event)) show(event);
            }}
            onPointerLeave={(event) => {
                // A finger or a pen "leaves" as it lifts, which would dismiss the tooltip
                // its own tap just opened. A tap elsewhere dismisses those instead.
                if (isMouse(event)) setHovered(null);
            }}
        >
            {children}
            {hovered && tooltip && (
                <>
                    {/* Which slot, on the chart itself: the tooltip is slid inwards at
                        either end, so its position alone cannot say which bar it means. */}
                    <div
                        ref={markerRef}
                        data-testid={`${testId}-marker`}
                        aria-hidden
                        className={`ui-accent-text pointer-events-none absolute w-px bg-current opacity-60 ${hideClass}`}
                    />
                    {/* `w-max max-w-full`: as wide as its text, never wider than the chart.
                        Without `w-max` an absolute box shrinks to the room right of its
                        `left`, so near the right-hand end it would wrap into a narrow column
                        before it was measured and slid back. */}
                    <div
                        ref={tooltipRef}
                        role="tooltip"
                        data-testid={testId}
                        className={`ui-card ui-text-primary pointer-events-none absolute z-10 w-max max-w-full whitespace-pre-line rounded-md border px-2 py-1 text-xs tabular-nums shadow-sm ${hideClass}`}
                    >
                        {tooltip[hovered.part]}
                    </div>
                </>
            )}
        </div>
    );
}
