import type { ArchiveYear } from '@/lib/db/archive/queries';
import { BarSegment } from './ShareBar';
import { yearBarSegments } from './year-bar';

/**
 * The By year bar (#111): that year's Full Clears in the bar's usual colour, then every
 * other Run in faded red, together its Runs on the same scale as the other years. Two
 * segments rather than one per population — see ./year-bar.ts.
 *
 * A year of nothing but Full Clears draws no red, and a year with none is all red: an
 * empty segment renders nothing rather than the floor, so neither colour appears for a
 * population the year does not have.
 *
 * Decoration, like ./ShareBar.tsx: both counts are stated in the row's own columns.
 */
export function YearBar({ year, of }: { year: Pick<ArchiveYear, 'runs' | 'fullClears'>; of: number }) {
    const segments = yearBarSegments(year, of);
    // Rounded only at the bar's two outer ends, wherever those fall: rounding each
    // segment whole would notch the bar where the two meet.
    return (
        <div className="flex">
            <BarSegment
                percent={segments.fullClears}
                className={`rounded-l-sm bg-current opacity-40 ${segments.rest > 0 ? '' : 'rounded-r-sm'}`}
            />
            <BarSegment
                percent={segments.rest}
                className={`rounded-r-sm bg-red-500 opacity-30 ${segments.fullClears > 0 ? '' : 'rounded-l-sm'}`}
            />
        </div>
    );
}
