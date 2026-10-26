import type { RaidsInProgressPoint, RaidsInProgressSeries } from '@/lib/db/queries';
import { DAY, HOUR, MINUTE, type ActivityRange } from './activity-range';
import { clock, dayLabel, formatInstant, formatStepWindow, localSeconds, type OffsetOf } from './activity-time';

/**
 * Where things sit on the Raid Activity chart (#194, #195): the time ticks and their
 * labels, the y-axis, the line's path, the shaded spans at either end, and the sentences
 * that describe them, each worded for the range (./activity-range.ts). The arithmetic is here
 * rather than in ./ActivityChart.tsx so that `mutate:diff` reaches it and the component
 * only draws what it is handed.
 *
 * **The x-axis is time, `from` to `to`** — the series' window, which ends at "now". Every
 * position is a percentage of that window, so the line, the gridlines, the labels and the
 * shade are all placed by one calculation ({@link xPercent}).
 *
 * **Ticks and labels are in the reader's time zone, or UTC.** The server draws them in UTC
 * (`offsetOf` null); a small client step (./ActivityLocal.tsx) calls the same functions with
 * the browser's offset (./activity-time.ts), so the gridlines move to the reader's midnights.
 * The shapes — the line, the shades — are the same either way. This module takes only types
 * from the query module: anything on its import path reaches the browser, and
 * `@/lib/db/queries` opens better-sqlite3.
 *
 * Pure and free of any clock read: "now" arrives as the series' `to`.
 */

/** The SVG's viewBox, in user units. A resolution, not a size: the chart stretches to its column. */
export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 200;

/**
 * The stroke every gridline shares, x and y: the y gridlines are drawn by the server
 * (./ActivityChart.tsx) and the x ones by the client step (./ActivityLocal.tsx), so the look
 * lives here, where both can import it. `vector-effect` keeps them a pixel wide under the
 * chart's non-uniform stretch.
 */
export const GRIDLINE_STROKE = {
    stroke: 'var(--ui-border-subtle)',
    strokeWidth: 1,
    vectorEffect: 'non-scaling-stroke',
} as const;

/**
 * No day label starts past this point. A label runs rightwards from its midnight, and the
 * widest (`Wed 21`) is about 33px — 11% of the ~296px chart at 360px — so one starting
 * later would run off the panel. Its gridline is still drawn.
 */
export const LAST_LABELLED_TICK_PERCENT = 88;

/** A gridline on the x-axis, and its label, or null where the label would not fit. */
export interface ActivityTick {
    percent: number;
    label: string | null;
    /**
     * Whether the label is also shown on a phone. At 360px a day is ~38px of chart and a
     * label ~35px, so every other day is labelled there, from the first; the gridlines all
     * stay.
     */
    phone: boolean;
}

/**
 * The y-axis: its top value, and a labelled gridline at each round step from 0 up. Each
 * tick sits `percent` of the way up (where the HTML label goes) and at `y` in viewBox units,
 * measured down from the top as SVG does (where the gridline goes).
 */
export interface ValueAxis {
    max: number;
    ticks: Array<{ value: number; label: string; percent: number; y: number }>;
}

/** How far down from the top a value sits, in viewBox units, on an axis topping out at `max`. */
function yAt(value: number, max: number): number {
    return CHART_HEIGHT * (1 - value / max);
}

/** Where an instant sits across the window `[from, to]`, as a percentage of its width. */
export function xPercent(at: number, from: number, to: number): number {
    return ((at - from) / (to - from)) * 100;
}

/**
 * Where a step's window is centred across `[from, to]`, as a percentage of its width: where
 * the line draws the step's vertex, and where its tooltip is anchored.
 */
export function stepCentrePercent(start: number, end: number, from: number, to: number): number {
    return xPercent((start + end) / 2, from, to);
}

/** Which midnights a day axis marks, and how many of its labels a phone keeps. */
export interface DayTickOptions {
    /** A tick on every midnight whose day number since the epoch is a multiple of this. */
    everyDays: number;
    /** On a phone, every this-many ticks keeps its label, from the first. */
    phoneEvery: number;
}

/** The 7-day range's day ticks: every midnight, every other label kept on a phone. */
const DAILY_TICKS: DayTickOptions = { everyDays: 1, phoneEvery: 2 };

/**
 * One tick per midnight (the zone's, or UTC) inside the window, labelled with the weekday
 * and day of the month it begins (`Sat 17`). A 7-day window has seven; a label past
 * {@link LAST_LABELLED_TICK_PERCENT} is dropped and its gridline kept, and on a phone only
 * every other label shows ({@link ActivityTick.phone}). The 30-day range thins them with
 * `options` ({@link axisTicks}).
 */
