'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import RaidMultiSelect from '@/components/RaidMultiSelect';
import LeaderboardTable from '@/components/LeaderboardTable';
// import StatsBar from '@/components/StatsBar';
import { useRaidFilter } from '@/hooks/useRaidFilter';
import { useViewMode, useTimeRange } from '@/hooks/useLeaderboardPrefs';

interface RaidOption {
    key: string;
    name: string;
}

interface LeaderboardEntry {
    membershipId: string;
    membershipType: number;
    displayName: string;
    completions: number;
}

interface AggregateResponse {
    mode: 'aggregate';
    hours: number;
    fullClearsOnly: boolean;
    raidKeys: string[];
    entries: LeaderboardEntry[];
}

interface IndividualResponse {
    mode: 'individual';
    hours: number;
    fullClearsOnly: boolean;
    raidKeys: string[];
    leaderboards: Record<string, {
        raidKey: string;
        raidName: string;
        entries: LeaderboardEntry[];
    }>;
}

type LeaderboardResponse = AggregateResponse | IndividualResponse;

const AVAILABLE_RAIDS: RaidOption[] = [
    { key: 'the_desert_perpetual', name: 'The Desert Perpetual' },
    { key: 'salvations_edge', name: "Salvation's Edge" },
    { key: 'crotas_end', name: "Crota's End" },
    { key: 'root_of_nightmares', name: 'Root of Nightmares' },
    { key: 'kings_fall', name: "King's Fall" },
    { key: 'vow_of_the_disciple', name: 'Vow of the Disciple' },
    { key: 'vault_of_glass', name: 'Vault of Glass' },
    { key: 'deep_stone_crypt', name: 'Deep Stone Crypt' },
    { key: 'garden_of_salvation', name: 'Garden of Salvation' },
    { key: 'last_wish', name: 'Last Wish' },
];

const HOUR_MARKS = Array.from({ length: 48 }, (_, i) => i + 1);

function formatHours(h: number): string {
    if (h === 1) return '1 hour';
    return `${h} hours`;
}

