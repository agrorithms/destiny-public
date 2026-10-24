import type { RaidsInProgressPoint, RaidsInProgressSeries } from '@/lib/db/queries';

/**
 * Where things sit on the Raid Activity chart (#194): the day ticks and their labels, the
 * y-axis, the line's path and the shaded "not yet counted" span. The arithmetic is here
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

const SECONDS_PER_DAY = 24 * 60 * 60;
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

/** The y-axis: its top value, and a labelled gridline at each round step from 0 up. */
export interface ValueAxis {
    max: number;
    ticks: Array<{ value: number; label: string; percent: number }>;
}

/** Where an instant sits across the window `[from, to]`, as a percentage of its width. */
export function xPercent(at: number, from: number, to: number): number {
    return ((at - from) / (to - from)) * 100;
}

/**
 * One tick per UTC midnight inside the window, labelled with the weekday and day of the
 * month it begins (`Sat 17`). A 7-day window has seven; a label past
 * {@link LAST_LABELLED_TICK_PERCENT} is dropped and its gridline kept, and on a phone only
 * every other label shows ({@link ActivityTick.phone}).
 */
export function dayTicks(from: number, to: number): ActivityTick[] {
    const ticks: ActivityTick[] = [];
    for (let midnight = Math.ceil(from / SECONDS_PER_DAY) * SECONDS_PER_DAY; midnight <= to; midnight += SECONDS_PER_DAY) {
        const percent = xPercent(midnight, from, to);
        const date = new Date(midnight * 1000);
        ticks.push({
            percent,
            label: percent <= LAST_LABELLED_TICK_PERCENT ? `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}` : null,
            phone: ticks.length % 2 === 0,
        });
    }
    return ticks;
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
        ticks.push({ value, label: formatRaidCount(value), percent: (value / max) * 100 });
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
            const y = CHART_HEIGHT * (1 - point.total / max);
            return `${index === 0 ? 'M' : 'L'}${round(x)},${round(y)}`;
        })
        .join('');
}

/**
 * The span shaded as not yet counted: from the moment two hours ago (`countedUntil`),
 * which no counted step ends after, to "now" at the right-hand edge. #196 fills it with a
 * Provisional estimate.
 */
export function notYetCounted(
    series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'countedUntil'>
): { startPercent: number; endPercent: number } {
    return { startPercent: xPercent(series.countedUntil, series.from, series.to), endPercent: 100 };
}

/** The step with the most raids in progress, the earliest on a tie, or null with none. */
export function busiestStep(points: RaidsInProgressPoint[]): RaidsInProgressPoint | null {
    return points.reduce<RaidsInProgressPoint | null>(
        (best, point) => (best === null || point.total > best.total ? point : best),
        null
    );
}

/** A step's window as a reader would say it: `Sat 17 Oct, 20:00–21:00 UTC`. */
export function formatStepWindow(start: number, end: number): string {
    const date = new Date(start * 1000);
    return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${clock(start)}–${clock(end)} UTC`;
}

/** A count of raids as the chart labels it: whole, with thousands separated (`1,828`). */
export function formatRaidCount(value: number): string {
    return Math.round(value).toLocaleString('en-GB');
}

/** `HH:MM` in UTC. */
function clock(at: number): string {
    return new Date(at * 1000).toISOString().slice(11, 16);
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