export function dayTicks(
    from: number,
    to: number,
    options: DayTickOptions = DAILY_TICKS,
    offsetOf: OffsetOf = null
): ActivityTick[] {
    return ticksEvery(
        from,
        to,
        options.everyDays * DAY,
        offsetOf,
        (at) => dayLabel(at, offsetOf),
        (index) => index % options.phoneEvery === 0
    );
}

/** The 24-hour range's tick spacing, and the spacing of the labels a phone keeps. */
const HOUR_TICK_SECONDS = 3 * HOUR;
const PHONE_HOUR_TICK_SECONDS = 6 * HOUR;

/**
 * One tick every 3 hours on the zone's clock inside the window, labelled with its hour
 * (`21:00`), except midnight, which is labelled with the day it begins (`Sat 17`) so a day's
 * chart still shows where one day ends. On a phone only the ticks on a 6-hour boundary keep
 * their label: three hours is ~37px of chart at 360px, and a label ~30px.
 */
export function hourTicks(from: number, to: number, offsetOf: OffsetOf = null): ActivityTick[] {
    return ticksEvery(
        from,
        to,
        HOUR_TICK_SECONDS,
        offsetOf,
        (at, local) => (local % DAY === 0 ? dayLabel(at, offsetOf) : clock(at, offsetOf)),
        (_, local) => local % PHONE_HOUR_TICK_SECONDS === 0
    );
}

/**
 * How finely {@link ticksEvery} looks for a boundary. Every zone's offset from UTC is a
 * whole number of quarter hours, so a boundary on the zone's clock is always on this grid.
 */
const TICK_SCAN_SECONDS = 15 * MINUTE;

/**
 * A tick on every multiple of `every` seconds on the zone's clock inside the window, found
 * by looking at each quarter hour and asking the zone what time it reads there — so a clock
 * change in the window moves the ticks after it, rather than one offset being assumed for
 * all of them. A clock that goes back reads some times twice (the Azores read 00:00 twice on
 * the last Sunday of October): a boundary is ticked once, at the first instant that reads it,
 * so a tick never reads the same as or earlier than the one before it. Labelled by `label`
 * unless it starts past {@link LAST_LABELLED_TICK_PERCENT}, and kept on a phone where `phone`
 * says so. `label` is given the instant and the zone's seconds at it; `phone`, the tick's
 * place from the first and the zone's seconds.
 */
function ticksEvery(
    from: number,
    to: number,
    every: number,
    offsetOf: OffsetOf,
    label: (at: number, local: number) => string,
    phone: (index: number, local: number) => boolean
): ActivityTick[] {
    const ticks: ActivityTick[] = [];
    let lastTicked = -Infinity;
    for (let at = Math.ceil(from / TICK_SCAN_SECONDS) * TICK_SCAN_SECONDS; at <= to; at += TICK_SCAN_SECONDS) {
        const local = localSeconds(at, offsetOf);
        if (local % every !== 0 || local <= lastTicked) continue;
        lastTicked = local;
        const percent = xPercent(at, from, to);
        ticks.push({
            percent,
            label: percent <= LAST_LABELLED_TICK_PERCENT ? label(at, local) : null,
            phone: phone(ticks.length, local),
        });
    }
    return ticks;
}

/**
 * The x-axis ticks a range draws: hours for 24 hours, every midnight for 7 days, and every
 * other midnight for 30 days, on even days since the epoch so the labels don't jump a day
 * whenever the window crosses a midnight. At 30 days two days is ~20px of chart on a
 * phone, so a phone keeps every third label, six days apart.
 */
export function axisTicks(from: number, to: number, range: ActivityRange, offsetOf: OffsetOf = null): ActivityTick[] {
    if (range.id === '24h') return hourTicks(from, to, offsetOf);
    if (range.id === '30d') return dayTicks(from, to, { everyDays: 2, phoneEvery: 3 }, offsetOf);
    return dayTicks(from, to, DAILY_TICKS, offsetOf);
}

/**
 * How many gridlines above zero the y-axis may have. Four keeps the labels a readable
 * distance apart on a phone-height chart.
 */
const MAX_VALUE_STEPS = 4;

/**
 * The y-axis for a series whose busiest step is `busiest`: the smallest round step — 1, 2
 * or 5 times a power of ten, never below 1, since nobody reads "0.5 raids" off an axis —
 * that covers it in {@link MAX_VALUE_STEPS} steps, and the top rounded up to a whole step.
 * A series with nothing counted still gets a top of 1, so the line has a height to sit at
 * the bottom of.
 */
