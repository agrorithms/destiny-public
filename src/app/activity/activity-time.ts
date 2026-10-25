/**
 * Clock labels for the Raid Activity chart, in the reader's time zone or in UTC (#194, #197).
 * Every label the chart or its tooltips print goes through here, so a reader never sees two
 * zones side by side.
 *
 * **An offset is a function of the instant, not one number.** It is minutes east of UTC at
 * that moment (`-getTimezoneOffset()` in a browser), because a 30-day window can span a clock
 * change and a label either side of it must read the clock as it was. `null` means UTC: what
 * the server renders, and what a reader with JavaScript off sees. UTC labels carry a " UTC"
 * suffix where they name a time of day; local ones do not, since the zone is named once in the
 * intro line ({@link describeTimeZone}).
 *
 * Pure, and free of anything that touches a database or Node, so the client steps that
 * rewrite labels (./ActivityLocal.tsx) can import it. The pieces (`dayLabel`, `clock`,
 * `localSeconds`) are exported for the tick labels in ./activity-geometry.ts.
 */

/** Minutes east of UTC at an instant (unix seconds), or null for UTC. */
export type OffsetOf = ((at: number) => number) | null;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The instant shifted by the zone's offset, so that arithmetic on it (`% DAY`) reads the
 * zone's wall clock: a multiple of a day is a local midnight.
 */
export function localSeconds(at: number, offsetOf: OffsetOf): number {
    return at + (offsetOf === null ? 0 : offsetOf(at) * 60);
}

/** The instant as a Date whose UTC fields read the zone's wall clock. */
function wallClock(at: number, offsetOf: OffsetOf): Date {
    return new Date(localSeconds(at, offsetOf) * 1000);
}

/** The weekday and day of the month an instant falls on in the zone: `Sat 17`. */
export function dayLabel(at: number, offsetOf: OffsetOf): string {
    const date = wallClock(at, offsetOf);
    return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}`;
}

/** The weekday, day and month an instant falls on in the zone: `Sat 17 Oct`. */
function dateLabel(at: number, offsetOf: OffsetOf): string {
    return `${dayLabel(at, offsetOf)} ${MONTHS[wallClock(at, offsetOf).getUTCMonth()]}`;
}

/** `HH:MM` on the zone's clock. */
export function clock(at: number, offsetOf: OffsetOf): string {
    return wallClock(at, offsetOf).toISOString().slice(11, 16);
}

/** The suffix a label carries when it is in UTC. */
function suffix(offsetOf: OffsetOf): string {
    return offsetOf === null ? ' UTC' : '';
}

/**
 * A step's window as a reader would say it: `Sat 17 Oct, 20:00–21:00 UTC` in UTC and
 * `Sat 17 Oct, 20:00–21:00` locally. A window that crosses the zone's midnight names the
 * weekday it ends on (`Fri 16 Oct, 23:45–Sat 00:45`); one that ends exactly at midnight does
 * not, since it still belongs wholly to the day it began.
 */
export function formatStepWindow(start: number, end: number, offsetOf: OffsetOf = null): string {
    const endDay = dayLabel(end, offsetOf);
    const endClock = clock(end, offsetOf);
    const endsNextDay = endDay !== dayLabel(start, offsetOf) && endClock !== '00:00';
    const until = endsNextDay ? `${endDay.slice(0, 3)} ${endClock}` : endClock;
    return `${dateLabel(start, offsetOf)}, ${clock(start, offsetOf)}–${until}${suffix(offsetOf)}`;
}

/** An instant as a reader would say it: `Sat 26 Sep, 06:00 UTC`. */
export function formatInstant(at: number, offsetOf: OffsetOf = null): string {
    return `${dateLabel(at, offsetOf)}, ${clock(at, offsetOf)}${suffix(offsetOf)}`;
}

/**
 * The offset every label on the page is read with, given the zone the browser names: the
 * browser's own when it names one, and none — UTC — when it does not. The intro says
 * "Times are UTC." for a zone it cannot name ({@link describeTimeZone}), so the labels must
 * be UTC too, even though the browser's clock still has an offset.
 */
export function readerOffsetOf(zone: string | null, browserOffsetOf: (at: number) => number): OffsetOf {
    return zone === null ? null : browserOffsetOf;
}

/** The intro's sentence naming the zone every time on the page is in. */
export function describeTimeZone(zone: string | null): string {
    return zone === null ? 'Times are UTC.' : `Times are in your time zone (${zone}).`;
}
