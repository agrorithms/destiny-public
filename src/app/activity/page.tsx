import { redirect } from 'next/navigation';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import { getRaidsInProgress, type RaidsInProgressSeries } from '@/lib/db/queries';
import { getOrCompute } from '@/lib/cache/swr-cache';
import { envSeconds } from '@/lib/env';
import { ActivityChart } from './ActivityChart';
import { LocalZoneNote } from './ActivityLocal';
import { ActivityRangeControl } from './ActivityRangeControl';
import { activityRangeHref, parseActivityRange, rangeOfSeries, type ActivityRange } from './activity-range';
import { isRaidsParamClean, parseActivityRaids, pickRaids } from './activity-raids';

/**
 * Raid Activity (#194, parent #51): how many raid instances were in progress over the last
 * 24 hours, 7 days or 30 days (`?range=`, #195), one point per step, rebuilt from PGCRs. Not
 * from Session Snapshots, which don't measure activity (ADR 0009).
 *
 * Built up along #51's chain: #194's tracer bullet (the total line, UTC labels), #195's
 * range presets, #196's Provisional estimate (the steps too recent to count, dashed, and
 * the last 15 minutes shaded), #197's tooltips in local time, #198's per-raid panel and its
 * raid picker (`?raids=`) and then #199's per-raid estimate — each through the query's
 * options and the geometry module, not a new read.
 *
 * **Server-rendered, with no new endpoint**: the page calls the Tracker query module
 * directly, and the chart is hand-made SVG. The one client step (#197,
 * ./ActivityLocal.tsx) puts the labels and tooltips in the reader's time zone after
 * hydration; the server's render, and a reader's with JavaScript off, is UTC and says so.
 *
 * **Cached on the analytics cache lifetime.** `force-dynamic` so a build never reads the
 * Tracker, and the series itself is held in the in-process stale-while-revalidate cache
 * for `ANALYTICS_CACHE_FRESH_SEC` (300s), the same lifetime and knobs as the two analytics
 * endpoints. Next's `revalidate` export can't do this: it must be a literal, so it can't
 * read the env knob, and it would prerender the page at build time against whatever
 * database the build machine has. The series carries its own "now", so a cached one
 * still shades the right span. The Provisional estimate is learned inside the same compute
 * (a second pass over the PGCRs, ~230 ms on the prod backup on x86), so it is rebuilt on
 * each cache refresh, per range, and costs a visitor nothing once the cache is warm. One
 * cache key per range: an uncached 30-day series costs ~1 s on x86 (~2 s on the ARM box),
 * nearly the whole PGCR table, and that was accepted behind the cache rather than built
 * around (#195). **The per-raid values are cached with it, for every raid** (#198): the
 * query is asked for all of them and the page slices out the picked ones, so the cache has
 * one entry per range however many combinations of raids the URLs name. A key per pick would
 * be a 1–2 second sweep for anyone who writes a new `?raids=`, and would fill the
 * 500-entry store the rest of the site shares.
 *
 * **The intro's wording follows the series; the control follows the URL.** With a series in
 * hand, the intro names its step and span off the series ({@link rangeOfSeries}), as the
 * chart does, so the sentence above the chart can't describe a different chart from the one
 * drawn; the URL's range is only the fallback when maintenance leaves no series. The range
 * control stays on the URL's range: it is navigation, and it marks the link that was followed.
 */
export const dynamic = 'force-dynamic';

export default async function ActivityPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const range = parseActivityRange(params);
    const raidOptions = readRaidOptions();
    const raidKeys = raidOptions.map((raid) => raid.key);
    const urlRaids = parseActivityRaids(params, raidKeys);
    // A `raids` that is not what was read from it (unknown keys, more than five, nothing valid)
    // is redirected to the link that says what is drawn. Outside the try: redirect throws.
    if (!isRaidsParamClean(params, urlRaids)) redirect(activityRangeHref(range.id, urlRaids));
    let series: RaidsInProgressSeries | null;
    try {
        series = await readSeries(range, raidKeys);
    } catch (error) {
        if (!isDatabaseMaintenanceError(error)) throw error;
        series = null;
    }
    const described = series === null ? range : rangeOfSeries(series);

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold ui-text-primary">Raid Activity</h1>
                <p className="ui-text-secondary">
                    How many raids were in progress across every raid, averaged over every{' '}
                    {described.step} of the last {described.span}. Every raid instance counts,
                    checkpoint runs and unfinished ones included. <LocalZoneNote />
                </p>
                <ActivityRangeControl range={range.id} raids={urlRaids} />
            </header>
            {series === null ? (
                <p className="ui-text-secondary">
                    Database maintenance is in progress. Raid Activity is temporarily unavailable.
                </p>
            ) : (
                <ActivityChart
                    series={series}
                    raidOptions={raidOptions}
                    picked={pickRaids(urlRaids, series.topRaids, raidKeys)}
                />
            )}
        </div>
    );
}

/**
 * Every raid the picker offers, in the raid table's order: all of them count, Pantheons
 * included.
 */
function readRaidOptions(): Array<{ key: string; name: string }> {
    return Object.entries(getAllRaidDefinitions()).map(([key, definition]) => ({ key, name: definition.name }));
}

async function readSeries(range: ActivityRange, raidKeys: readonly string[]): Promise<RaidsInProgressSeries> {
    const freshSec = envSeconds('ANALYTICS_CACHE_FRESH_SEC', 300);
    const swrSec = envSeconds('ANALYTICS_CACHE_SWR_SEC', 1800);
    const { value } = await getOrCompute(
        `raids-in-progress:${range.id}`,
        { freshMs: freshSec * 1000, staleMs: swrSec * 1000 },
        () => getRaidsInProgress({
            rangeSeconds: range.rangeSeconds,
            stepSeconds: range.stepSeconds,
            now: Math.floor(Date.now() / 1000),
            raidKeys,
        })
    );
    return value;
}
