import { isDatabaseMaintenanceError } from '@/lib/db';
import { getRaidsInProgress, type RaidsInProgressSeries } from '@/lib/db/queries';
import { getOrCompute } from '@/lib/cache/swr-cache';
import { envSeconds } from '@/lib/env';
import { ActivityChart } from './ActivityChart';
import { ActivityRangeControl } from './ActivityRangeControl';
import { parseActivityRange, type ActivityRange } from './activity-range';

/**
 * Raid Activity (#194, parent #51): how many raid instances were in progress over the last
 * 24 hours, 7 days or 30 days (`?range=`, #195), one point per step, rebuilt from PGCRs. Not
 * from Session Snapshots, which don't measure activity (ADR 0009).
 *
 * Built up along #51's chain: #194's tracer bullet (the total line, UTC labels, the span
 * after the last counted step shaded), #195's range presets, then #196's Provisional
 * estimate, #197's tooltips in local time and #198–#199's per-raid panel — each through the
 * query's options and the geometry module, not a new read.
 *
 * **Server-rendered, with no new endpoint**: the page calls the Tracker query module
 * directly, and the chart is hand-made SVG with no client JavaScript.
 *
 * **Cached on the analytics cache lifetime.** `force-dynamic` so a build never reads the
 * Tracker, and the series itself is held in the in-process stale-while-revalidate cache
 * for `ANALYTICS_CACHE_FRESH_SEC` (300s), the same lifetime and knobs as the two analytics
 * endpoints. Next's `revalidate` export can't do this: it must be a literal, so it can't
 * read the env knob, and it would prerender the page at build time against whatever
 * database the build machine has. The series carries its own "now", so a cached one
 * still shades the right span. One cache key per range: an uncached 30-day series costs
 * ~1 s on x86 (~2 s on the ARM box), nearly the whole PGCR table, and that was accepted
 * behind the cache rather than built around (#195).
 */
export const dynamic = 'force-dynamic';

export default async function ActivityPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const range = parseActivityRange(await searchParams);
    let series: RaidsInProgressSeries | null;
    try {
        series = await readSeries(range);
    } catch (error) {
        if (!isDatabaseMaintenanceError(error)) throw error;
        series = null;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold ui-text-primary">Raid Activity</h1>
                <p className="ui-text-secondary">
                    How many raids were in progress across every raid, averaged over each{' '}
                    {range.step} of the last {range.span}. Every raid instance counts,
                    checkpoint runs and unfinished ones included. Times are UTC.
                </p>
                <ActivityRangeControl range={range.id} />
            </header>
            {series === null ? (
                <p className="ui-text-secondary">
                    Database maintenance is in progress. Raid Activity is temporarily unavailable.
                </p>
            ) : (
                <ActivityChart series={series} range={range} />
            )}
        </div>
    );
}

async function readSeries(range: ActivityRange): Promise<RaidsInProgressSeries> {
    const freshSec = envSeconds('ANALYTICS_CACHE_FRESH_SEC', 300);
    const swrSec = envSeconds('ANALYTICS_CACHE_SWR_SEC', 1800);
    const { value } = await getOrCompute(
        `raids-in-progress:${range.id}`,
        { freshMs: freshSec * 1000, staleMs: swrSec * 1000 },
        () => getRaidsInProgress({
            rangeSeconds: range.rangeSeconds,
            stepSeconds: range.stepSeconds,
            now: Math.floor(Date.now() / 1000),
        })
    );
    return value;
}
