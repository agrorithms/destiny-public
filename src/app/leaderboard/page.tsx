'use client';

import { use, useEffect, useState, useCallback, useRef } from 'react';
import RaidMultiSelect from '@/components/RaidMultiSelect';
import LeaderboardTable, { type LeaderboardMetric, type RowMovement } from '@/components/LeaderboardTable';
import TimeSlider, { formatTimeRange } from '@/components/TimeSlider';
import { useRaidFilter } from '@/hooks/useRaidFilter';
import { useReportPageLiveStatus } from '@/hooks/usePageLiveStatus';
import { useViewMode, useTimeRange, useLeaderboardSize, usePlayersFilter, type PlayersFilter } from '@/hooks/useLeaderboardPrefs';
import type { FastestClearEntry, IndividualLeaderboard, LeaderboardResponseEntry } from '@/lib/cache/leaderboard-cache';
import { parseLeaderboardBoard } from './leaderboard-board';
import { LeaderboardTabs } from './LeaderboardTabs';

interface RaidOption {
    key: string;
    name: string;
}

type LeaderboardEntry = LeaderboardResponseEntry & RowMovement;

/** A row as of the last refresh. `metric` is the board's number: a Full Clears count, or a Clear Time in seconds. */
type PrevRow = { rank: number; metric: number; changeStamp?: number };

interface AggregateResponse {
    mode: 'aggregate';
    hours: number;
    fullClearsOnly: boolean;
    raidKeys: string[];
    entries: LeaderboardEntry[];
    maintenance?: boolean;
    snapshotGeneratedAt?: number;
}

interface IndividualResponse {
    mode: 'individual';
    hours: number;
    fullClearsOnly: boolean;
    raidKeys: string[];
    maintenance?: boolean;
    snapshotGeneratedAt?: number;
    leaderboards: Record<string, IndividualLeaderboard<LeaderboardEntry>>;
}

/**
 * `board=fastest` is always the per-raid shape, whatever `mode` the page might send. Its rows
 * get the same movement fields as Full Clears' (#134), measured on Clear Time.
 * Only this body carries `board`; the Full Clears body predates it, so `'board' in` tells them apart.
 */
interface FastestResponse {
    board: 'fastest';
    mode: 'individual';
    hours: number;
    raidKeys: string[];
    /** Set, with no boards, when the database is in maintenance: there is no Fastest Clears snapshot. */
    maintenance?: boolean;
    leaderboards: Record<string, IndividualLeaderboard<FastestClearEntry & RowMovement>>;
}

type LeaderboardResponse = AggregateResponse | IndividualResponse | FastestResponse;

/** A per-raid body's boards as movement scopes: each raid's rows are ranked on their own. */
function perRaidScopes<E>(leaderboards: Record<string, IndividualLeaderboard<E>>): Array<[string, E[]]> {
    return Object.values(leaderboards).map((lb): [string, E[]] => [lb.raidKey, lb.entries]);
}

