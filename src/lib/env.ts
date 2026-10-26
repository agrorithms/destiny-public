/**
 * A positive whole number from the environment, or `fallback` when it is unset, empty or not
 * one. `fallback` may be `undefined`, for a knob whose default belongs to the code it is handed
 * to rather than to the caller reading it.
 */
export function envCount<F extends number | undefined>(name: string, fallback: F): number | F {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** {@link envCount} for a number of seconds. */
export function envSeconds(name: string, fallback: number): number {
    return envCount(name, fallback);
}

/** {@link envCount} for a number of milliseconds. */
export function envMs(name: string, fallback: number): number {
    return envCount(name, fallback);
}
