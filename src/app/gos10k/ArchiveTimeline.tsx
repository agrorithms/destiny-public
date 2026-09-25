import type {
    ArchiveRangeTimeline,
    ArchiveTimelineMonth,
    ResolvedArchiveRange,
} from '@/lib/db/archive/queries';
import {
    describeArchiveRange,
    formatArchiveDayRange,
    formatArchiveMonth,
    formatClearNumber,
    formatTimelineBucketInSentence,
} from './range-copy';
import {
    timelineBand,
    yearTicks,
    zoomedTicks,
    type TimelineBand,
    type TimelinePart,
    type TimelineTick,
} from './timeline-geometry';
import { TimelineHover } from './TimelineHover';
import { wholeArchiveTooltips, zoomedTooltips } from './timeline-tooltips';

/**
 * The timeline (#88, #113) — a cumulative Pinned Full Clear line, with bars beneath it on
 * the same x-axis.
 *
 * **Both halves are needed and neither is decoration.** The cumulative line shows the
 * arc of a grind; it also flattens every pause and every burst into a slope, which is
 * exactly what the bars restore.
 *
 * **Unfiltered, it is the whole Archive, month by month** — monthly rather than weekly
 * (300+ bars, unreadable) or yearly (7 bars, hides everything), settled in #81.
 *
 * **Under a range it zooms to the range (#113)**, with buckets sized to the range's
 * length (./timeline-buckets.ts) and a line in absolute Clear Numbers, so it is a picture
 * of the range's Clear Number reading. This reverses #88, which made the timeline the one
 * panel that never narrowed to the filter, so that a narrow range kept its context. That
 * reason survives in the **overview strip** under the zoomed chart: the whole Archive,
 * monthly, with the range shaded on it. That is why {@link getMonthlyClears} still takes
 * no range — it is the strip's data — and the zoomed chart has its own read beside it.
 *
 * **Separate SVGs, sharing an axis by construction.** Each carries the same `viewBox`
 * width and each is `w-full`, so viewBox unit *n* is the same x in each however wide the
 * page is. Stacking the line and the bars in one SVG would make their heights a single
 * scale factor, and `preserveAspectRatio="none"` — which is what keeps the chart
 * full-bleed at any width without shrinking text, since there is no text inside any SVG —
 * would then squash the bars whenever the line grew.
 *
 * No chart library: this repo has none, #81 asks for none, and the `By year` bars on
 * this page are already a div with a percentage width. Adding a dependency to draw two
 * polylines is a decision for the user, not a default.
 *
 * **Still a server component under #114's hover tooltips.** The main chart's line and
 * bars are wrapped in ./TimelineHover.tsx, a client component that takes them as
 * `children` — so they are still rendered here, and with JavaScript off the page draws
 * them exactly as before. What each tooltip says is worked out here too
 * (./timeline-tooltips.ts) and handed down as strings. The overview strip is not wrapped:
 * tooltips belong to the main chart.
 */
