import type { RaidsInProgressSeries } from '@/lib/db/queries';
import { rangeOfSeries } from './activity-range';
import {
    CHART_HEIGHT,
    CHART_WIDTH,
    beforeData,
    busiestStep,
    linePaths,
    peakAriaLabel,
    provisionalLegend,
    tallestStep,
    tooRecent,
    tooRecentLegend,
    valueAxis,
    type ShadedSpan,
} from './activity-geometry';
import { activitySlots } from './activity-tooltips';
import { ActivityHover, LocalBeforeData, LocalGridlines, LocalPeak, LocalTickLabels } from './ActivityLocal';

/**
 * The shades' fill, shared by both shaded spans and their keys in the caption. One look
 * for both: each says "no data drawn here", and the legend says which end is which.
 */
const SHADE_FILL = 'var(--ui-text-muted)';
const SHADE_OPACITY = 0.35;

/** The line's colour, shared by the counted and estimated paths and the dashed key. */
const LINE_COLOUR = 'var(--ui-accent)';

/**
 * The stroke both paths of the line share, so the estimate differs from the count only by its
 * dash. `vector-effect` because the non-uniform stretch would otherwise draw the stroke as a
 * wedge, thin where the chart is wide.
 */
const LINE_STROKE = {
    fill: 'none',
    stroke: LINE_COLOUR,
    strokeWidth: 2,
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
} as const;

/**
 * The Raid Activity chart (#194–#197): one line of total Raids in Progress, one point per
 * step of the chosen range. Counted steps are drawn solid; the steps too recent to count
 * but old enough to estimate (the Provisional estimate, ADR 0009) continue it dashed from
 * the last counted point; the last 15 minutes or so, too recent to estimate, are shaded at
 * the right-hand edge. When the stored PGCRs start inside the window, the span before
 * them is shaded at the left.
 *
 * A server component drawing hand-made SVG, with no chart library, so it draws exactly the
 * same with JavaScript off. Every position comes from ./activity-geometry.ts; this file only
 * draws what it is handed. The one client step (./ActivityLocal.tsx, #197) puts the gridlines,
 * the labels and the sentences that name a time into the reader's time zone, and adds the
 * hover and tap tooltips; the line, the dashed line and the shades are never touched by it,
 * and with JavaScript off the chart is labelled in UTC and says so.
 *
 * The range — the ticks and the caption's wording — is read off the series itself
 * ({@link rangeOfSeries}) rather than handed in beside it, so the step the shades are
 * sized by and the step the caption names are always the same one.
 *
 * Text is HTML rather than SVG `<text>`: the SVG stretches non-uniformly
 * (`preserveAspectRatio="none"`, so it fills the column at any width), which would smear
 * text, and HTML labels keep a real font size on a phone. The same reason as the /gos10k
 * timeline, whose approach this follows.
 */
