import type { RaidsInProgressPoint, RaidsInProgressSeries } from '@/lib/db/queries';
import { DAY, HOUR, MINUTE, type ActivityRange } from './activity-range';

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
 * **Labels are UTC** in this ticket. #197 rewrites them into the reader's local time on
 * the client, so this module takes only types from the query module: anything on its
 * import path reaches the browser, and `@/lib/db/queries` opens better-sqlite3.
 *
 * Pure and free of any clock read: "now" arrives as the series' `to`.
 */

/** The SVG's viewBox, in user units. A resolution, not a size: the chart stretches to its column. */
export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 200;

/**
 * No day label starts past this point. A label runs rightwards from its midnight, and the
 * widest (`Wed 21`) is about 33px — 11% of the ~296px chart at 360px — so one starting
 * later would run off the panel. Its gridline is still drawn.
 */
export const LAST_LABELLED_TICK_PERCENT = 88;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/** Which midnights a day axis marks, and how many of its labels a phone keeps. */
export interface DayTickOptions {
    /** A tick on every UTC midnight whose day number since the epoch is a multiple of this. */
    everyDays: number;
    /** On a phone, every this-many ticks keeps its label, from the first. */
    phoneEvery: number;
}

/**
 * One tick per UTC midnight inside the window, labelled with the weekday and day of the
 * month it begins (`Sat 17`). A 7-day window has seven; a label past
 * {@link LAST_LABELLED_TICK_PERCENT} is dropped and its gridline kept, and on a phone only
 * every other label shows ({@link ActivityTick.phone}). The 30-day range thins them with
 * `options` ({@link axisTicks}).
 */
export function dayTicks(from: number, to: number, options: DayTickOptions = { everyDays: 1, phoneEvery: 2 }): ActivityTick[] {
    return ticksEvery(from, to, options.everyDays * DAY, dayLabel, (_, index) => index % options.phoneEvery === 0);
}

/** The 24-hour range's tick spacing, and the spacing of the labels a phone keeps. */
const HOUR_TICK_SECONDS = 3 * HOUR;
const PHONE_HOUR_TICK_SECONDS = 6 * HOUR;

/**
 * One tick every 3 UTC hours inside the window, labelled with its hour (`21:00`), except
 * midnight, which is labelled with the day it begins (`Sat 17`) so a day's chart still
 * shows where one day ends. On a phone only the ticks on a 6-hour boundary keep their
 * label: three hours is ~37px of chart at 360px, and a label ~30px.
 */
export function hourTicks(from: number, to: number): ActivityTick[] {
    return ticksEvery(
        from,
        to,
        HOUR_TICK_SECONDS,
        (at) => (at % DAY === 0 ? dayLabel(at) : clock(at)),
        (at) => at % PHONE_HOUR_TICK_SECONDS === 0
    );
}

/**
 * A tick on every multiple of `every` seconds since the epoch inside the window, labelled
 * by `label` unless it starts past {@link LAST_LABELLED_TICK_PERCENT}, and kept on a phone
 * where `phone` says so, given the instant and the tick's place from the first.
 */
