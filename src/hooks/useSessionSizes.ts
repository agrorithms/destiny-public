'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { ROSTER_SIZE } from '@/lib/active-session/roster';

const SESSION_SIZES_KEY = 'destiny-farm-finder-sessions-sizes';

/** Every chip, 1 to the Roster size: the default, and what the page is prerendered with. */
export const ALL_SESSION_SIZES: readonly number[] = Array.from({ length: ROSTER_SIZE }, (_, i) => i + 1);

// The snapshot is the selection as a string, "1,2,5": a primitive, so useSyncExternalStore
// sees an unchanged selection as unchanged. An array read fresh from storage on every call
// would be a new object each time, and React would re-render forever.
const DEFAULT_SNAPSHOT = ALL_SESSION_SIZES.join(',');

const listeners = new Set<() => void>();
// Set only while the latest write threw (some private modes, a full quota), so the chips still
// work for the visit even though they can't be remembered. Cleared by the next write that
// succeeds.
let unstoredSnapshot: string | null = null;

/**
 * The stored selection as a snapshot, or the default for anything other than a list of whole
 * numbers from 1 to the Roster size: a value the page can't read is treated as nothing stored,
 * all chips on. An empty list is a real selection, every chip off.
 */
function snapshotOf(stored: string | null): string {
    if (stored === null) return DEFAULT_SNAPSHOT;
    try {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every((size) => ALL_SESSION_SIZES.includes(size))) {
            return ALL_SESSION_SIZES.filter((size) => parsed.includes(size)).join(',');
        }
    } catch {
        // Not JSON
    }
    return DEFAULT_SNAPSHOT;
}

function readSnapshot(): string {
    // Checked first: while the latest write has failed, whatever localStorage holds is stale.
    if (unstoredSnapshot !== null) {
        return unstoredSnapshot;
    }
    try {
        return snapshotOf(localStorage.getItem(SESSION_SIZES_KEY));
    } catch {
        return DEFAULT_SNAPSHOT;
    }
}

// Module-level, so its identity is stable without a useCallback.
function writeSizes(next: readonly number[]): void {
    const sorted = ALL_SESSION_SIZES.filter((size) => next.includes(size));
    try {
        localStorage.setItem(SESSION_SIZES_KEY, JSON.stringify(sorted));
        // This write stuck, so localStorage is current again and the fallback must not win.
        unstoredSnapshot = null;
    } catch {
        unstoredSnapshot = sorted.join(',');
    }
    listeners.forEach((listener) => listener());
}

// Only this tab's own writes notify: another tab changing its sizes leaves this one alone.
function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Persisted fireteam-size chips for /active-sessions: the Roster sizes shown, sorted. Defaults
 * to all of them.
 *
 * A useSyncExternalStore like useSessionsView, for the same reason: the page is prerendered
 * with every chip on, so reading localStorage during hydration would leave a chip the visitor
 * switched off showing as on. The server snapshot hydrates first, then the stored value renders.
 */
export function useSessionSizes(): [readonly number[], (sizes: readonly number[]) => void] {
    const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => DEFAULT_SNAPSHOT);
    const sizes = useMemo(() => (snapshot === '' ? [] : snapshot.split(',').map(Number)), [snapshot]);
    return [sizes, writeSizes];
}