export function valueAxis(busiest: number): ValueAxis {
    const step = roundStep(busiest / MAX_VALUE_STEPS);
    const max = Math.max(1, Math.ceil(busiest / step)) * step;
    const ticks: ValueAxis['ticks'] = [];
    for (let value = 0; value <= max; value += step) {
        ticks.push({ value, label: formatRaidCount(value), percent: (value / max) * 100, y: yAt(value, max) });
    }
    return { max, ticks };
}

/** The smallest of 1, 2, 5, 10, 20, 50, … at least `atLeast`. */
function roundStep(atLeast: number): number {
    for (let power = 1; ; power *= 10) {
        for (const multiple of [1, 2, 5]) {
            if (multiple * power >= atLeast) return multiple * power;
        }
    }
}

/**
 * The line through every point, as an SVG path in viewBox units: each step drawn at its
 * midpoint, because the value is an average over the whole step rather than a reading at
 * its start or end. Heights are measured down from the top, against the axis's `max`.
 * Written to two decimal places, which is far finer than a pixel at any width. `valueOf`
 * says what height a point has: its total, unless a caller draws something else through it.
 */
export function linePath(
    points: RaidsInProgressPoint[],
    from: number,
    to: number,
    max: number,
    valueOf: (point: RaidsInProgressPoint) => number = (point) => point.total
): string {
    return points
        .map((point, index) => {
            const x = (stepCentrePercent(point.start, point.end, from, to) / 100) * CHART_WIDTH;
            return `${index === 0 ? 'M' : 'L'}${round(x)},${round(yAt(valueOf(point), max))}`;
        })
        .join('');
}

/** A shaded span across the chart, as percentages of its width. */
export interface ShadedSpan {
    startPercent: number;
    endPercent: number;
    widthPercent: number;
}

/**
 * The line as two SVG paths: the counted steps solid, and the estimated ones dashed. The
 * dashed path starts on the last counted point, so the two meet and only the style changes
 * at the boundary; with nothing counted it starts at its own first point. It is null when no
 * step is estimated, and the solid one is empty when no step is counted. `valueOf` is
 * {@link linePath}'s: the total's line by default, a raid's on the bottom panel.
 */
export function linePaths(
    points: RaidsInProgressPoint[],
    from: number,
    to: number,
    max: number,
    valueOf?: (point: RaidsInProgressPoint) => number
): { solid: string; dashed: string | null } {
    const counted = points.filter((point) => !point.provisional);
    const estimated = points.filter((point) => point.provisional);
    return {
        solid: linePath(counted, from, to, max, valueOf),
        dashed: estimated.length === 0 ? null : linePath([...counted.slice(-1), ...estimated], from, to, max, valueOf),
    };
}

/**
 * The span shaded as too recent to estimate: from the end of the last estimated step
 * (`provisionalUntil`) to "now" at the right-hand edge. The line's last vertex is that
 * step's midpoint, so the shade starts half a step right of it. 15 minutes plus up to one
 * step wide ({@link tooRecentLegend}). Both panels shade it (#199): the per-raid lines run
 * as far as the total's do.
 */
export function tooRecent(series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'provisionalUntil'>): ShadedSpan {
    const startPercent = xPercent(series.provisionalUntil, series.from, series.to);
    const endPercent = 100;
    return { startPercent, endPercent, widthPercent: endPercent - startPercent };
}

/**
 * The span shaded as before the data starts: from the left-hand edge to where counting
 * starts (`countedFrom`), when the stored PGCRs don't reach back to the window's first
 * whole step — prod keeps 720 hours of them, the 30-day window exactly. Null when counting
 * starts at that first whole step: the part-step before it is the step grid, not missing
 * history, and the chart has always left it bare.
 */
export function beforeData(
    series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'stepSeconds' | 'countedFrom'>
): ShadedSpan | null {
    const firstWholeStep = Math.ceil(series.from / series.stepSeconds) * series.stepSeconds;
    if (series.countedFrom <= firstWholeStep) return null;
    const endPercent = xPercent(series.countedFrom, series.from, series.to);
    return { startPercent: 0, endPercent, widthPercent: endPercent };
}

/** The legend line for {@link beforeData}'s shade, naming where the data starts (in UTC when there is no offset). */
export function describeBeforeData(countedFrom: number, offsetOf: OffsetOf = null): string {
    return `Shaded at the left: no data before ${formatInstant(countedFrom, offsetOf)}. Older raid reports are no longer stored.`;
}

