/**
 * Defensive readers for PGCR duration inputs (Phase 1 denormalization writer).
 *
 * A PGCR has no single always-present wall-clock duration field, so the writer
 * uses a tiered computation (see `computeActivityDurationSeconds` in db/queries.ts):
 *   Tier 1 — Bungie's activity-level `activityDurationSeconds` (authoritative).
 *   Tier 2 — MAX over players of (startSeconds + timePlayedSeconds).
 *
 * These helpers extract the raw inputs from a Bungie PGCR. They are deliberately
 * tolerant of missing/odd PGCRs and never throw — absent values return null so the
 * tiered computation falls through gracefully.
 */

interface StatValueShape {
    values?: Record<string, { basic?: { value?: number } } | undefined>;
}

function readStat(entry: StatValueShape | undefined, key: string): number | null {
    const value = entry?.values?.[key]?.basic?.value;
    return typeof value === 'number' ? value : null;
}

/**
 * Per-player join offset from activity start. 0 is valid (joined at the start);
 * missing or negative is treated as absent (null) so Tier 2 degrades to
 * MAX(timePlayedSeconds) — the historical behavior — for old/odd PGCRs.
 */
export function readEntryStartSeconds(entry: StatValueShape | undefined): number | null {
    const value = readStat(entry, 'startSeconds');
    return value != null && value >= 0 ? value : null;
}

/**
 * Activity-level duration. Bungie reports the same value on every entry, but we
 * scan for the first entry carrying a positive value to stay robust if entries[0]
 * is malformed. Returns null when no entry has a usable value.
 */
export function readActivityDurationSeconds(entries: StatValueShape[] | undefined | null): number | null {
    if (!entries) {
        return null;
    }
    for (const entry of entries) {
        const value = readStat(entry, 'activityDurationSeconds');
        if (value != null && value > 0) {
            return value;
        }
    }
    return null;
}
