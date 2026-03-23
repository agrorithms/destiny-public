'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'destiny-farm-finder-raid-filter';

/**
 * Shared hook for raid filter state.
 * Persists selections to localStorage so they survive page navigation.
 */
export function useRaidFilter(): [string[], (selected: string[]) => void] {
    const [selectedRaids, setSelectedRaids] = useState<string[]>(() => {
        if (typeof window === 'undefined') {
            return [];
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed: unknown = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
                    return parsed;
                }
            }
        } catch {
            // Ignore parse errors
        }
        return [];
    });

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedRaids));
        } catch {
            // Ignore storage errors
        }
    }, [selectedRaids]);

    return [selectedRaids, setSelectedRaids];
}