export function ActivityChart({ series }: { series: RaidsInProgressSeries }) {
    const { from, to, points } = series;
    const range = rangeOfSeries(series);
    const busiest = busiestStep(points);
    const axis = valueAxis(tallestStep(points));
    const { solid, dashed } = linePaths(points, from, to, axis.max);
    const shade = tooRecent(series);
    const missing = beforeData(series);

    // `data-window-from` / `data-window-to` are for e2e/activity.spec.ts and nothing in the
    // app reads them. The window is request-time state ("now" at render), which the seed
    // cannot reproduce, so the spec reads it here to turn a label's position into the instant
    // that label marks.
    return (
        <figure data-testid="activity-chart" data-window-from={from} data-window-to={to} className="ui-card space-y-3 p-4">
            <div className="flex gap-2">
                {/* The y-axis labels, each centred on its gridline. */}
                <div className="relative w-9 shrink-0 select-none" aria-hidden>
                    {axis.ticks.map((tick) => (
                        <span
                            key={tick.value}
                            className="ui-text-secondary absolute right-0 translate-y-1/2 text-[10px] tabular-nums"
                            style={{ bottom: `${tick.percent}%` }}
                        >
                            {tick.label}
                        </span>
                    ))}
                </div>

                <div className="min-w-0 flex-1">
                    <ActivityHover slots={activitySlots(points)} from={from} to={to}>
                        <svg
                            data-timeline-part="total"
                            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                            preserveAspectRatio="none"
                            role="img"
                            aria-label={peakAriaLabel(busiest, range)}
                            className="block h-48 w-full sm:h-64"
                        >
                            {axis.ticks.map((tick) => (
                                <line
                                    key={`y${tick.value}`}
                                    x1={0}
                                    x2={CHART_WIDTH}
                                    y1={tick.y}
                                    y2={tick.y}
                                    stroke="var(--ui-border-subtle)"
                                    strokeWidth={1}
                                    vectorEffect="non-scaling-stroke"
                                />
                            ))}
                            <LocalGridlines from={from} to={to} range={range} />
                            {missing === null ? null : <ShadeRect testId="activity-before-data" span={missing} />}
                            <ShadeRect testId="activity-too-recent" span={shade} />
                            <path data-testid="activity-line" d={solid} {...LINE_STROKE} />
                            {dashed === null ? null : (
                                <path data-testid="activity-provisional-line" d={dashed} {...LINE_STROKE} strokeDasharray="6 4" />
                            )}
                        </svg>

                        <LocalTickLabels from={from} to={to} range={range} />
                    </ActivityHover>
                </div>
            </div>

            <figcaption className="ui-text-secondary space-y-1 text-xs leading-5">
                <p data-testid="activity-peak">
                    <LocalPeak busiest={busiest} range={range} />
                </p>
                {dashed === null ? null : (
                    <p className="flex items-start gap-2">
                        <DashKey />
                        <span>
                            <span data-testid="activity-provisional-legend">{provisionalLegend(series.stepSeconds)}</span>{' '}
                            A raid still running has no report yet, so the count of raids that have ended is scaled up by
                            the share usually reported by then. The counted steps beside it are still being filled in, so
                            the line can step up where it turns dashed.
                        </span>
                    </p>
                )}
                <p className="flex items-start gap-2">
                    <ShadeKey />
                    <span>
                        <span data-testid="activity-too-recent-legend">{tooRecentLegend(series.stepSeconds)}</span>{' '}
                        Too few of its raids have a report yet to scale up.
                    </span>
                </p>
                {missing === null ? null : (
                    <p className="flex items-start gap-2">
                        <ShadeKey />
                        <span data-testid="activity-before-data-legend"><LocalBeforeData countedFrom={series.countedFrom} /></span>
                    </p>
                )}
            </figcaption>
        </figure>
    );
}

/**
 * A shaded span on the chart. Percentages straight onto the rect, which SVG resolves
 * against the viewBox width, so it sits on the same axis as the line.
 */
function ShadeRect({ testId, span }: { testId: string; span: ShadedSpan }) {
    return (
        <rect
            data-testid={testId}
            x={`${span.startPercent}%`}
            y={0}
            width={`${span.widthPercent}%`}
            height={CHART_HEIGHT}
            fill={SHADE_FILL}
            fillOpacity={SHADE_OPACITY}
        />
    );
}

/** The shades' swatch in the caption. */
function ShadeKey() {
    return (
        <span
            aria-hidden
            className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
            style={{ background: SHADE_FILL, opacity: SHADE_OPACITY }}
        />
    );
}

/** The dashed line's swatch in the caption: a short dashed stroke in the line's colour. */
function DashKey() {
    return (
        <svg aria-hidden viewBox="0 0 12 12" className="mt-1 h-3 w-3 shrink-0">
            <line x1={0} x2={12} y1={6} y2={6} stroke={LINE_COLOUR} strokeWidth={2} strokeDasharray="4 2" />
        </svg>
    );
}
