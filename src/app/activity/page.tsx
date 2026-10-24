import { isDatabaseMaintenanceError } from '@/lib/db';
import { getRaidsInProgress, type RaidsInProgressSeries } from '@/lib/db/queries';
import { getOrCompute } from '@/lib/cache/swr-cache';
import { envSeconds } from '@/lib/env';
import { ActivityChart } from './ActivityChart';

/**
 * Raid Activity (#194, parent #51): how many raid instances were in progress over the last
 * 7 days, one point per hour, rebuilt from PGCRs. Not from Session Snapshots, which don't
 * measure activity (ADR 0009, which lands with #192).
 *
 * The tracer bullet of #51's chain: one range, the total line only, UTC labels, and the
 * last two hours shaded as not yet counted. #195 adds the range presets, #196 the
 * Provisional estimate, #197 tooltips in local time, #198–#199 the per-raid panel — each
 * through the query's options and the geometry module, not a new read.
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
 * still shades the right span.
 */
export const dynamic = 'force-dynamic';

/** The tracer bullet's one range: 7 days at 1-hour steps. #195 turns this into `?range=`. */
const SEVEN_DAYS = { rangeSeconds: 7 * 24 * 60 * 60, stepSeconds: 60 * 60 };

export default async function ActivityPage() {
    let series: RaidsInProgressSeries | null;
    try {
        series = await readSeries();
    } catch (error) {
        if (!isDatabaseMaintenanceError(error)) throw error;
        series = null;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold ui-text-primary">Raid Activity</h1>
                <p className="ui-text-secondary">
                    How many raids were in progress across every raid, averaged over each hour
                    of the last 7 days. Every raid instance counts, checkpoint runs and
                    unfinished ones included. Times are UTC.
                </p>
            </header>
            {series === null ? (
                <p className="ui-text-secondary">
                    Database maintenance is in progress. Raid Activity is temporarily unavailable.
                </p>
            ) : (
                <ActivityChart series={series} />
            )}
        </div>
    );
}

async function readSeries(): Promise<RaidsInProgressSeries> {
    const freshSec = envSeconds('ANALYTICS_CACHE_FRESH_SEC', 300);
    const swrSec = envSeconds('ANALYTICS_CACHE_SWR_SEC', 1800);
    const { value } = await getOrCompute(
        'raids-in-progress:7d',
        { freshMs: freshSec * 1000, staleMs: swrSec * 1000 },
        () => getRaidsInProgress({ ...SEVEN_DAYS, now: Math.floor(Date.now() / 1000) })
    );
    return value;
}