/**
 * How old a step's end must be before it is counted, and so where the dashed line starts:
 * the query's `COUNTED_AGE_SECONDS`, copied because importing a value from `@/lib/db/queries`
 * would put better-sqlite3 on this module's import path. A test holds the two equal.
 */
export const NOT_YET_COUNTED_AGE_SECONDS = 2 * HOUR;

/**
 * How young a step's end must be to be left out: the query's `PROVISIONAL_MIN_AGE_SECONDS`,
 * copied for the same reason as {@link NOT_YET_COUNTED_AGE_SECONDS}, and held equal by a test.
 */
export const TOO_RECENT_AGE_SECONDS = 15 * MINUTE;

/**
 * The too-recent shade's legend: how wide it can be at this step. The line ends at the last
 * whole step 15 minutes old, so the shade is 15 minutes plus up to one step wide — 15 to 25
 * minutes at 10-minute steps, 15 minutes to 1 hour 15 minutes at 1-hour steps.
 */
export function tooRecentLegend(stepSeconds: number): string {
    return `Shaded: the last ${ageSpan(TOO_RECENT_AGE_SECONDS, stepSeconds)}, too recent to estimate.`;
}

/**
 * The dashed line's legend: where it starts. It begins where counting ends, at the last
 * whole step 2 hours old — 2 hours plus up to one step back.
 */
export function provisionalLegend(stepSeconds: number): string {
    return `Dashed: an estimate, from ${ageSpan(NOT_YET_COUNTED_AGE_SECONDS, stepSeconds)} ago up to the shaded stretch.`;
}

/**
 * The sentence naming the busiest step under the chart, worded for the range: "Busiest 10
 * minutes" over the last 24 hours, "Busiest hour" over 7 days, "Busiest 3 hours" over 30. A
 * step that rounds to one raid says "1 raid". The window is on the reader's clock, or UTC
 * with no offset.
 */
export function peakCaption(busiest: RaidsInProgressPoint | null, range: ActivityRange, offsetOf: OffsetOf = null): string {
    if (busiest === null) return `No raids counted in the last ${range.span} yet.`;
    return `Busiest ${range.step}: ${peakRaids(busiest)}, ${formatStepWindow(busiest.start, busiest.end, offsetOf)}.`;
}

/**
 * The chart's accessible name: what it measures and, as in {@link peakCaption}, its busiest
 * step. Always UTC: the name is read before any script runs, and must not change under a
 * screen reader.
 */
export function peakAriaLabel(busiest: RaidsInProgressPoint | null, range: ActivityRange): string {
    const measure = `Raids in progress per ${range.step} over the last ${range.span}`;
    if (busiest === null) return `${measure}: none counted yet`;
    return `${measure}, peaking at ${peakRaids(busiest)}, ${formatStepWindow(busiest.start, busiest.end)}`;
}

/** `1,828 raids in progress`: the busiest step's average, rounded. */
function peakRaids(busiest: RaidsInProgressPoint): string {
    const count = formatRaidCount(busiest.total);
    return `${count} ${raidNoun(count)} in progress`;
}

/**
 * The counted step with the most raids in progress, the earliest on a tie, or null when no
 * step has any: a week of zeros has no busiest hour to name. Estimates are left out: the
 * caption states a count, and an estimate above it must not take the title.
 */
export function busiestStep(points: RaidsInProgressPoint[]): RaidsInProgressPoint | null {
    return points.reduce<RaidsInProgressPoint | null>(
        (best, point) => (!point.provisional && point.total > (best?.total ?? 0) ? point : best),
        null
    );
}

/** The highest total of any step, estimates included, so the axis never clips the dashed line. */
export function tallestStep(points: RaidsInProgressPoint[]): number {
    return Math.max(0, ...points.map((point) => point.total));
}

/**
 * `15 minutes`, `1 hour 15 minutes`, `2 hours`, `2 hours 10 minutes`. The ages it is given
 * (15 minutes, 2 hours) and the steps added to them are whole multiples of 5 minutes, so a
 * leftover minute count is never 1.
 */
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / HOUR);
    const minutes = Math.round((seconds % HOUR) / MINUTE);
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes > 0) parts.push(`${minutes} minutes`);
    return parts.join(' ');
}

/**
 * The ages a shaded or dashed stretch runs between at this step: from `shortest` to one step
 * more. Said once where both ends share a unit: `2 to 3 hours`, `15 to 25 minutes`; otherwise
 * each in full: `2 hours to 2 hours 10 minutes`.
 */
