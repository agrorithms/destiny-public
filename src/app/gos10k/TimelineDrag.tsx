'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import type { ArchiveRunSpan } from '@/lib/db/archive/range';
import type { TimelineBucketSlot } from '@/lib/db/archive/timeline-buckets';
import { archiveTabHref, type ArchiveTab } from './archive-tab';
import { chartFraction, dragDates, dragSlots, isDrag, isMouse, type DragSlots } from './timeline-geometry';

/**
 * Drag across the timeline to set the page's range (#115), on the main chart and on the
 * overview strip alike.
 *
 * **A wrapper, like ./TimelineHover.tsx.** The bars are still drawn by the server
 * component ./ArchiveTimeline.tsx and arrive as `children`, so with JavaScript off the
 * page renders exactly the chart it rendered before. On the main chart this wraps the
 * hover wrapper; on the strip, which has no tooltips, it wraps the bars alone. The two
 * concerns share nothing but a CSS hook: while a drag is under way this element carries
 * `data-dragging`, and the tooltip hides itself under it.
 *
 * **One navigation, on release, never during the drag.** #108 ruled out a slider because
 * the page is rendered on the server from its URL, and a slider would cost a render per
 * drag tick. So the drag is drawn here, in state, and only its release writes the URL.
 * The URL is built by the same helper as the range forms' presets and the tabs — a date
 * range, the active tab, and no Helper board parameters — and it is always a date range,
 * even from a Clear Number one: dragging across time produces dates. A drag that lands
 * on the URL the page is already showing navigates nowhere: a same-URL push is a whole
 * server render that changes nothing.
 *
 * **A mouse only** ({@link isMouse}). A finger never drags: blocking page scroll across a
 * full-width chart is a trap on a phone, so this sets no `touch-action` and ignores every
 * pointer that isn't a mouse. There a tap shows a tooltip, and the range form sets the
 * range. A pen is treated as a finger rather than a fine pointer, deliberately: #114
 * made a pen tap, because like a finger it "leaves" as it lifts, and a pen that both
 * tapped for a tooltip and dragged for a range would be the ambiguity the no
 * click-to-filter rule exists to avoid. The check is per event rather than a
 * `(pointer: fine)` media query, which a laptop with a touch screen answers once for both.
 *
 * **A press that moves less than {@link DRAG_THRESHOLD_PX} sideways does nothing.**
 * There is no click-to-filter. **Escape cancels** a drag in progress, and so does losing
 * the pointer capture before the release arrives — a context menu or a window switch
 * mid-drag — which would otherwise leave the drag span drawn and following a mouse whose
 * button is no longer down.
 *
 * The drag span is the overlay drawn while dragging. It is not the **Shaded Band**
 * (CONTEXT.md), which shows the active Range on the strip; the two can be on screen at
 * once, and neither is ever called a "selection".
 */

interface Press {
    pointerId: number;
    /** Where the press began, in the viewport's pixels and as a fraction of the chart. */
    startX: number;
    startFraction: number;
    /**
     * The buckets dragged across so far, once the pointer has moved
     * {@link DRAG_THRESHOLD_PX}: from then on it is a drag. Kept here as well as in state
     * so the release reads what the last move chose, not what the last render drew.
     */
    dragSpan: DragSlots | null;
}

/** Nothing to subscribe to: the value below changes once, at hydration, and never again. */
function subscribeToNothing(): () => void {
    return () => {};
}

export function TimelineDrag({
    slots,
    span,
    tab,
    children,
}: {
    /** One per bar, in axis order: the edges a drag snaps out to. */
    slots: TimelineBucketSlot[];
    /** The Archive's first and last Run, which a drag's dates are clamped to. */
    span: ArchiveRunSpan;
    /** The tab to land on, so a drag never moves the reader off it. */
    tab: ArchiveTab;
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [dragSpan, setDragSpan] = useState<DragSlots | null>(null);
    const press = useRef<Press | null>(null);
    const chartRef = useRef<HTMLDivElement>(null);
    // False in the server's HTML and true once this script runs, so the crosshair — a
    // promise that dragging works — is never drawn on a page with JavaScript off.
    const scripted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

    function fractionAt(clientX: number): number {
        return chartFraction(clientX, chartRef.current!.getBoundingClientRect());
    }

    const cancel = useCallback(() => {
        const current = press.current;
        press.current = null;
        setDragSpan(null);
        if (current && chartRef.current?.hasPointerCapture(current.pointerId)) {
            chartRef.current.releasePointerCapture(current.pointerId);
        }
    }, []);

    // Escape cancels. Listened for only while a drag is drawn, so the page carries no
    // document listener the rest of the time.
    useEffect(() => {
        if (!dragSpan) return;
        function escape(event: KeyboardEvent) {
            if (event.key === 'Escape') cancel();
        }
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, [dragSpan, cancel]);

    return (
        <div
            ref={chartRef}
            data-dragging={dragSpan ? '' : undefined}
            // The crosshair for a mouse alone, like the drag: on a phone there is no cursor
            // to draw, and on a hybrid laptop the finger is not what it would describe.
            className={`group/drag relative select-none ${scripted ? '[@media(pointer:fine)]:cursor-crosshair' : ''}`}
            onPointerDown={(event) => {
                if (!isMouse(event) || event.button !== 0) return;
                // No text selection: a drag that strays off the chart would otherwise
                // start selecting the captions around it.
                event.preventDefault();
                // Captured, so a release outside the chart — or outside the window —
                // still ends the drag here rather than leaving it stuck half-drawn.
                event.currentTarget.setPointerCapture(event.pointerId);
                press.current = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startFraction: fractionAt(event.clientX),
                    dragSpan: null,
                };
            }}
            onPointerMove={(event) => {
                const current = press.current;
                if (!current || current.pointerId !== event.pointerId) return;
                if (!current.dragSpan && !isDrag(current.startX, event.clientX)) return;

                const next = dragSlots(current.startFraction, fractionAt(event.clientX), slots.length);
                if (!next) return;
                // Only on a change: most pixels of a drag stay inside the buckets already drawn.
                if (next.first !== current.dragSpan?.first || next.last !== current.dragSpan.last) {
                    current.dragSpan = next;
                    setDragSpan(next);
                }
            }}
            onPointerUp={(event) => {
                const current = press.current;
                if (!current || current.pointerId !== event.pointerId) return;
                press.current = null;
                // A press that never became a drag: nothing was drawn and nothing happens.
                if (!current.dragSpan) return;

                const href = archiveTabHref(dragDates(slots, current.dragSpan, span), tab);
                if (href === `${window.location.pathname}${window.location.search}`) {
                    setDragSpan(null);
                    return;
                }
                // In one transition with the navigation, the drag span stays drawn until
                // the new range's page arrives, rather than vanishing on release as a
                // cancelled drag does. `scroll: false` keeps the chart under the pointer.
                startTransition(() => {
                    router.push(href, { scroll: false });
                    setDragSpan(null);
                });
            }}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
                // After a release the press is already gone and this is the capture ending
                // as it should. Before one, the release is never coming.
                if (press.current) cancel();
            }}
        >
            {children}
            {dragSpan && (
                <div
                    aria-hidden
                    data-testid="archive-timeline-drag-span"
                    className="ui-accent-text pointer-events-none absolute inset-y-0 bg-current opacity-25"
                    style={{
                        left: `${(dragSpan.first / slots.length) * 100}%`,
                        width: `${((dragSpan.last - dragSpan.first + 1) / slots.length) * 100}%`,
                    }}
                />
            )}
        </div>
    );
}