export function ArchiveTimeline({
    months,
    zoomed,
    range,
}: {
    /** The whole Archive, always: the chart unfiltered, the overview strip under a range. */
    months: ArchiveTimelineMonth[];
    /** The range's own buckets, or null when no range is active. */
    zoomed: ArchiveRangeTimeline | null;
    range: ResolvedArchiveRange;
}) {
    // The geometry works in month keys alone — it is the axis, not the data — so the
    // whole-Archive bars, the band and the year ticks are positioned from one list.
    const monthKeys = months.map((month) => month.month);
    const wholeArchiveTicks = yearTicks(monthKeys).map((tick) => ({ label: tick.year, percent: tick.percent }));

    if (zoomed === null) {
        const total = months.length === 0 ? 0 : months[months.length - 1].cumulativeClears;
        const peak = busiest(months);
        return (
            <TimelineSection heading="Six years, month by month">
                {/* The population, as every panel states it (#81). */}
                <p className="ui-text-secondary text-sm leading-6">
                    Full Clears across the whole Archive. Pick a range to zoom in on it.
                </p>

                {/* A testid on the whole chart because a spec that wants "the timeline"
                    wants every part of it together — and wants it on every tab. */}
                <div data-testid="archive-timeline" className="space-y-1">
                    <p className="ui-text-secondary text-xs">
                        Cumulative: 0 to {total.toLocaleString()} Full Clears
                    </p>
                    <TimelineHover tooltips={wholeArchiveTooltips(months)}>
                        <Climb
                            buckets={months}
                            from={0}
                            label={`Cumulative Full Clears, rising to ${total.toLocaleString()}`}
                        />
                        <Bars
                            buckets={months}
                            variant="main"
                            label={
                                peak === null
                                    ? 'Full Clears per month'
                                    : `Full Clears per month, peaking at ${peak.clears} in ${peak.month}`
                            }
                        />
                    </TimelineHover>
                    <Ticks ticks={wholeArchiveTicks} />
                    <p className="ui-text-secondary text-xs">
                        {peak === null
                            ? 'No Full Clears in the Archive.'
                            : `Per month: busiest was ${peak.clears.toLocaleString()} in ${formatArchiveMonth(peak.month)}.`}
                    </p>
                </div>
            </TimelineSection>
        );
    }

    const { size, buckets, clearsBefore } = zoomed;
    const last = buckets.length === 0 ? clearsBefore : buckets[buckets.length - 1].cumulativeClears;
    const first = clearsBefore + 1;
    const peak = busiest(buckets);
    const band = timelineBand(monthKeys, range);
    const scope = describeArchiveRange(range);
    // "18 on 3 Feb 2022", but "40 in the week of 31 Jan 2022" and "41 in Feb 2022".
    const preposition = size === 'day' ? 'on' : 'in';

    return (
        <TimelineSection heading={`The range, ${size} by ${size}`}>
            <p className="ui-text-secondary text-sm leading-6">
                Full Clears across {scope}. The strip underneath is the whole Archive, with
                this range shaded.
            </p>

            <div data-testid="archive-timeline" className="space-y-3">
                {/* A range holding Runs but no clears is a real answer (resolveArchiveRange
                    keeps it on purpose), and an empty chart is the wrong way to give it:
                    a flat line over no bars renders perfectly and reads as broken. */}
                {peak === null ? (
                    <p data-testid="archive-timeline-no-clears" className="ui-text-secondary text-sm">
                        This range holds Runs but no Full Clears, so there is nothing to climb.
                    </p>
                ) : (
                    <div data-testid="archive-timeline-zoomed" className="space-y-1">
                        {/* The line's endpoints, named: the Clear Numbers it runs between are
                            the range's Clear Number reading, which is the point of drawing
                            it in absolute Clear Numbers rather than from zero. */}
                        <p className="ui-text-secondary text-xs">
                            Cumulative: {formatClearNumber(first)}
                            {last === first ? '' : ` to ${last.toLocaleString()}`}
                        </p>
                        <TimelineHover tooltips={zoomedTooltips(zoomed)}>
                            <Climb
                                buckets={buckets}
                                from={clearsBefore}
                                label={`Cumulative Full Clears, from ${formatClearNumber(first)} to ${formatClearNumber(last)}`}
                            />
                            <Bars
                                buckets={buckets}
                                variant="main"
                                label={`Full Clears per ${size}, peaking at ${peak.clears} ${preposition} ${formatTimelineBucketInSentence(size, peak.start)}`}
                            />
                        </TimelineHover>
                        <Ticks ticks={zoomedTicks(size, buckets)} />
                        <p className="ui-text-secondary text-xs">
                            Per {size}: busiest was {peak.clears.toLocaleString()} {preposition}{' '}
                            {formatTimelineBucketInSentence(size, peak.start)}.
                        </p>
                    </div>
                )}

                {/* The context #88 wanted a narrow range never to lose: the whole Archive,
                    monthly, the range shaded. Only under a range — unfiltered, the chart
                    above already is the whole Archive, so a strip would repeat it. */}
                <div data-testid="archive-timeline-overview" className="space-y-1">
                    <p className="ui-text-secondary text-xs">
                        The whole Archive, by month. Shaded: {formatArchiveDayRange(range)}.
                    </p>
                    <Bars
                        buckets={months}
                        band={band}
                        variant="overview"
                        label="Full Clears per month across the whole Archive, with the range shaded"
                    />
                    <Ticks ticks={wholeArchiveTicks} />
                </div>
            </div>
        </TimelineSection>
    );
}

// Everything below is in viewBox units of this width, in every chart. It is a resolution
// rather than a size — `preserveAspectRatio="none"` stretches it to whatever the column
// is — so it only has to be large enough that ~100 bars land on distinguishable
// coordinates.
const AXIS_WIDTH = 1000;
const LINE_HEIGHT = 120;
const BAR_HEIGHT = 48;

/** What the line and the bars read off a bucket, whichever read it came from. */
interface ChartBucket {
    clears: number;
    cumulativeClears: number;
}

/** The bucket with the most clears, or null when there are none at all. */
function busiest<T extends ChartBucket>(buckets: T[]): T | null {
    return buckets.reduce<T | null>(
        (best, bucket) => (bucket.clears > (best?.clears ?? 0) ? bucket : best),
        null
    );
}

function TimelineSection({ heading, children }: { heading: string; children: React.ReactNode }) {
    return (
        <section aria-labelledby="archive-timeline-heading" className="space-y-3">
            <h2 id="archive-timeline-heading" className="text-xl font-semibold ui-text-primary">
                {heading}
            </h2>
            {children}
        </section>
    );
}

/**
 * The cumulative line, rising from `from` at the left-hand edge to the last bucket's
 * total at the right.
 *
 * Each point is the total at the *end* of its bucket, which is the instant it is true: a
 * bucket's clears have all happened by its last day, not by its first. The origin point
 * is `from` — zero for the whole Archive, the Clear Number before the range when zoomed —
 * so the line's bottom is "nothing yet" in both, and its top is the last clear.
 *
 * role="img" with a label rather than an unlabelled graphic: the shape is the content
 * here, and the figures a screen reader needs are in the captions either side of it.
 *
 * Always the main chart's, so always marked as the `line` half for ./TimelineHover.tsx.
 */
