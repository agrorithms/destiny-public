import type { RaidsInProgressSeries } from '@/lib/db/queries';
import { rangeOfSeries } from './activity-range';
import {
    CHART_HEIGHT,
    CHART_WIDTH,
    axisTicks,
    beforeData,
    busiestStep,
    describeBeforeData,
    describePeak,
    linePaths,
    provisionalLegend,
    tallestStep,
    tooRecent,
    tooRecentLegend,
    valueAxis,
    type ShadedSpan,
} from './activity-geometry';

/**
 * The shades' fill, shared by both shaded spans and their keys in the caption. One look
 * for both: each says "no data drawn here", and the legend says which end is which.
 */
const SHADE_FILL = 'var(--ui-text-muted)';
const SHADE_OPACITY = 0.35;

/**
 * The Raid Activity chart (#194–#196): one line of total Raids in Progress, one point per
 * step of the chosen range. Counted steps are drawn solid; the steps too recent to count
 * but old enough to estimate (the Provisional estimate, ADR 0009) continue it dashed from
 * the last counted point; the last 15 minutes or so, too recent to estimate, are shaded at
 * the right-hand edge. When the stored PGCRs start inside the window, the span before
 * them is shaded at the left.
 *
 * A server component drawing hand-made SVG, with no chart library and no client
 * JavaScript, so it draws exactly the same with JavaScript off. Every position comes from
 * ./activity-geometry.ts; this file only draws what it is handed.
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
    const ticks = axisTicks(from, to, range);
    const { solid, dashed } = linePaths(points, from, to, axis.max);
    const shade = tooRecent(series);
    const missing = beforeData(series);
    const peak = describePeak(busiest, range);

    return (
        <figure data-testid="activity-chart" className="ui-card space-y-3 p-4">
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

                <div className="min-w-0 flex-1 space-y-1">
                    <svg
                        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                        preserveAspectRatio="none"
                        role="img"
                        aria-label={peak.ariaLabel}
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
                        {ticks.map((tick) => (
                            <line
                                key={`x${tick.percent}`}
                                x1={`${tick.percent}%`}
                                x2={`${tick.percent}%`}
                                y1={0}
                                y2={CHART_HEIGHT}
                                stroke="var(--ui-border-subtle)"
                                strokeWidth={1}
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        {missing === null ? null : <ShadeRect testId="activity-before-data" span={missing} />}
                        <ShadeRect testId="activity-too-recent" span={shade} />
                        {/* `vector-effect` because the non-uniform stretch would otherwise draw
                            the stroke as a wedge, thin where the chart is wide. */}
                        <path
                            data-testid="activity-line"
                            d={solid}
                            fill="none"
                            stroke="var(--ui-accent)"
                            strokeWidth={2}
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                        />
                        {dashed === null ? null : (
                            <path
                                data-testid="activity-provisional-line"
                                d={dashed}
                                fill="none"
                                stroke="var(--ui-accent)"
                                strokeWidth={2}
                                strokeLinejoin="round"
                                strokeDasharray="6 4"
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                    </svg>

                    <div className="relative h-4 select-none" aria-hidden>
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
                </div>
            </div>

            <figcaption className="ui-text-secondary space-y-1 text-xs leading-5">
                <p data-testid="activity-peak">{peak.caption}</p>
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
                        <span data-testid="activity-before-data-legend">{describeBeforeData(series.countedFrom)}</span>
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
            <line x1={0} x2={12} y1={6} y2={6} stroke="var(--ui-accent)" strokeWidth={2} strokeDasharray="4 2" />
        </svg>
    );
}
