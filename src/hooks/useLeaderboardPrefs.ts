'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TIME_RANGE_HOURS, isTimeRangePreset } from '@/components/TimeSlider';

const VIEW_MODE_KEY = 'destiny-farm-finder-view-mode';
const TIME_RANGE_KEY = 'destiny-farm-finder-time-range';
const LEADERBOARD_SIZE_KEY = 'destiny-farm-finder-leaderboard-size';
const LEADERBOARD_SIZE_OPTIONS = [6, 12, 25, 50, 75, 100] as const;

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
 * Persisted time range preset value.
 * Defaults to 24 hours.
 */
export function useTimeRange(): [number, (hours: number) => void] {
    const [hours, setHours] = useState(() => {
        if (typeof window === 'undefined') {
            return DEFAULT_TIME_RANGE_HOURS;
        }
        try {
            const stored = localStorage.getItem(TIME_RANGE_KEY);
            if (stored) {
                const parsed = parseInt(stored, 10);
                if (isTimeRangePreset(parsed)) {
                    return parsed;
                }
            }
        } catch {
            // Ignore
        }
        return DEFAULT_TIME_RANGE_HOURS;
    });

    useEffect(() => {
        try {
            localStorage.setItem(TIME_RANGE_KEY, hours.toString());
        } catch {
            // Ignore
        }
    }, [hours]);

    const setTimeRange = useCallback((nextHours: number) => {
        setHours(isTimeRangePreset(nextHours) ? nextHours : DEFAULT_TIME_RANGE_HOURS);
    }, []);

    return [hours, setTimeRange];
}

/**
 * Persisted leaderboard size.
 * Defaults to 50 players.
 */
export function useLeaderboardSize(): [number, (size: number) => void] {
    const [size, setSize] = useState(() => {
        if (typeof window === 'undefined') {
            return 50;
        }
        try {
            const stored = localStorage.getItem(LEADERBOARD_SIZE_KEY);
            if (stored) {
                const parsed = parseInt(stored, 10);
                if (LEADERBOARD_SIZE_OPTIONS.includes(parsed as (typeof LEADERBOARD_SIZE_OPTIONS)[number])) {
                    return parsed;
                }
            }
        } catch {
            // Ignore
        }
        return 50;
    });

    useEffect(() => {
        try {
            localStorage.setItem(LEADERBOARD_SIZE_KEY, size.toString());
        } catch {
            // Ignore
        }
    }, [size]);

    return [size, setSize];
}
