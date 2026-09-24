/**
 * The Archive page's proportional bar, scaled to the largest row in its own panel.
 *
 * One implementation for the panels that draw one — the participants panel (#94) and the
 * class split (#94), plus the By year bar's segments — for the same reason
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
        <BarSegment
            percent={(value / of) * 100}
            className="rounded-sm bg-current opacity-40"
        />
    );
}

/**
 * One segment of a bar, as a percentage of its panel's full width. Shared with the By
 * year bar (./YearBar.tsx) so both bars keep one height and one sub-pixel floor.
 */
export function BarSegment({ percent, className }: { percent: number; className: string }) {
    return (
        <div
            className={`h-2 shrink-0 ${className}`}
            style={{
                width: `${percent}%`,
                // A populated row must not render as nothing: the class split's unknown
                // row is 0.2% of production, which rounds to a sub-pixel bar. An empty one
                // must render as nothing: a year of only Full Clears draws no red.
                minWidth: percent > 0 ? '2px' : undefined,
            }}
        />
    );
}