export default function LeaderboardPage() {
    const [selectedRaids, setSelectedRaids] = useRaidFilter();
    const [hours, setHours] = useTimeRange();
    const [pendingHours, setPendingHours] = useState(hours);
    const [mode, setMode] = useViewMode();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<LeaderboardResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const activeControllerRef = useRef<AbortController | null>(null);

    const fetchLeaderboard = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        activeControllerRef.current?.abort();
        const controller = new AbortController();
        activeControllerRef.current = controller;

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                hours: hours.toString(),
                fullClearsOnly: 'true',
                mode,
                limit: '100',
            });

            if (selectedRaids.length > 0) {
                params.set('raids', selectedRaids.join(','));
            }

            const response = await fetch(`/api/leaderboard?${params}`, {
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const result = await response.json();
            if (requestId !== requestIdRef.current) {
                return;
            }
            setData(result);
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                return;
            }
            if (requestId !== requestIdRef.current) {
                return;
            }
            setError((err as Error).message);
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, [selectedRaids, hours, mode]);

    useEffect(() => {
        setPendingHours(hours);
    }, [hours]);

    useEffect(() => {
        return () => activeControllerRef.current?.abort();
    }, []);

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard]);

    // Auto-refresh every 60 seconds
    useEffect(() => {
        const interval = setInterval(fetchLeaderboard, 60000);
        return () => clearInterval(interval);
    }, [fetchLeaderboard]);

    // Build the raid filter description
    const raidFilterLabel = selectedRaids.length === 0 || selectedRaids.length === AVAILABLE_RAIDS.length
        ? 'All Raids'
        : selectedRaids.length === 1
            ? AVAILABLE_RAIDS.find((r) => r.key === selectedRaids[0])?.name || ''
            : `${selectedRaids.length} Raids`;

    const commitPendingHours = useCallback(() => {
        if (pendingHours !== hours) {
            setHours(pendingHours);
        }
    }, [pendingHours, hours, setHours]);

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            {/* Stats Bar */}
            {/* <div className="mb-6">
                <StatsBar />
            </div> */}

            <h1 className="text-3xl font-bold ui-text-primary mb-2">Raid Leaderboard</h1>
            <p className="ui-text-secondary mb-6">
                Top raiders by full clears in the last {formatHours(hours)}
                {raidFilterLabel !== 'All Raids' && ` — ${raidFilterLabel}`}
            </p>

            {/* Controls + Time Slider Card (combined) */}
            <div className="ui-card p-4 mb-6">
                {/* Top row: Raid filter, View toggle, Refresh */}
                <div className="flex flex-wrap items-end gap-4 mb-4">
                    {/* Raid Multi-Select */}
                    <div>
                        <label className="block text-xs ui-text-muted mb-1">Raids</label>
                        <RaidMultiSelect
                            raids={AVAILABLE_RAIDS}
                            selected={selectedRaids}
                            onChange={setSelectedRaids}
                        />
                    </div>

                    {/* View Mode Toggle */}
                    <div>
                        <label className="block text-xs ui-text-muted mb-1">View</label>
                        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                            <button
                                onClick={() => setMode('individual')}
                                className={`px-3 py-2 text-sm transition-colors ${mode === 'individual'
                                    ? 'ui-toggle-active'
                                    : 'ui-toggle-idle'
                                    }`}
                            >
                                Per Raid
                            </button>
                            <button
                                onClick={() => setMode('aggregate')}
                                className={`px-3 py-2 text-sm transition-colors ${mode === 'aggregate'
                                    ? 'ui-toggle-active'
                                    : 'ui-toggle-idle'
                                    }`}
                            >
                                Total Clears
                            </button>
                        </div>
                    </div>

                    {/* Refresh Button */}
                    <div>
                        <button
                            onClick={fetchLeaderboard}
                            disabled={loading}
                            className="px-4 py-2 text-sm rounded-lg ui-btn-primary disabled:opacity-50"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {/* Divider */}
                <div className="border-t ui-divider pt-4">
                    {/* Time Slider */}
                    <div className="flex items-center justify-between mb-3">
                        <label className="text-sm ui-text-secondary">Time Range</label>
                        <span className="text-sm font-medium ui-text-primary">
                            Last {formatHours(pendingHours)}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={HOUR_MARKS.length - 1}
                        value={HOUR_MARKS.indexOf(pendingHours)}
                        onChange={(e) => setPendingHours(HOUR_MARKS[parseInt(e.target.value, 10)])}
                        onMouseUp={commitPendingHours}
                        onTouchEnd={commitPendingHours}
                        onBlur={commitPendingHours}
                        onKeyUp={(e) => {
                            if (
                                e.key === 'ArrowLeft' ||
                                e.key === 'ArrowRight' ||
                                e.key === 'ArrowUp' ||
                                e.key === 'ArrowDown' ||
                                e.key === 'Home' ||
                                e.key === 'End' ||
                                e.key === 'PageUp' ||
                                e.key === 'PageDown'
                            ) {
                                commitPendingHours();
                            }
                        }}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer ui-range-accent dark:bg-gray-700"
                    />
                    <div className="relative mt-2 h-4">
                        {[1, 6, 12, 24, 36, 48].map((h) => {
                            const pct = ((h - 1) / (HOUR_MARKS.length - 1)) * 100;
                            const offsetClass = h === 1 ? 'translate-x-0' : h === 48 ? '-translate-x-full' : '-translate-x-1/2';

                            return (
                                <span
                                    key={h}
                                    className={`absolute top-0 text-xs cursor-pointer ${offsetClass} ${h === pendingHours ? 'text-[var(--ui-accent)] font-medium' : 'ui-text-muted'}`}
                                    style={{ left: `${pct}%` }}
                                    onClick={() => {
                                        setPendingHours(h);
                                        setHours(h);
                                    }}
                                >
                                    {h}h
                                </span>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="bg-red-100 border border-red-300 rounded-lg p-4 mb-6 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                    Error loading leaderboard: {error}
                </div>
            )}

            {/* Aggregate Leaderboard */}
            {data && data.mode === 'aggregate' && (
                <div className="ui-card p-4">
                    <LeaderboardTable
                        entries={(data as AggregateResponse).entries}
                        loading={loading}
                        showRaidColumn={false}
                    />
                </div>
            )}

            {/* Individual Leaderboards */}
            {data && data.mode === 'individual' && (
                <>
                    {(() => {
                        const leaderboards = Object.values((data as IndividualResponse).leaderboards);
                        const count = leaderboards.length;

                        if (count === 0 && !loading) {
                            return (
                                <div className="ui-card p-4">
                                    <div className="text-center py-12 ui-text-secondary">
                                        <p className="text-lg">No raids selected</p>
                                        <p className="text-sm mt-1">Select one or more raids from the dropdown above</p>
                                    </div>
                                </div>
                            );
                        }

                        let gridClass: string;
                        if (count === 1) {
                            gridClass = 'grid grid-cols-1';
                        } else if (count === 2) {
                            gridClass = 'grid grid-cols-1 md:grid-cols-2';
                        } else {
                            gridClass = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
                        }

                        return (
                            <div className={`${gridClass} gap-4`}>
                                {leaderboards.map((lb) => (
                                    <div
                                        key={lb.raidKey}
                                        className="ui-card p-4 min-w-0"
                                    >
                                        <LeaderboardTable
                                            entries={lb.entries}
                                            loading={loading}
                                            title={lb.raidName}
                                            showRaidColumn={false}
                                        />
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </>
            )}
        </div>
    );
}
