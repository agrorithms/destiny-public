/**
 * `YYYY-MM` — the Archive timeline's bucket key, and the arithmetic that walks it.
 *
 * One module because the format has three readers and they must agree: ./queries.ts
 * emits the keys (`strftime('%Y-%m', …)`), the timeline's geometry positions things by
 * them, and the tests build an expected axis out of them. Each had its own copy of "split
 * on the dash, twelve months to a year, January is zero" — the same four lines written
 * three times, which is three chances for one of them to be off by a month against the
 * other two and no way to notice from either side.
 *
 * Here rather than in a UI module because the key is the Archive's own shape: the query
 * decides what a bucket is called, and everything downstream reads that decision. Pure
 * and connectionless, like ./predicates.ts and ./range.ts, so a build-time script or a
 * component can import it without opening a database.
 *
 * **Months are indexed absolutely, not from the Archive's start** — `year * 12 + month` —
 * so subtracting two indices gives the distance between them and nothing has to know
 * where the history begins.
 */

/** The absolute month index of a `YYYY-MM` key: `2020-07` → `2020 * 12 + 6`. */
export function monthIndex(month: string): number {
    const [year, monthOfYear] = month.split('-').map(Number);
    return year * 12 + (monthOfYear - 1);
}

/**
 * The absolute month index a UTC instant falls in, ignoring where in the month it is.
 *
 * Here rather than at the caller because `year * 12 + month` is this module's convention
 * and the header above says why it has exactly one home: the timeline's geometry needs
 * the index of an instant to place the shaded band, and doing that arithmetic itself
 * would be a fourth copy of the same two operators — the off-by-a-month this module was
 * extracted to make impossible.
 */
export function monthIndexAt(instant: Date): number {
    return instant.getUTCFullYear() * 12 + instant.getUTCMonth();
}

/**
 * The `YYYY-MM` key of an absolute month index — the inverse of {@link monthIndex}.
 *
 * Exported for the zoomed timeline's axis labels (#113), which step through month
 * indices and need each one's key to name it; before that, {@link monthsBetween} was
 * its only caller and it was file-local.
 */
export function monthKey(index: number): string {
    const year = Math.floor(index / 12);
    const monthOfYear = (index % 12) + 1;
    return `${year}-${String(monthOfYear).padStart(2, '0')}`;
}

/**
 * The first instant of a `YYYY-MM` month, in unix seconds, UTC — where its bucket begins.
 *
 * Here for the reason {@link monthIndexAt} is: a drag across the monthly charts (#115)
 * needs each month's edges, and turning an index back into a year and a month at the
 * caller would be one more copy of this module's two operators.
 */
export function monthStart(month: string): number {
    return monthIndexStart(monthIndex(month));
}

/**
 * The first instant of an absolute month index, in unix seconds, UTC. The zoomed buckets
 * and the axis step through indices, and `monthIndexStart(index + 1)` is where a month ends.
 */
export function monthIndexStart(index: number): number {
    return Date.UTC(Math.floor(index / 12), index % 12, 1) / 1000;
}

/**
 * Every `YYYY-MM` from `first` to `last` inclusive, in order.
 *
 * Integer arithmetic on the two keys rather than `Date` stepping: a Date-based loop has
 * to pick a day-of-month to step from, and stepping from the 31st is how a month gets
 * skipped. Reads no clock — both ends are supplied by the caller, which for the timeline
 * means they come from the database.
 */
export function monthsBetween(first: string, last: string): string[] {
    const months: string[] = [];
    for (let index = monthIndex(first); index <= monthIndex(last); index += 1) {
        months.push(monthKey(index));
    }
    return months;
}
