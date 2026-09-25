'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { archiveRangeHref } from '@/lib/db/archive/range';
import type { TimelineBucketSlot } from '@/lib/db/archive/timeline-buckets';
import { archiveTabParams, type ArchiveTab } from './archive-tab';
import { dragDates, dragSlots, isDrag, type DragSlots } from './timeline-geometry';

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
 * The URL is built by the same helpers as the range forms — a date range, the active tab,
 * and no Helper board parameters — and it is always a date range, even from a Clear
 * Number one: dragging across time produces dates.
 *
 * **A mouse only.** A finger or a pen never drags: blocking page scroll across a
 * full-width chart is a trap on a phone, so this sets no `touch-action` and ignores every
 * pointer that isn't a mouse. There a tap shows a tooltip, and the range form sets the
 * range.
 *
 * **A press that moves less than {@link DRAG_THRESHOLD_PX} sideways does nothing.**
 * There is no click-to-filter. **Escape cancels** a drag in progress.
 */

interface Press {
    pointerId: number;
    /** Where the press began, in the viewport's pixels and as a fraction of the chart. */
    startX: number;
    startFraction: number;
    /**
     * The buckets selected so far, once the pointer has moved {@link DRAG_THRESHOLD_PX}:
     * from then on it is a drag. Kept here as well as in state so the release reads what
     * the last move chose, not what the last render drew.
     */
    selection: DragSlots | null;
}

export function TimelineDrag({
    slots,
    span,
    tab,
    children,
}: {
    /** One per bar, in axis order: the edges the selection snaps out to. */
    slots: TimelineBucketSlot[];
    /** The Archive's first and last Run, which the selection is clamped to. */
    span: { firstRunAt: number; lastRunAt: number };
    /** The tab to land on, so a drag never moves the reader off it. */
    tab: ArchiveTab;
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [selection, setSelection] = useState<DragSlots | null>(null);
    const press = useRef<Press | null>(null);
    const chartRef = useRef<HTMLDivElement>(null);

    function fractionAt(clientX: number): number {
        const box = chartRef.current!.getBoundingClientRect();
        return (clientX - box.left) / box.width;
    }

    const cancel = useCallback(() => {
        const current = press.current;
        press.current = null;
        setSelection(null);
        if (current && chartRef.current?.hasPointerCapture(current.pointerId)) {
            chartRef.current.releasePointerCapture(current.pointerId);
        }
    }, []);

    // Escape cancels. Listened for only while a drag is drawn, so the page carries no
    // document listener the rest of the time.
    useEffect(() => {
        if (!selection) return;
        function escape(event: KeyboardEvent) {
            if (event.key === 'Escape') cancel();
        }
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, [selection, cancel]);

    return (
        <div
            ref={chartRef}
            data-dragging={selection ? '' : undefined}
            className="group/drag relative cursor-crosshair select-none"
            onPointerDown={(event) => {
                if (event.pointerType !== 'mouse' || event.button !== 0) return;
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
                    selection: null,
                };
            }}
            onPointerMove={(event) => {
                const current = press.current;
                if (!current || current.pointerId !== event.pointerId) return;
                if (!current.selection && !isDrag(current.startX, event.clientX)) return;

                const next = dragSlots(current.startFraction, fractionAt(event.clientX), slots.length);
                if (!next) return;
                // Only on a change: most pixels of a drag stay inside the buckets already drawn.
                if (next.first !== current.selection?.first || next.last !== current.selection.last) {
                    current.selection = next;
                    setSelection(next);
                }
            }}
            onPointerUp={(event) => {
                const current = press.current;
                if (!current || current.pointerId !== event.pointerId) return;
                press.current = null;
                // A press that never became a drag: nothing was drawn and nothing happens.
                if (!current.selection) return;

                const href = archiveRangeHref(dragDates(slots, current.selection, span), archiveTabParams(tab));
                // In one transition with the navigation, the selection stays drawn until
                // the new range's page arrives, rather than vanishing on release as a
                // cancelled drag does. `scroll: false` keeps the chart under the pointer.
                startTransition(() => {
                    router.push(href, { scroll: false });
                    setSelection(null);
                });
            }}
            onPointerCancel={cancel}
        >
            {children}
            {selection && (
                <div
                    aria-hidden
                    data-testid="archive-timeline-selection"
                    className="ui-accent-text pointer-events-none absolute inset-y-0 bg-current opacity-25"
                    style={{
                        left: `${(selection.first / slots.length) * 100}%`,
                        width: `${((selection.last - selection.first + 1) / slots.length) * 100}%`,
                    }}
                />
            )}
        </div>
    );
}
