import { yearBarSegments } from './year-bar';

/**
 * The Archive page's proportional bar, scaled to the largest row in its own panel.
 *
 * One implementation for the panels that draw one — the participants panel (#94) and the
 * class split (#94), plus the By year bar's first segment below — for the same reason
 * ./duration-copy.ts and ./share-copy.ts exist: the height, the opacity and the sub-pixel
 * floor are one rendering decision, and panels deciding it separately is how a populated
 * row reads as empty on one of them and not on the others. That had already started: the
 * By year bar shipped without the floor the two #94 panels then added.
 *
 * Decoration for a figure already stated in text beside it, so it carries no accessible
 * name of its own — the count is the row's, and a second name could drift from it.
 */
export function ShareBar({ value, of }: { value: number; of: number }) {
    return (
        <Segment
            percent={(value / of) * 100}
            populated={value > 0}
            className="rounded-sm bg-current opacity-40"
        />
    );
}

/**
 * The By year bar (#111): that year's Full Clears in the bar's usual colour, then every
 * other Run in faded red, together its Runs on the same scale as the other years. Two
 * segments rather than one per population — see ./year-bar.ts.
 *
 * A year of nothing but Full Clears draws no red, and a year with none is all red: an
 * empty segment renders nothing rather than the floor, so neither colour appears for a
 * population the year does not have.
 */
export function YearBar({ year, of }: { year: { runs: number; fullClears: number }; of: number }) {
    const segments = yearBarSegments(year, of);
    const hasClears = year.fullClears > 0;
    const hasRest = year.runs > year.fullClears;
    // Rounded only at the bar's two outer ends, wherever those fall: rounding each
    // segment whole would notch the bar where the two meet.
    return (
        <div className="flex">
            <Segment
                percent={segments.fullClears}
                populated={hasClears}
                className={`rounded-l-sm bg-current opacity-40 ${hasRest ? '' : 'rounded-r-sm'}`}
            />
            <Segment
                percent={segments.rest}
                populated={hasRest}
                className={`rounded-r-sm bg-red-500 opacity-30 ${hasClears ? '' : 'rounded-l-sm'}`}
            />
        </div>
    );
}

function Segment({
    percent,
    populated,
    className,
}: {
    percent: number;
    populated: boolean;
    className: string;
}) {
    return (
        <div
            className={`h-2 shrink-0 ${className}`}
            style={{
                width: `${percent}%`,
                // A populated row must not render as nothing: the class split's unknown
                // row is 0.2% of production, which rounds to a sub-pixel bar.
                minWidth: populated ? '2px' : undefined,
            }}
        />
    );
}
