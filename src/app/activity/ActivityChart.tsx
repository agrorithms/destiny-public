import type { RaidsInProgressSeries } from '@/lib/db/queries';
import {
    CHART_HEIGHT,
    CHART_WIDTH,
    busiestStep,
    dayTicks,
    formatRaidCount,
    formatStepWindow,
    linePath,
    notYetCounted,
    valueAxis,
} from './activity-geometry';

/**
 * The Raid Activity chart (#194): one line of total Raids in Progress, one point per step,
 * with the span too recent to count shaded at the right-hand edge.
 *
 * A server component drawing hand-made SVG, with no chart library and no client
 * JavaScript, so it draws exactly the same with JavaScript off. Every position comes from
 * ./activity-geometry.ts; this file only draws what it is handed.
 *
 * Text is HTML rather than SVG `<text>`: the SVG stretches non-uniformly
 * (`preserveAspectRatio="none"`, so it fills the column at any width), which would smear
 * text, and HTML labels keep a real font size on a phone. The same reason as the /gos10k
 * timeline, whose approach this follows.
 */
export function ActivityChart({ series }: { series: RaidsInProgressSeries }) {
    const { from, to, points } = series;
    const busiest = busiestStep(points);
    const axis = valueAxis(busiest?.total ?? 0);
    const ticks = dayTicks(from, to);
    const shade = notYetCounted(series);
    const peak = busiest === null
        ? null
        : `${formatRaidCount(busiest.total)} raids in progress, ${formatStepWindow(busiest.start, busiest.end)}`;

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
                        aria-label={
                            peak === null
                                ? 'Raids in progress per hour over the last 7 days: none counted yet'
                                : `Raids in progress per hour over the last 7 days, peaking at ${peak}`
                        }
                        className="block h-48 w-full sm:h-64"
                    >
                        {axis.ticks.map((tick) => (
                            <line
                                key={`y${tick.value}`}
                                x1={0}
                                x2={CHART_WIDTH}
                                y1={CHART_HEIGHT * (1 - tick.percent / 100)}
                                y2={CHART_HEIGHT * (1 - tick.percent / 100)}
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
                        {/* Percentages straight onto the rect, which SVG resolves against the
                            viewBox width, so it sits on the same axis as the line. */}
                        <rect
                            data-testid="activity-not-yet-counted"
                            x={`${shade.startPercent}%`}
                            y={0}
                            width={`${shade.endPercent - shade.startPercent}%`}
                            height={CHART_HEIGHT}
                            fill="var(--ui-text-muted)"
                            fillOpacity={0.35}
                        />
                        {/* `vector-effect` because the non-uniform stretch would otherwise draw
                            the stroke as a wedge, thin where the chart is wide. */}
                        <path
                            data-testid="activity-line"
                            d={linePath(points, from, to, axis.max)}
                            fill="none"
                            stroke="var(--ui-accent)"
                            strokeWidth={2}
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                        />
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
                <p data-testid="activity-peak">
                    {peak === null ? 'No raids counted in the last 7 days yet.' : `Busiest hour: ${peak}.`}
                </p>
                <p className="flex items-start gap-2">
                    <span
                        aria-hidden
                        className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
                        style={{ background: 'var(--ui-text-muted)', opacity: 0.35 }}
                    />
                    <span>
                        Shaded: the last 2 hours, not yet counted. A raid still running has no
                        report yet, so this stretch would read low.
                    </span>
                </p>
            </figcaption>
        </figure>
    );
}
