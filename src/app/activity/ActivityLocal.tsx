'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { RaidsInProgressPoint } from '@/lib/db/queries';
import { ChartHover, type SlotLocator } from '@/components/chart/ChartHover';
import {
    CHART_HEIGHT,
    GRIDLINE_STROKE,
    axisTicks,
    describeBeforeData,
    peakCaption,
} from './activity-geometry';
import type { ActivityRange } from './activity-range';
import { describeTimeZone, readerOffsetOf, type OffsetOf } from './activity-time';
import { slotAtFraction, slotCentreFraction, tooltipText, type ActivitySlot } from './activity-tooltips';

/**
 * The Raid Activity chart's client step (#197): everything that finishes in the reader's
 * time zone, and nothing that draws the chart. The line, the dashed line and the shades are
 * server-rendered SVG in ./ActivityChart.tsx and never change here.
 *
 * **Each piece renders in UTC first.** The server cannot know the reader's zone, so it
 * renders every one of these with no offset — what a reader with JavaScript off sees, and
 * what hydration must match — and the reader's zone arrives afterwards through
 * {@link useZoneName}: `useSyncExternalStore` with a server snapshot of null, so there is no
 * hydration mismatch and no flash of anything but UTC. The offset follows the zone name
 * ({@link useOffsetOf}), so a browser that names no zone reads UTC everywhere, as its intro
 * says.
 *
 * **What it changes:** the x gridlines and their labels (the zone's midnights and 3-hour
 * marks are not UTC's), the hover and tap tooltips, and the sentences that name a time. What
 * those say is worked out by pure modules (./activity-time.ts, ./activity-geometry.ts,
 * ./activity-tooltips.ts) and only handed the offset here, so the component holds wiring and
 * no arithmetic.
 */

function subscribe(): () => void {
    return () => {};
}

/** The browser's offset at an instant, in minutes east of UTC. DST is read per instant. */
function browserOffsetOf(at: number): number {
    return -new Date(at * 1000).getTimezoneOffset();
}

/** The reader's IANA zone (`Asia/Kathmandu`), or null on the server and where the browser will not say. */
function useZoneName(): string | null {
    return useSyncExternalStore(
        subscribe,
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        () => null
    );
}

/** The reader's offset, or null — UTC — on the server's render and where the browser names no zone. */
function useOffsetOf(): OffsetOf {
    return readerOffsetOf(useZoneName(), browserOffsetOf);
}

/** The intro's sentence about the zone every time on the page is in. */
export function LocalZoneNote() {
    return <span data-testid="activity-zone">{describeTimeZone(useZoneName())}</span>;
}

/** The busiest-step sentence under the chart. */
export function LocalPeak({ busiest, range }: { busiest: RaidsInProgressPoint | null; range: ActivityRange }) {
    return <>{peakCaption(busiest, range, useOffsetOf())}</>;
}

/** The legend sentence for the shade where the data starts. */
export function LocalBeforeData({ countedFrom }: { countedFrom: number }) {
    return <>{describeBeforeData(countedFrom, useOffsetOf())}</>;
}

/** The vertical gridlines, inside the chart's SVG, on the zone's midnights or 3-hour marks. */
export function LocalGridlines({ from, to, range }: { from: number; to: number; range: ActivityRange }) {
    const ticks = axisTicks(from, to, range, useOffsetOf());
    return (
        <>
            {ticks.map((tick) => (
                <line
                    key={tick.percent}
                    x1={`${tick.percent}%`}
                    x2={`${tick.percent}%`}
                    y1={0}
                    y2={CHART_HEIGHT}
                    {...GRIDLINE_STROKE}
                />
            ))}
        </>
    );
}

/** The labels under the chart, one at each gridline that has room for one. */
export function LocalTickLabels({ from, to, range }: { from: number; to: number; range: ActivityRange }) {
    const ticks = axisTicks(from, to, range, useOffsetOf());
    return (
        <div data-testid="activity-x-labels" className="relative h-4 select-none" aria-hidden>
            {ticks.map((tick) =>
                tick.label === null ? null : (
                    <span
                        key={tick.percent}
                        className={`ui-text-secondary absolute top-0 whitespace-nowrap pl-0.5 text-[10px] tabular-nums ${tick.phone ? '' : 'max-sm:hidden'}`}
                        style={{ left: `${tick.percent}%` }}
                    >
                        {tick.label}
                    </span>
                )
            )}
        </div>
    );
}

/** The one graphic of the chart that takes a tooltip. */
const PARTS = ['total'] as const;

/**
 * Hover and tap tooltips over the chart (src/components/chart/ChartHover.tsx), finished in
 * the reader's zone. The slots are the server's — the number and the wording — and the clock
 * window is added here ({@link tooltipText}). The steps are placed on the x-axis by their
 * timestamps across the window `[from, to]`, because they are not equal shares of its width.
 */
export function ActivityHover({
    slots,
    from,
    to,
    children,
}: {
    slots: ActivitySlot[];
    from: number;
    to: number;
    children: React.ReactNode;
}) {
    const offsetOf = useOffsetOf();
    const tooltips = useMemo(() => slots.map((slot) => ({ total: tooltipText(slot, offsetOf) })), [slots, offsetOf]);
    const locate = useMemo<SlotLocator>(
        () => ({
            slotAt: (fraction) => slotAtFraction(fraction, slots, from, to),
            centre: (index, chartWidth) => slotCentreFraction(index, slots, from, to) * chartWidth,
        }),
        [slots, from, to]
    );
    return (
        <ChartHover tooltips={tooltips} parts={PARTS} testId="activity-tooltip" locate={locate}>
            {children}
        </ChartHover>
    );
}