function Climb({ buckets, from, label }: { buckets: ChartBucket[]; from: number; label: string }) {
    const top = buckets.length === 0 ? from : buckets[buckets.length - 1].cumulativeClears;
    const rise = top - from;
    const step = buckets.length === 0 ? 0 : AXIS_WIDTH / buckets.length;
    const points = [
        `0,${LINE_HEIGHT}`,
        ...buckets.map((bucket, index) => {
            const y = rise === 0 ? LINE_HEIGHT : LINE_HEIGHT * (1 - (bucket.cumulativeClears - from) / rise);
            return `${(index + 1) * step},${y}`;
        }),
    ].join(' ');

    return (
        <svg
            viewBox={`0 0 ${AXIS_WIDTH} ${LINE_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            data-timeline-part={'line' satisfies TimelinePart}
            className="h-24 w-full ui-accent-text sm:h-32"
        >
            {/* `vector-effect` because preserveAspectRatio="none" scales x and y by
                different factors, which would otherwise render the stroke as a wedge —
                thin where the chart is wide. */}
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

/**
 * One bar per bucket, scaled to the busiest. An empty bucket draws no bar and still
 * occupies its slot on the axis — that is the point of the gap-filled reads — so the
 * space between two bars is time rather than a missing row.
 */
function Bars({
    buckets,
    label,
    band = null,
    variant,
}: {
    buckets: ChartBucket[];
    label: string;
    band?: TimelineBand | null;
    /**
     * `main`: the main chart's bars, which ./TimelineHover.tsx explains. `overview`: the
     * strip — the same bars at half the height, so it reads as context, and never
     * hoverable (#114).
     */
    variant: 'main' | 'overview';
}) {
    const most = busiest(buckets)?.clears ?? 0;
    const step = buckets.length === 0 ? 0 : AXIS_WIDTH / buckets.length;

    return (
        <svg
            viewBox={`0 0 ${AXIS_WIDTH} ${BAR_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            data-timeline-part={variant === 'main' ? ('bar' satisfies TimelinePart) : undefined}
            className={`w-full ui-text-secondary ${variant === 'main' ? 'h-12' : 'h-6'}`}
        >
            {buckets.map((bucket, index) => {
                const height = most === 0 ? 0 : BAR_HEIGHT * (bucket.clears / most);
                return (
                    <rect
                        key={index}
                        x={index * step + step * 0.15}
                        y={BAR_HEIGHT - height}
                        width={step * 0.7}
                        height={height}
                        fill="currentColor"
                    />
                );
            })}
            {/* Over the bars, not under them: on the strip a busy month's bar fills most of
                its slot, and a band drawn beneath it — as it was beneath #88's line, over
                empty space — showed as a one-pixel sliver beside the bar it was shading. */}
            <ShadedBand band={band} />
        </svg>
    );
}

/**
 * Axis labels as HTML rather than SVG text: the SVGs stretch non-uniformly, which would
 * render text as a smear, and HTML text stays at a real font size on a phone instead of
 * scaling to six pixels.
 */
function Ticks({ ticks }: { ticks: TimelineTick[] }) {
    return (
        <div className="relative h-4 select-none" aria-hidden>
            {ticks.map((tick) => (
                <span
                    key={tick.label}
                    className="ui-text-secondary absolute top-0 whitespace-nowrap text-[10px] tabular-nums"
                    style={{
                        left: `${tick.percent}%`,
                        // A label sits to the right of the boundary it marks, except when
                        // that would take it off the chart: the whole Archive's last year
                        // starts at ~97% of the axis, and four digits there overflowed the
                        // panel by 13px at 360px wide (the phone spec caught it). Flipped,
                        // the label ends at its boundary instead of starting at it. The
                        // zoomed axis never reaches here — see LAST_ZOOMED_TICK_PERCENT.
                        transform: tick.percent > 90 ? 'translateX(-100%)' : undefined,
                    }}
                >
                    {tick.label}
                </span>
            ))}
        </div>
    );
}

/**
 * The band shading the active range on the overview strip.
 *
 * Percentages straight onto the rect, which SVG resolves against the viewBox width.
 * Converting them back into user units would mean this component being handed the same
 * AXIS_WIDTH its `viewBox` uses and multiplying by it — a way for the two to disagree.
 */
function ShadedBand({ band }: { band: TimelineBand | null }) {
    // Unfiltered draws nothing: a band covering the whole chart reads as a selection.
    if (band === null) return null;

    return (
        <rect
            data-testid="archive-timeline-band"
            x={`${band.startPercent}%`}
            y={0}
            width={`${band.endPercent - band.startPercent}%`}
            height={BAR_HEIGHT}
            className="ui-accent-text"
            fill="currentColor"
            fillOpacity={0.4}
        />
    );
}
