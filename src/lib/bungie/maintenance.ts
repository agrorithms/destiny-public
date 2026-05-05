import { getDb } from '../db';
import { BungieAPIError } from './client';

const MAINTENANCE_STATE_KEY = 'bungie_system_disabled_until';
const DEFAULT_MAINTENANCE_PAUSE_MS = 300000;

export interface BungieMaintenanceStatus {
    active: boolean;
    until: number | null;
    remainingMs: number;
}

function getMaintenancePauseMs(): number {
    const configured = Number.parseInt(process.env.BUNGIE_SYSTEM_DISABLED_PAUSE_MS || '', 10);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAINTENANCE_PAUSE_MS;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isBungieSystemDisabledError(error: unknown): boolean {
    return error instanceof BungieAPIError && error.errorStatus === 'SystemDisabled';
}

export function getBungieMaintenanceStatus(): BungieMaintenanceStatus {
    const db = getDb();
    const row = db.prepare(
        'SELECT value FROM crawler_state WHERE key = ?'
    ).get(MAINTENANCE_STATE_KEY) as { value: string } | undefined;

    const until = row?.value ? Number.parseInt(row.value, 10) : NaN;
    if (!Number.isFinite(until) || until <= 0) {
        return { active: false, until: null, remainingMs: 0 };
    }

    const remainingMs = Math.max(0, until - Date.now());
    return {
        active: remainingMs > 0,
        until,
        remainingMs,
    };
}

export function recordBungieMaintenancePause(source: string): BungieMaintenanceStatus {
    const db = getDb();
    const now = Date.now();
    const proposedUntil = now + getMaintenancePauseMs();
    const current = getBungieMaintenanceStatus();
    const until = Math.max(current.until || 0, proposedUntil);

    db.prepare(`
    INSERT INTO crawler_state (key, value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = unixepoch()
  `).run(MAINTENANCE_STATE_KEY, until.toString());

    const remainingSeconds = Math.ceil(Math.max(0, until - now) / 1000);
    console.warn(`[BUNGIE] API maintenance detected by ${source}. Pausing Bungie work for ${remainingSeconds}s.`);

    return {
        active: until > now,
        until,
        remainingMs: Math.max(0, until - now),
    };
}

export async function waitForBungieMaintenancePause(
    source: string,
    shouldStop?: () => boolean
): Promise<boolean> {
    let waited = false;
    let logged = false;

    while (!shouldStop?.()) {
        const status = getBungieMaintenanceStatus();
        if (!status.active) {
            return waited;
        }

        waited = true;
        if (!logged) {
            console.log(
                `[BUNGIE] ${source} waiting ${(status.remainingMs / 1000).toFixed(1)}s for maintenance pause.`
            );
            logged = true;
        }

        await sleep(Math.min(status.remainingMs, 1000));
    }

    return waited;
}
