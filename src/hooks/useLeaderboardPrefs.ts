'use client';

import { useEffect, useState } from 'react';

const VIEW_MODE_KEY = 'destiny-farm-finder-view-mode';
const TIME_RANGE_KEY = 'destiny-farm-finder-time-range';

/**
 * Persisted view mode toggle (aggregate vs individual).
 * Defaults to 'individual' (Per Raid).
 */
export function useViewMode(): ['aggregate' | 'individual', (mode: 'aggregate' | 'individual') => void] {
    const [mode, setMode] = useState<'aggregate' | 'individual'>(() => {
        if (typeof window === 'undefined') {
            return 'individual';
        }
        try {
            const stored = localStorage.getItem(VIEW_MODE_KEY);
            if (stored === 'aggregate' || stored === 'individual') {
                return stored;
            }
        } catch {
            // Ignore
        }
        return 'individual';
    });

    useEffect(() => {
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch {
            // Ignore
        }
    }, [mode]);

    return [mode, setMode];
}

/**
 * Persisted time range slider value.
 * Defaults to 48 hours.
 */
export function useTimeRange(): [number, (hours: number) => void] {
    const [hours, setHours] = useState(() => {
        if (typeof window === 'undefined') {
            return 48;
        }
        try {
            const stored = localStorage.getItem(TIME_RANGE_KEY);
            if (stored) {
                const parsed = parseFloat(stored);
                if (!isNaN(parsed)) {
                    return Math.min(48, Math.max(1, Math.round(parsed)));
                }
            }
        } catch {
            // Ignore
        }
        return 48;
    });

    useEffect(() => {
        try {
            localStorage.setItem(TIME_RANGE_KEY, hours.toString());
        } catch {
            // Ignore
        }
    }, [hours]);

    return [hours, setHours];
}
