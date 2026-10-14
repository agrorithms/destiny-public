'use client';

import { useSyncExternalStore } from 'react';

export type SessionsView = 'list' | 'tiles';

const SESSIONS_VIEW_KEY = 'destiny-farm-finder-sessions-view';
const DEFAULT_VIEW: SessionsView = 'list';

const listeners = new Set<() => void>();
// Used only when localStorage throws (some private modes), so the toggle still works
// for the visit even though it can't be remembered.
let unstoredView: SessionsView | null = null;

function readView(): SessionsView {
    try {
        const stored = localStorage.getItem(SESSIONS_VIEW_KEY);
        if (stored === 'list' || stored === 'tiles') {
            return stored;
        }
    } catch {
        // Ignore
    }
    return unstoredView ?? DEFAULT_VIEW;
}

// Module-level, so its identity is stable without a useCallback.
function writeView(next: SessionsView): void {
    unstoredView = next;
    try {
        localStorage.setItem(SESSIONS_VIEW_KEY, next);
    } catch {
        // Ignore
    }
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener('storage', listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', listener);
    };
}

/**
 * Persisted List | Tiles choice for /active-sessions. Defaults to List.
 *
 * A useSyncExternalStore rather than the useState initializer the other prefs hooks use:
 * the page is prerendered with the default, so reading localStorage during hydration
 * would leave the toggle's server-rendered aria-pressed and highlight on the wrong half
 * for a visitor who chose Tiles. The server snapshot hydrates first, then the stored
 * value renders.
 */
export function useSessionsView(): [SessionsView, (view: SessionsView) => void] {
    const view = useSyncExternalStore(subscribe, readView, () => DEFAULT_VIEW);
    return [view, writeView];
}