function ageSpan(shortest: number, stepSeconds: number): string {
    const longest = shortest + stepSeconds;
    const wholeHours = shortest % HOUR === 0 && longest % HOUR === 0;
    const bothMinutes = longest < HOUR;
    return wholeHours || bothMinutes
        ? `${shortest / (wholeHours ? HOUR : MINUTE)} to ${formatDuration(longest)}`
        : `${formatDuration(shortest)} to ${formatDuration(longest)}`;
}

/** `raid` for a count that reads "1", else `raids`: the count as {@link formatRaidCount} wrote it. */
export function raidNoun(count: string): string {
    return count === '1' ? 'raid' : 'raids';
}

/** A count of raids as the chart labels it: whole, with thousands separated (`1,828`). */
export function formatRaidCount(value: number): string {
    return Math.round(value).toLocaleString('en-GB');
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Whether a Provisional step carries raid `key`'s estimate (#199): it does unless the raid has
 * no curve of its own, or its curve gives no share that far back. The one place that rule is
 * written. On a counted step every raid asked for has a value, a count, so ask only of a
 * Provisional one.
 */
export function hasEstimate(point: RaidsInProgressPoint, key: string): boolean {
    return point.raids?.[key] !== undefined;
}

/** One raid's line on the bottom panel. */
export interface RaidLine {
    key: string;
    /** The counted steps, solid. */
    path: string;
    /**
     * The raid's estimated steps (#199), dashed, joined on to the last counted point as the
     * total's are. Null for a raid with no estimate: its line stops where counting does.
     */
    dashed: string | null;
}

/** The bottom panel (#198): its own y-axis, and a line for each raid picked. */
export interface RaidPanel {
    axis: ValueAxis;
    lines: RaidLine[];
}

/**
 * The bottom panel for the picked raids, in the picked order. **Its y-axis is the picked raids'
 * alone** — the tallest value any of them reaches over the counted and estimated steps — and
 * never the total's, so a quiet raid keeps its shape instead of lying flat under the total's
 * scale, and the two panels are never read against one scale. Each raid's solid line has a
 * point for each counted step (one with no value for the raid is a quiet one), and its dashed
 * line (#199) one for each Provisional step that carries the raid's estimate, so a raid
 * without an estimate has no dashed line. The x positions are the total's, from the same
 * {@link stepCentrePercent}, so a moment lines up in both panels.
 */
export function raidPanel(
    points: RaidsInProgressPoint[],
    keys: readonly string[],
    from: number,
    to: number
): RaidPanel {
    const valueIn = (key: string) => (point: RaidsInProgressPoint) => point.raids?.[key] ?? 0;
    // A raid's line: every counted step, and the Provisional ones that carry its estimate.
    const raids = keys.map((key) => ({
        key,
        valueOf: valueIn(key),
        points: points.filter((point) => !point.provisional || hasEstimate(point, key)),
    }));
    const axis = valueAxis(Math.max(0, ...raids.flatMap((raid) => raid.points.map(raid.valueOf))));
    return {
        axis,
        lines: raids.map((raid) => {
            const { solid, dashed } = linePaths(raid.points, from, to, axis.max, raid.valueOf);
            return { key: raid.key, path: solid, dashed };
        }),
    };
}

/**
 * The picked raids that have no estimate (#199), in the picked order: no Provisional step
 * carries a value for them, because their runs in the past week were too few to learn a curve
 * from. Empty when no step is estimated at all, since then no dashed line exists for a note to
 * explain the absence from.
 */
export function raidsWithoutEstimate(points: RaidsInProgressPoint[], keys: readonly string[]): string[] {
    const estimated = points.filter((point) => point.provisional);
    if (estimated.length === 0) return [];
    return keys.filter((key) => !estimated.some((point) => hasEstimate(point, key)));
}

/** `A`, `A and B`, `A, B and C`. */
function nameList(names: readonly string[]): string {
    const last = names[names.length - 1];
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${last}` : last;
}

/**
 * The note under the chart naming the raids with no estimate and why their lines stop early.
 * Given at least one name.
 */
export function noEstimateNote(names: readonly string[]): string {
    const lines = names.length > 1 ? 'their lines stop' : 'its line stops';
    return `${nameList(names)}: too few runs in the past week to estimate, so ${lines} where counting does.`;
}

/**
 * The bottom panel's accessible name: its step, the raids it draws, and the range. Given at
 * least one name: the panel is not drawn for none.
 */
export function raidPanelAriaLabel(names: readonly string[], range: ActivityRange): string {
    return `Raids in progress per ${range.step} for ${nameList(names)} over the last ${range.span}.`;
}
