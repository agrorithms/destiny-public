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

/** The `YYYY-MM` key of an absolute month index — the inverse of {@link monthIndex}. */
export function monthKey(index: number): string {
    const year = Math.floor(index / 12);
    const monthOfYear = (index % 12) + 1;
    return `${year}-${String(monthOfYear).padStart(2, '0')}`;
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