const AVAILABLE_RAIDS: RaidOption[] = [
    //pantheon insurrection prime and morgeth surpassing are not accurately showing fresh clears so will never return results
    { key: 'pantheon_insurrection_prime_revolutionary', name: "Pantheon: Insurrection Prime Revolutionary" },
    //{ key: 'pantheon_morgeth_surpassing', name: 'Pantheon: Morgeth Surpassing' },
    { key: 'pantheon_calus_resplendent', name: 'Pantheon: Calus Resplendent' },
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

const LEADERBOARD_SIZE_OPTIONS = [6, 12, 25, 50, 75, 100];

export default function LeaderboardPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    // The tab is in the URL (./leaderboard-board.ts); the filters below stay in browser
    // storage and are shared by both tabs.
    const board = parseLeaderboardBoard(use(searchParams));
    const isFastest = board === 'fastest';
    const [selectedRaids, setSelectedRaids] = useRaidFilter();
    const [hours, setHours] = useTimeRange();
    const [mode, setMode] = useViewMode();
    const [leaderboardSize, setLeaderboardSize] = useLeaderboardSize();
    const [playersFilter, setPlayersFilter] = usePlayersFilter();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<LeaderboardResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const requestIdRef = useRef(0);
    const activeControllerRef = useRef<AbortController | null>(null);
    // Rank movement is measured against the first response seen for the current
    // tab and filter combo ("since you opened this page"), not the previous refresh.
    const baselineRef = useRef<{ comboKey: string; ranks: Map<string, number> } | null>(null);
    const prevRowsRef = useRef<Map<string, PrevRow>>(new Map());
    // Players who entered the board mid-session; they wear NEW until their rank first changes.
    const newEntrantsRef = useRef<Set<string>>(new Set());

    // Each tab starts its own baseline, dropped on the switch itself (#134). Dropping it when
    // the other tab's response arrived was not enough: switch back before that response lands
    // and the `requestId` guard discards it, so the old baseline survived the visit. Putting the
    // board in `comboKey` alone would miss the same case, since the key matches again on return.
    useEffect(() => {
        baselineRef.current = null;
    }, [board]);

    /**
     * Sets `rankDelta`, `isNew` and `changeStamp` on every row in `scopes`, in place.
     * `metricOf` is the board's own number, so a row flashes when it changes even if the
     * rank holds: a new Full Clear, or on Fastest Clears a faster personal best.
     */
    const annotateMovement = useCallback(<E extends RowMovement & { membershipId: string; rank: number }>(
        scopes: Array<[string, E[]]>,
        metricOf: (entry: E) => number,
        comboKey: string,
        fetchSeq: number,
    ) => {
        if (baselineRef.current?.comboKey !== comboKey) {
            // Tab or filters changed (or first load): reset and capture a fresh baseline.
            const ranks = new Map<string, number>();
            const rows = new Map<string, PrevRow>();
            for (const [scope, entries] of scopes) {
                for (const entry of entries) {
                    const key = `${scope}:${entry.membershipId}`;
                    ranks.set(key, entry.rank);
                    rows.set(key, { rank: entry.rank, metric: metricOf(entry) });
                }
            }
            baselineRef.current = { comboKey, ranks };
            newEntrantsRef.current = new Set();
            prevRowsRef.current = rows;
            return;
        }

        const baseline = baselineRef.current.ranks;
        const newEntrants = newEntrantsRef.current;
        const prevRows = prevRowsRef.current;
        const nextRows = new Map<string, PrevRow>();

        for (const [scope, entries] of scopes) {
            entries.forEach((entry) => {
                const key = `${scope}:${entry.membershipId}`;
                const rank = entry.rank;
                const baselineRank = baseline.get(key);
                if (baselineRank === undefined) {
                    // Mid-session entrant: NEW badge until their rank first changes.
                    baseline.set(key, rank);
                    newEntrants.add(key);
                    entry.isNew = true;
                } else if (baselineRank !== rank) {
                    entry.rankDelta = baselineRank - rank;
                    newEntrants.delete(key);
                } else if (newEntrants.has(key)) {
                    entry.isNew = true;
                }
                const prev = prevRows.get(key);
                const metric = metricOf(entry);
                // prev === undefined here means a mid-session entrant — flash their arrival.
                const changed = prev === undefined || prev.rank !== rank || prev.metric !== metric;
                entry.changeStamp = changed ? fetchSeq : prev?.changeStamp;
                nextRows.set(key, { rank, metric, changeStamp: entry.changeStamp });
            });
        }

        prevRowsRef.current = nextRows;
    }, []);

    const fetchLeaderboard = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        activeControllerRef.current?.abort();
        const controller = new AbortController();
        activeControllerRef.current = controller;

        setLoading(true);
        setError(null);

        try {
            // Fastest Clears neither sends nor reads the stored View mode: the server
            // always answers it per raid, and a saved Total Clears preference must
            // survive a visit to this tab untouched.
            const params = new URLSearchParams(isFastest
                ? { board, hours: hours.toString(), limit: leaderboardSize.toString() }
                : { hours: hours.toString(), fullClearsOnly: 'true', mode, limit: leaderboardSize.toString() });

            if (selectedRaids.length > 0) {
                params.set('raids', selectedRaids.join(','));
            }
            if (playersFilter === 'lowman') {
                params.set('maxPlayers', '3');
            } else if (playersFilter) {
                params.set('exactPlayers', playersFilter);
            }

            const response = await fetch(`/api/leaderboard?${params}`, {
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const result: LeaderboardResponse = await response.json();
            if (requestId !== requestIdRef.current) {
                return;
            }
            // The baseline's key is the request itself, so it can't drift from what was fetched.
            const comboKey = params.toString();
            if ('board' in result) {
                annotateMovement(perRaidScopes(result.leaderboards), (entry) => entry.clearTimeSeconds, comboKey, requestId);
            } else {
                const scopes: Array<[string, LeaderboardEntry[]]> = result.mode === 'aggregate'
                    ? [['aggregate', result.entries]]
                    : perRaidScopes(result.leaderboards);
                annotateMovement(scopes, (entry) => entry.completions, comboKey, requestId);
            }
            setData(result);
            setLastUpdated(new Date());
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
    }, [board, isFastest, selectedRaids, hours, mode, leaderboardSize, playersFilter, annotateMovement]);

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

    // Surface data freshness in the nav stats strip
    useReportPageLiveStatus(lastUpdated, 60);

    // Build the raid filter description
    const raidFilterLabel = selectedRaids.length === 0 || selectedRaids.length === AVAILABLE_RAIDS.length
        ? 'All Raids'
        : selectedRaids.length === 1
            ? AVAILABLE_RAIDS.find((r) => r.key === selectedRaids[0])?.name || ''
            : `${selectedRaids.length} Raids`;

    // Data from the other tab can be on screen for a moment after a switch; it is never
    // drawn under this tab's heading or in this tab's table.
    const shown = data && ('board' in data) === isFastest ? data : null;

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold ui-text-primary mb-2">Raid Leaderboard</h1>
            <LeaderboardTabs board={board} />
            <p className="ui-text-secondary mb-6">
                {isFastest ? 'Fastest clears' : 'Top raiders by full clears'} in the last {formatTimeRange(hours)}
                {raidFilterLabel !== 'All Raids' && ` — ${raidFilterLabel}`}
            </p>

            {shown?.maintenance && (
                <div className="ui-card p-4 mb-6 text-sm text-red-700 dark:text-red-400">
                    Database maintenance is in progress.
                    {/* There is no Fastest Clears snapshot; that tab's body says the board is unavailable. */}
                    {!isFastest && (
                        <>
                            {' '}Showing the last known leaderboard snapshot
                            {'snapshotGeneratedAt' in shown && shown.snapshotGeneratedAt ? ` from ${new Date(shown.snapshotGeneratedAt).toLocaleString()}` : ''}.
                        </>
                    )}
                    {' '}Filters are temporarily frozen until maintenance completes.
                </div>
            )}

            {/* Controls + Time Range Card (combined) */}
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

                    {/* View Mode Toggle — Full Clears only: a fastest time across
                        different raids means nothing, so Fastest Clears is always per raid. */}
                    {!isFastest && <div>
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
                    </div>}

                    {/* Players Filter */}
                    <div>
                        <label className="block text-xs ui-text-muted mb-1">Players</label>
                        <select
                            value={playersFilter}
                            onChange={(e) => setPlayersFilter(e.target.value as PlayersFilter)}
                            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 ui-toggle-idle"
                        >
                            <option value="">All</option>
                            <option value="1">Solo</option>
                            <option value="2">Duo</option>
                            <option value="3">Trio</option>
                            <option value="lowman">Any Lowman</option>
                        </select>
                    </div>

                    {/* Leaderboard Size */}
                    <div>
                        <label className="block text-xs ui-text-muted mb-1">Rows</label>
                        <select
                            value={leaderboardSize}
                            onChange={(e) => setLeaderboardSize(parseInt(e.target.value, 10))}
                            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 ui-toggle-idle"
                        >
                            {LEADERBOARD_SIZE_OPTIONS.map((size) => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </select>
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

                <div className="border-t ui-divider pt-4">
                    <TimeSlider value={hours} onChange={setHours} />
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className="bg-red-100 border border-red-300 rounded-lg p-4 mb-6 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                    Error loading leaderboard: {error}
                </div>
            )}

            {/* Aggregate Leaderboard */}
            {shown && shown.mode === 'aggregate' && (
                <div className="ui-card p-3 sm:p-4">
                    <LeaderboardTable
                        entries={shown.entries}
                        showRaidColumn={false}
                    />
                </div>
            )}

            {/* Per-raid Leaderboards — Full Clears' Per Raid view, and every Fastest Clears response */}
            {shown && shown.mode === 'individual' && (
                <>
                    {(() => {
                        const leaderboards = Object.values(shown.leaderboards);
                        const metric: LeaderboardMetric = isFastest ? 'clearTime' : 'completions';
                        const count = leaderboards.length;

                        if (count === 0 && !loading) {
                            // A Fastest Clears maintenance body has no boards: no Fastest
                            // Clears snapshot exists, so the message replaces the board.
                            const [title, hint] = !isFastest
                                ? ['No leaderboards found', 'Try a different time range or refresh the leaderboard']
                                : shown.maintenance
                                    ? ['Fastest Clears are unavailable during maintenance']
                                    : ['No Completions match these filters'];
                            return (
                                <div className="ui-card p-3 sm:p-4">
                                    <div className="text-center py-12 ui-text-secondary">
                                        <p className="text-lg">{title}</p>
                                        {hint && <p className="text-sm mt-1">{hint}</p>}
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
                                        className="ui-card p-3 sm:p-4 min-w-0"
                                    >
                                        <LeaderboardTable
                                            entries={lb.entries}
                                            title={lb.raidName}
                                            showRaidColumn={false}
                                            metric={metric}
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
