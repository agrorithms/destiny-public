/**
 * Singular or plural, by count.
 *
 * Page-level copy rather than SQL, beside ./duration-copy.ts and ./share-copy.ts. The
 * Resets panel (#93) wrote this and the participants panel (#94) hand-rolled the same
 * ternary in the same commit; one helper means the next panel does not have to pick
 * between two conventions for one decision.
 *
 * Deliberately takes both forms rather than appending an `s`: this page pluralises
 * `Run`/`Runs` and `it is`/`these are` through the same call.
 */
export function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}
