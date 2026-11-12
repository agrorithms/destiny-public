import { redirect } from 'next/navigation';
import { isDatabaseMaintenanceError } from '@/lib/db';
import { getAllRaidDefinitions } from '@/lib/bungie/manifest';
import type { RaidOption } from '@/components/RaidMultiSelect';
import { getRaidsInProgress, type ActivityScope, type RaidsInProgressSeries } from '@/lib/db/queries';
import { getOrCompute } from '@/lib/cache/swr-cache';
import { envCount, envSeconds } from '@/lib/env';
import { ActivityChart } from './ActivityChart';
import { LocalZoneNote } from './ActivityLocal';
import { ActivityRangeControl } from './ActivityRangeControl';
import { ActivityScopeControl } from './ActivityScopeControl';
import { parseActivityRange, rangeOfSeries, type ActivityRange } from './activity-range';
import { isRaidsParamClean, parseActivityRaids, pickRaids } from './activity-raids';
import { parseActivityScope } from './activity-scope';
import { activityHref, type ActivityUrlState } from './activity-url';

/**
 * Raid Activity (#194, parent #51): how many raid instances were in progress over the last
 * 24 hours, 7 days or 30 days (`?range=`, #195), one point per step, rebuilt from PGCRs. Not
 * from Session Snapshots, which don't measure activity (ADR 0009).
 *
 * Built up along #51's chain: #194's tracer bullet (the total line, UTC labels), #195's
 * range presets, #196's Provisional estimate (the steps too recent to count, dashed, and
 * the last 15 minutes shaded), #197's tooltips in local time, #198's per-raid panel and its
 * raid picker (`?raids=`), #199's per-raid estimate and then #204's Scope — each through the query's
 * options and the geometry module, not a new read. **`ACTIVITY_MIN_RAID_RUNS`** (default 5,000,
 * `MIN_RAID_CURVE_RUNS`) is how many runs a raid needs in the past week to get an estimate of
 * its own; the e2e server sets it low because a seed cannot hold 5,000 runs a raid.
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
 * 500-entry store the rest of the site shares. **So are all three Scopes** (#204,
 * `?scope=`): the one sweep returns a series for All Attempts, Fresh Runs and Full Clears,
 * and the page takes the URL's. Scope is a dimension of the cached value, not a cache key
 * (ADR 0006 and ADR 0009, amendments 2026-11-07), so a scope switch adds no cold miss.
 *
 * **The intro's wording follows the series; the control follows the URL.** With a series in
 * hand, the intro names its step and span off the series ({@link rangeOfSeries}), as the
 * chart does, so the sentence above the chart can't describe a different chart from the one
 * drawn; the URL's range is only the fallback when maintenance leaves no series. The range
 * control stays on the URL's range: it is navigation, and it marks the link that was followed.
 * The intro's second sentence names the scope (./activity-scope.ts), since a phone shows the
 * scope links' tooltips to no one.
 */
export const dynamic = 'force-dynamic';

export default async function ActivityPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const range = parseActivityRange(params);
    const scope = parseActivityScope(params);
    const raidOptions = readRaidOptions();
    const raidKeys = raidOptions.map((raid) => raid.key);
    const urlRaids = parseActivityRaids(params, raidKeys);
    const state: ActivityUrlState = { range: range.id, scope: scope.id, raids: urlRaids, view: 'chart' };
    // A `raids` that is not what was read from it (unknown keys, more than five, nothing valid)
    // is redirected to the link that says what is drawn, scope kept. Outside the try: redirect throws.
    if (!isRaidsParamClean(params, urlRaids)) redirect(activityHref(state));
    let series: RaidsInProgressSeries | null;
    try {
        series = (await readSeries(range, raidKeys))[scope.key];
    } catch (error) {
        if (!isDatabaseMaintenanceError(error)) throw error;
        series = null;
    }
    const described = series === null ? range : rangeOfSeries(series);

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold ui-text-primary">Raid Activity</h1>
                <p className="ui-text-secondary" data-testid="activity-intro">
                    How many raids were in progress, averaged over every{' '}
                    {described.step} of the last {described.span}. {scope.intro} <LocalZoneNote />
                </p>
                {/* Navigation, so outside the maintenance branch: both rows stay while the
                    chart is unavailable. */}
                <div className="space-y-2">
                    <ActivityRangeControl state={state} />
                    <ActivityScopeControl state={state} />
                </div>
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
                    scope={scope.id}
                />
            )}
        </div>
    );
}

/**
 * Every raid the picker offers, in the raid table's order: all of them count, Pantheons
 * included.
 */
function readRaidOptions(): RaidOption[] {
    return Object.entries(getAllRaidDefinitions()).map(([key, definition]) => ({ key, name: definition.name }));
}

async function readSeries(range: ActivityRange, raidKeys: readonly string[]): Promise<Record<ActivityScope, RaidsInProgressSeries>> {
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
            // Unset, the query's own default (`MIN_RAID_CURVE_RUNS`), so the default has one owner.
            minRaidRuns: envCount('ACTIVITY_MIN_RAID_RUNS', undefined),
        })
    );
    return value;
}
