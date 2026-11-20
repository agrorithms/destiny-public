import type { PlayerRef } from '@/lib/active-session/profile-viewed';

export interface HistoryCrawlLimits {
    isCoolingDown(player: PlayerRef): boolean;
    isOverGlobalLimit(): boolean;
    recordAccepted(player: PlayerRef): void;
}

/** Stub (#9004). */
export function createHistoryCrawlLimits(_env: Record<string, string | undefined> = process.env): HistoryCrawlLimits {
    throw new Error('not implemented');
}
