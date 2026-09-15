import type { ArchiveTimelineMonth, ResolvedArchiveRange } from '@/lib/db/archive/queries';
import { describeArchiveRange, formatArchiveDayRange, formatArchiveMonth } from './range-copy';
import { timelineBand, yearTicks } from './timeline-geometry';

/**
 * The timeline (#88) — a cumulative Pinned Full Clear line climbing to the headline
 * figure, with monthly bars beneath it on the same x-axis.
 *
 * **Both halves are needed and neither is decoration.** The cumulative line shows the
 * arc of a six-year grind; it also flattens every pause and every burst into a slope,
 * which is exactly what the bars restore. Monthly buckets rather than weekly (300+ bars,
 * unreadable) or yearly (7 bars, hides everything) — settled in #81.
 *
 * **This panel is the one deliberate exception to the global filter.** Every other panel
 * on the page counts only the active range; this one always draws the whole Archive and
 * *shades* the selection instead, so a narrow filter never loses its context. That is
 * why {@link getMonthlyClears} takes no range and the range reaches this component
 * separately: the data is the history, and the range is an annotation on top of it.
 *
 * **Two SVGs rather than one, sharing an axis by construction.** Both carry the same
 * `viewBox` width and both are `w-full`, so viewBox unit *n* is the same x in each
 * however wide the page is; the band is drawn in both from one
 * {@link timelineBand} result. Stacking them in one SVG would make the two regions'
 * heights a single scale factor, and `preserveAspectRatio="none"` — which is what keeps
 * the chart full-bleed at any width without shrinking text, since there is no text
 * inside either SVG — would then squash the bars whenever the line grew.
 *
 * No chart library: this repo has none, #81 asks for none, and the `By year` bars on
 * this page are already a div with a percentage width. Adding a dependency to draw two
 * polylines is a decision for the user, not a default.
 */
