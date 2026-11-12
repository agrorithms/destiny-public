/**
 * Reading a promise's outcome as data, for the Raid Stats tab (#200): {@link settle} waits for it,
 * {@link peek} looks once without waiting. The page peeks at its two reads (./page.tsx) and the
 * board settles what was still pending (./RaidStatsBoard.tsx). Nothing here knows about raids.
 */

/** What {@link peek} saw of a promise. */
export type Peeked<T> = { state: 'pending' } | Settled<T>;

/** A promise's outcome once it has settled. */
export type Settled<T> = { state: 'fulfilled'; value: T } | { state: 'rejected'; error: unknown };

/** A promise's outcome once it has settled, waiting as long as that takes. Never rejects. */
export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
    try {
        return { state: 'fulfilled', value: await promise };
    } catch (error) {
        return { state: 'rejected', error };
    }
}

/**
 * How `promise` stands after one turn of the event loop: settled if it settles on microtasks
 * alone, as a cache hit does, and pending if it waits on a timer, as a miss's pause does. Never
 * waits for it. The Raid Stats tab renders what has settled as plain markup, in the first HTML,
 * and puts only what is pending behind `Suspense`: React outlines every async component into a
 * later chunk, so even a resolved read awaited inside one can reach the reader as a fallback and
 * a hidden segment, which a reader with JavaScript off never sees swapped in.
 */
export async function peek<T>(promise: Promise<T>): Promise<Peeked<T>> {
    let seen: Peeked<T> = { state: 'pending' };
    void settle(promise).then((settled) => {
        seen = settled;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return seen;
}
