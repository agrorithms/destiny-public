/** A positive whole number from the environment, or `fallback` when it is unset, empty or not one. */
export function envCount(name: string, fallback: number): number {
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