export function ArchiveTimeline({
    months,
    range,
}: {
    months: ArchiveTimelineMonth[];
    range: ResolvedArchiveRange;
}) {
    // Everything below is in viewBox units of this width, in both charts. It is a
    // resolution rather than a size — `preserveAspectRatio="none"` stretches it to
    // whatever the column is — so it only has to be large enough that 68 monthly bars
    // land on distinguishable coordinates.
    const AXIS_WIDTH = 1000;
    const LINE_HEIGHT = 120;
    const BAR_HEIGHT = 48;

    const total = months.length === 0 ? 0 : months[months.length - 1].cumulativeClears;
    // Seeded with only the two fields the caption reads, so the shape says what this is:
    // a max-by-clears, not an ArchiveTimelineMonth.
    const peak = months.reduce<{ month: string; clears: number }>(
        (busiest, month) => (month.clears > busiest.clears ? month : busiest),
        { month: '', clears: 0 }
    );
    // The geometry works in month keys alone — it is the axis, not the data — so both
    // charts and the band are positioned from the same list of `YYYY-MM` strings.
    const monthKeys = months.map((month) => month.month);
    const band = timelineBand(monthKeys, range);
    // Derived here rather than passed in, next to the band it describes: the sentence and
    // the rect are then two readings of one `range` value instead of two props that could
    // arrive from different ones.
    const scope = describeArchiveRange(range);
    const ticks = yearTicks(monthKeys);
    const step = months.length === 0 ? 0 : AXIS_WIDTH / months.length;

    // The cumulative total at the *end* of each month, which is the instant it is true:
    // a month's clears have all happened by its last day, not by its first. Prefixed
    // with the origin so the line starts at zero rather than at January's total.
    const climb = [
        `0,${LINE_HEIGHT}`,
        ...months.map((month, index) => {
            const y = total === 0 ? LINE_HEIGHT : LINE_HEIGHT * (1 - month.cumulativeClears / total);
            return `${(index + 1) * step},${y}`;
        }),
    ].join(' ');

    return (
        <section aria-labelledby="archive-timeline-heading" className="space-y-3">
            <h2 id="archive-timeline-heading" className="text-xl font-semibold ui-text-primary">
                Six years, month by month
            </h2>

            {/* The population, as every panel states it (#81) — and this one has to say
                two things where the others say one, because the chart's population and
                the reader's selection are deliberately different here. */}
            <p className="ui-text-secondary text-sm leading-6">
                Pinned Full Clears across the whole Archive, always — this is the one panel that
                does not narrow to the filter, so a range keeps its context.{' '}
                {/* Driven off `band`, not off `range.mode`: the sentence and the rect are
                    then the same decision rather than two readings of the range that could
                    disagree. "The shaded band is clears 103–143" above a chart with no band
                    on it is the failure, and it is the kind that renders perfectly. */}
                {band === null
                    ? 'Pick a range above to shade it here.'
                    : `The shaded band is ${scope}.`}
            </p>

            {/* One container so the two charts, the band and the year ticks are one
                block at any width, and a testid on it because a spec that wants "the
                timeline" wants both charts together. */}
            <div data-testid="archive-timeline" className="space-y-1">
                <p className="ui-text-secondary text-xs">
                    Cumulative: 0 to {total.toLocaleString()} Pinned Full Clears
                </p>

                {/* role="img" with a label rather than an unlabelled graphic: the shape is
                    the content here, and the figures a screen reader needs are in the two
                    captions either side of it rather than inside the SVG. */}
                <svg
                    viewBox={`0 0 ${AXIS_WIDTH} ${LINE_HEIGHT}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`Cumulative Pinned Full Clears, rising to ${total.toLocaleString()}`}
                    className="h-24 w-full ui-accent-text sm:h-32"
                >
                    <ShadedBand band={band} height={LINE_HEIGHT} />
                    {/* `vector-effect` because preserveAspectRatio="none" scales x and y
                        by different factors, which would otherwise render the stroke as a
                        wedge — thin where the chart is wide. */}
                    <polyline
                        points={climb}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                    />
                </svg>

                <svg
                    viewBox={`0 0 ${AXIS_WIDTH} ${BAR_HEIGHT}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={
                        peak.clears === 0
                            ? 'Pinned Full Clears per month'
                            : `Pinned Full Clears per month, peaking at ${peak.clears} in ${peak.month}`
                    }
                    className="h-12 w-full ui-text-secondary"
                >
                    <ShadedBand band={band} height={BAR_HEIGHT} />
                    {months.map((month, index) => {
                        // A month with no clears draws no bar, and that is the point of
                        // the gap-filled query: it still occupies its slot on the axis, so
                        // the space between two bars is time rather than a missing row.
                        const height = peak.clears === 0 ? 0 : BAR_HEIGHT * (month.clears / peak.clears);
                        return (
                            <rect
                                key={month.month}
                                x={index * step + step * 0.15}
                                y={BAR_HEIGHT - height}
                                width={step * 0.7}
                                height={height}
                                fill="currentColor"
                            />
                        );
                    })}
                </svg>

                {/* Year labels as HTML rather than SVG text: the SVGs stretch
                    non-uniformly, which would render text as a smear, and HTML text stays
                    at a real font size on a phone instead of scaling to six pixels. */}
                <div className="relative h-4 select-none" aria-hidden>
                    {ticks.map((tick) => (
                        <span
                            key={tick.year}
                            className="ui-text-secondary absolute top-0 text-[10px] tabular-nums"
                            style={{
                                left: `${tick.percent}%`,
                                // A label sits to the right of the boundary it marks,
                                // except when that would take it off the chart: the last
                                // year starts at ~97% of the axis, and four digits there
                                // overflowed the panel by 13px at 360px wide (the phone
                                // spec caught it). Flipped, the label ends at its
                                // boundary instead of starting at it — still anchored to
                                // the truth, and inside the box.
                                transform: tick.percent > 90 ? 'translateX(-100%)' : undefined,
                            }}
                        >
                            {tick.year}
                        </span>
                    ))}
                </div>

                <p className="ui-text-secondary text-xs">
                    {peak.clears === 0
                        ? 'No Pinned Full Clears in the Archive.'
                        : `Per month: busiest was ${peak.clears.toLocaleString()} in ${formatArchiveMonth(peak.month)}.`}
                    {/* Through the page's one day-range formatter: it already collapses a
                        single-day selection to one date and already answers for null ends,
                        which is what the extra two clauses here used to re-check. */}
                    {band !== null ? ` Shaded: ${formatArchiveDayRange(range)}.` : ''}
                </p>
            </div>
        </section>
    );
}

/**
 * The band shading the active range, drawn identically into both charts.
 *
 * One component rather than two rects so that the two charts cannot drift: #88 requires
 * the shading to "read across both", which is a claim about them being the same
 * geometry, not merely similar. The testid is on both copies deliberately — the browser
 * spec asserts there are two of them and that their extents match, which is the only
 * seam that can observe that property at all.
 */
function ShadedBand({
    band,
    height,
}: {
    band: { startPercent: number; endPercent: number } | null;
    height: number;
}) {
    // Unfiltered draws nothing: a band covering the whole chart reads as a selection.
    if (band === null) return null;

    // Percentages straight onto the rect, which SVG resolves against the viewBox width.
    // Converting them back into user units would mean this component being handed the
    // same AXIS_WIDTH its `viewBox` uses and multiplying by it — a third prop whose only
    // job is to agree with the axis, and a way for it to disagree.
    return (
        <rect
            data-testid="archive-timeline-band"
            x={`${band.startPercent}%`}
            y={0}
            width={`${band.endPercent - band.startPercent}%`}
            height={height}
            className="ui-accent-text"
            fill="currentColor"
            fillOpacity={0.18}
        />
    );
}