function ticksEvery(
    from: number,
    to: number,
    every: number,
    label: (at: number) => string,
    phone: (at: number, index: number) => boolean
): ActivityTick[] {
    const ticks: ActivityTick[] = [];
    for (let at = Math.ceil(from / every) * every; at <= to; at += every) {
        const percent = xPercent(at, from, to);
        ticks.push({
            percent,
            label: percent <= LAST_LABELLED_TICK_PERCENT ? label(at) : null,
            phone: phone(at, ticks.length),
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
export function axisTicks(from: number, to: number, range: ActivityRange): ActivityTick[] {
    if (range.id === '24h') return hourTicks(from, to);
    if (range.id === '30d') return dayTicks(from, to, { everyDays: 2, phoneEvery: 3 });
    return dayTicks(from, to);
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
 * Written to two decimal places, which is far finer than a pixel at any width.
 */
export function linePath(points: RaidsInProgressPoint[], from: number, to: number, max: number): string {
    return points
        .map((point, index) => {
            const x = (xPercent((point.start + point.end) / 2, from, to) / 100) * CHART_WIDTH;
            return `${index === 0 ? 'M' : 'L'}${round(x)},${round(yAt(point.total, max))}`;
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
 * The span shaded as not yet counted: from where counted data ends (`countedUntil`, the
 * end of the last counted step) to "now" at the right-hand edge, so it meets the line's
 * last step with no gap. Two hours plus up to one step wide ({@link notYetCountedLegend}).
 * #196 fills it with a Provisional estimate.
 */
export function notYetCounted(
    series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'countedUntil'>
): ShadedSpan {
    const startPercent = xPercent(series.countedUntil, series.from, series.to);
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

/** The legend line for {@link beforeData}'s shade, naming where the data starts in UTC. */
export function describeBeforeData(countedFrom: number): string {
    return `Shaded at the left: no data before ${formatInstant(countedFrom)}. Older raid reports are no longer stored.`;
}

/**
 * How old a step's end must be before it is counted: the query's `COUNTED_AGE_SECONDS`,
 * copied because importing a value from `@/lib/db/queries` would put better-sqlite3 on
 * this module's import path. A test holds the two equal.
 */
export const NOT_YET_COUNTED_AGE_SECONDS = 2 * HOUR;

/**
 * The not-yet-counted shade's legend: how wide it can be at this step. Counting ends at
 * the last whole step 2 hours old, so the shade is 2 hours plus up to one step wide — 2 to
 * 3 hours at 1-hour steps, 2 hours to 2 hours 10 minutes at 10-minute steps.
 */
export function notYetCountedLegend(stepSeconds: number): string {
    const shortest = NOT_YET_COUNTED_AGE_SECONDS;
    const longest = shortest + stepSeconds;
    const span = longest % HOUR === 0
        ? `${shortest / HOUR} to ${formatDuration(longest)}`
        : `${formatDuration(shortest)} to ${formatDuration(longest)}`;
    return `Shaded: the last ${span}, not yet counted.`;
}

/**
 * The sentence naming the busiest step, for the caption and the chart's accessible name,
 * worded for the range: "Busiest 10 minutes" over the last 24 hours, "Busiest hour" over 7
 * days, "Busiest 3 hours" over 30. A step that rounds to one raid says "1 raid".
 */
export function describePeak(
    busiest: RaidsInProgressPoint | null,
    range: ActivityRange
): { caption: string; ariaLabel: string } {
    const measure = `Raids in progress per ${range.step} over the last ${range.span}`;
    if (busiest === null) {
        return { caption: `No raids counted in the last ${range.span} yet.`, ariaLabel: `${measure}: none counted yet` };
    }
    const count = formatRaidCount(busiest.total);
    const peak = `${count} ${count === '1' ? 'raid' : 'raids'} in progress, ${formatStepWindow(busiest.start, busiest.end)}`;
    return { caption: `Busiest ${range.step}: ${peak}.`, ariaLabel: `${measure}, peaking at ${peak}` };
}

/**
 * The step with the most raids in progress, the earliest on a tie, or null when no step
 * has any: a week of zeros has no busiest hour to name.
 */
export function busiestStep(points: RaidsInProgressPoint[]): RaidsInProgressPoint | null {
    return points.reduce<RaidsInProgressPoint | null>(
        (best, point) => (point.total > (best?.total ?? 0) ? point : best),
        null
    );
}

/** A step's window as a reader would say it: `Sat 17 Oct, 20:00–21:00 UTC`. */
export function formatStepWindow(start: number, end: number): string {
    return `${dateLabel(start)}, ${clock(start)}–${clock(end)} UTC`;
}

/** An instant as a reader would say it: `Sat 26 Sep, 06:00 UTC`. */
function formatInstant(at: number): string {
    return `${dateLabel(at)}, ${clock(at)} UTC`;
}

/**
 * `2 hours`, `5 hours`, `2 hours 10 minutes`. Only ever given the not-yet-counted shade's
 * widths, which are never under 2 hours, so it has no singular.
 */
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / HOUR);
    const minutes = Math.round((seconds % HOUR) / MINUTE);
    return minutes > 0 ? `${hours} hours ${minutes} minutes` : `${hours} hours`;
}

/** A count of raids as the chart labels it: whole, with thousands separated (`1,828`). */
export function formatRaidCount(value: number): string {
    return Math.round(value).toLocaleString('en-GB');
}

/** The UTC weekday and day of the month an instant falls on: `Sat 17`. */
function dayLabel(at: number): string {
    const date = new Date(at * 1000);
    return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}`;
}

/** The UTC weekday, day and month an instant falls on: `Sat 17 Oct`. */
function dateLabel(at: number): string {
    return `${dayLabel(at)} ${MONTHS[new Date(at * 1000).getUTCMonth()]}`;
}

/** `HH:MM` in UTC. */
function clock(at: number): string {
    return new Date(at * 1000).toISOString().slice(11, 16);
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
