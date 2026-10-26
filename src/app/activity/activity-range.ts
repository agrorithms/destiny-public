/**
 * The Raid Activity chart's range presets (#195): 24h, 7d and 30d, kept in `?range=` so a
 * reload or a shared link shows the same chart. Prior art: the leaderboard's `?board=`
 * (src/app/leaderboard/leaderboard-board.ts). Not the /gos10k range parser, which belongs
 * to the Archive and stays out of Tracker pages (ADR 0007).
 *
 * Every point is a step average, so each range also fixes its step: short enough to show
 * the range's shape, long enough that the line stays readable on a phone. The phrases are
 * how the chart's sentences name the step and the span (activity-geometry.ts).
 *
 * Types and literals only, so the page, the chart and the geometry module can all import
 * it without pulling the database onto a client path.
 */

import { ACTIVITY_RAIDS_PARAM } from './activity-raids';

/** The URL's spelling of the range. Absent means 7 days. */
const ACTIVITY_RANGE_PARAM = 'range';

/** Seconds in each unit: the one set the presets and the chart's geometry both count in. */
export const MINUTE = 60;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** One list, three uses: the recogniser, the control's order and labels, and the query's arguments. */
export const ACTIVITY_RANGES = [
    { id: '24h', label: '24h', rangeSeconds: DAY, stepSeconds: 10 * MINUTE, step: '10 minutes', span: '24 hours' },
    { id: '7d', label: '7d', rangeSeconds: 7 * DAY, stepSeconds: HOUR, step: 'hour', span: '7 days' },
    { id: '30d', label: '30d', rangeSeconds: 30 * DAY, stepSeconds: 3 * HOUR, step: '3 hours', span: '30 days' },
] as const;

export type ActivityRange = (typeof ACTIVITY_RANGES)[number];
export type ActivityRangeId = ActivityRange['id'];

/** The default: a week shows both the daily cycle and the weekday/weekend difference. */
const DEFAULT_ACTIVITY_RANGE: ActivityRange = ACTIVITY_RANGES[1];

/**
 * Reads the range out of the URL. Anything but one exact preset spelling — missing,
 * unknown, or the key repeated — is 7 days, so a bad link still shows a chart.
 */
export function parseActivityRange(searchParams: Record<string, string | string[] | undefined>): ActivityRange {
    const value = searchParams[ACTIVITY_RANGE_PARAM];
    return ACTIVITY_RANGES.find((range) => range.id === value) ?? DEFAULT_ACTIVITY_RANGE;
}

/**
 * The link to a preset. The range is always spelled out, 7 days included, so every URL
 * the control writes says which chart it is. `raids` (#198) are the bottom panel's, written
 * as `?raids=` in the order given — and only when there are some, so a link written without
 * any leaves the panel on the range's own top raids. The keys are percent-encoded but not
 * their commas, so a shared link stays readable.
 */
export function activityRangeHref(id: ActivityRangeId, raids: readonly string[] = []): string {
    const range = `/activity?${new URLSearchParams({ [ACTIVITY_RANGE_PARAM]: id })}`;
    return raids.length === 0 ? range : `${range}&${ACTIVITY_RAIDS_PARAM}=${raids.map(encodeURIComponent).join(',')}`;
}

/** What {@link rangeOfSeries} reads off a series: its window and its step, both in seconds. */
export interface SeriesShape {
    from: number;
    to: number;
    stepSeconds: number;
}

/**
 * The preset a series was built for, read off its window and step, so the chart takes its
 * wording and ticks from the series it draws rather than from a range handed alongside it
 * that could disagree with it. A series no preset makes — a span or a step that isn't one
 * preset's — throws: drawing it under any preset's wording would mislabel it.
 */
export function rangeOfSeries(series: SeriesShape): ActivityRange {
    const rangeSeconds = series.to - series.from;
    const range = ACTIVITY_RANGES.find(
        (preset) => preset.rangeSeconds === rangeSeconds && preset.stepSeconds === series.stepSeconds
    );
    if (range === undefined) {
        throw new Error(`No Raid Activity preset spans ${rangeSeconds}s in ${series.stepSeconds}s steps`);
    }
    return range;
}
