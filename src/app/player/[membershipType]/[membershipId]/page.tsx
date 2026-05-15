'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
// import StatsBar from '@/components/StatsBar';
import ActiveSessionCard from '@/components/ActiveSessionCard';
import RaidMultiSelect from '@/components/RaidMultiSelect';
import TimeSlider, { formatTimeRange } from '@/components/TimeSlider';
import { PROFILE_COMPLETIONS_PAGE_SIZE_OPTIONS, useProfileCompletionsPageSize, useTimeRange } from '@/hooks/useLeaderboardPrefs';
import { useRaidFilter } from '@/hooks/useRaidFilter';

interface RaidOption {
    key: string;
    name: string;
}

interface ProfilePlayer {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
}

interface RaidSummaryRow {
    raidKey: string;
    raidName: string;
    completions: number;
    avgCompletionSeconds: number | null;
}

interface RecentCompletion {
    instanceId: string;
    raidKey: string;
    raidName: string;
    completedAt: string;
    period: number;
    timePlayedSeconds: number;
}

interface TeammateSummaryRow {
    raidKey: string;
    raidName: string;
    teammateMembershipId: string;
    teammateMembershipType: number;
    teammateDisplayName: string;
    completions: number;
    avgCompletionSeconds: number | null;
}

interface PartyMember {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    status: number;
}

interface ActiveSession {
    membershipId: string;
    membershipType: number;
    displayName: string;
    activityHash: number;
    raidKey: string;
    raidName: string;
    startedAt: string;
    playerCount: number;
    partyMembers: PartyMember[];
}

interface ProfileResponse {
    maintenance?: boolean;
    message?: string;
    player: ProfilePlayer;
    hours: number;
    summary: RaidSummaryRow[];
    recentCompletions: RecentCompletion[];
    teammates: TeammateSummaryRow[];
    activeSession: ActiveSession | null;
}

type SectionKey = 'summary' | 'completions' | 'teammates';
type SortDirection = 'asc' | 'desc';
type SummarySortKey = 'raid' | 'clears' | 'avgTime';
type CompletionSortKey = 'raid' | 'completed' | 'time';
type TeammateSortKey = 'teammate' | 'clearsTogether' | 'avgTime';

interface ActiveSessionResponse {
    maintenance?: boolean;
    message?: string;
    player: ProfilePlayer;
    activeSession: ActiveSession | null;
}

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
const RECENT_COMPLETIONS_LOADED_LIMIT = 500;

const SUMMARY_FIRST_DIRECTIONS: Record<SummarySortKey, SortDirection> = {
    raid: 'asc',
    clears: 'desc',
    avgTime: 'asc',
};
const COMPLETION_FIRST_DIRECTIONS: Record<CompletionSortKey, SortDirection> = {
    raid: 'asc',
    completed: 'asc',
    time: 'asc',
};
const TEAMMATE_FIRST_DIRECTIONS: Record<TeammateSortKey, SortDirection> = {
    teammate: 'asc',
    clearsTogether: 'desc',
    avgTime: 'asc',
};

export default function PlayerProfilePage() {
    const params = useParams<{ membershipType: string; membershipId: string }>();

    const membershipType = params?.membershipType;
    const membershipId = params?.membershipId;

    const [hours, setHours] = useTimeRange();
    const [selectedRaids, setSelectedRaids] = useRaidFilter();
    const [completionPageSize, setCompletionPageSize] = useProfileCompletionsPageSize();
    const [completionPage, setCompletionPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [headerPlayer, setHeaderPlayer] = useState<ProfilePlayer | null>(null);
    const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
    const [activeLoading, setActiveLoading] = useState(true);
    const [visibleSections, setVisibleSections] = useState<SectionKey[]>(['summary', 'completions', 'teammates']);
    const [summarySort, setSummarySort] = useState<{ key: SummarySortKey | null; direction: SortDirection }>({
        key: null,
        direction: 'asc',
    });
    const [completionSort, setCompletionSort] = useState<{ key: CompletionSortKey | null; direction: SortDirection }>({
        key: null,
        direction: 'asc',
    });
    const [teammateSort, setTeammateSort] = useState<{ key: TeammateSortKey | null; direction: SortDirection }>({
        key: null,
        direction: 'asc',
    });
    const [expandedTeammateRaids, setExpandedTeammateRaids] = useState<Set<string>>(new Set());
    const hasRefreshedOnIdentity = useRef<string | null>(null);

    const fetchActiveSession = useCallback(async (opts?: { verify?: boolean }) => {
        if (!membershipType || !membershipId) return;

        setActiveLoading(true);
        try {
            const response = await fetch(`/api/players/${membershipType}/${membershipId}?part=active&enrich=0`);
            if (!response.ok) {
                throw new Error(`Active session API error: ${response.status}`);
            }
            const data: ActiveSessionResponse = await response.json();
            setHeaderPlayer(data.player);
            setActiveSession(data.activeSession);
            setMaintenanceMessage(data.maintenance ? data.message || 'Database maintenance is in progress.' : null);

            if (opts?.verify !== false && !data.maintenance) {
                void fetch(`/api/players/${membershipType}/${membershipId}?part=active&verify=1&enrich=1`)
                    .then(async (verifyResponse) => {
                        if (!verifyResponse.ok) return;
                        const verifiedData: ActiveSessionResponse = await verifyResponse.json();
                        setHeaderPlayer(verifiedData.player);
                        setActiveSession(verifiedData.activeSession);
                    })
                    .catch((err) => {
                        console.error('Failed to verify active session:', err);
                    });
            }
        } catch (err) {
            console.error('Failed to load active session:', err);
            setActiveSession(null);
        } finally {
            setActiveLoading(false);
        }
    }, [membershipId, membershipType]);

    const fetchProfile = useCallback(async (opts?: { refresh?: boolean }) => {
        if (!membershipType || !membershipId) return;

        if (opts?.refresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        setError(null);

        try {
            const params = new URLSearchParams({
                hours: hours.toString(),
                refresh: opts?.refresh ? '1' : '0',
            });

            const response = await fetch(`/api/players/${membershipType}/${membershipId}?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            setProfile(data);
            setHeaderPlayer(data.player);
            setActiveSession(data.activeSession || null);
            setMaintenanceMessage(data.maintenance ? data.message || 'Database maintenance is in progress.' : null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [hours, membershipId, membershipType]);

    useEffect(() => {
        if (!membershipId || !membershipType) return;

        fetchActiveSession({ verify: true });
    }, [fetchActiveSession, membershipId, membershipType]);

    useEffect(() => {
        if (!membershipId || !membershipType) return;

        const identityKey = `${membershipType}:${membershipId}`;
        if (hasRefreshedOnIdentity.current !== identityKey) {
            hasRefreshedOnIdentity.current = identityKey;
            fetchProfile({ refresh: true });
            return;
        }

        fetchProfile({ refresh: false });
    }, [fetchProfile, membershipId, membershipType]);

    const totalCompletions = useMemo(() => {
        return (profile?.summary || []).reduce((sum, row) => sum + row.completions, 0);
    }, [profile]);
    const currentPlayer = profile?.player || headerPlayer;
    const availableRaidKeys = useMemo(() => new Set(AVAILABLE_RAIDS.map((raid) => raid.key)), []);
    const validSelectedRaids = useMemo(() => {
        return selectedRaids.filter((raidKey) => availableRaidKeys.has(raidKey));
    }, [availableRaidKeys, selectedRaids]);
    const raidFilterActive = validSelectedRaids.length > 0 && validSelectedRaids.length < AVAILABLE_RAIDS.length;
    const selectedRaidSet = useMemo(() => new Set(validSelectedRaids), [validSelectedRaids]);
    const selectedRaidNames = useMemo(() => {
        if (!raidFilterActive) return [];
        return AVAILABLE_RAIDS
            .filter((raid) => selectedRaidSet.has(raid.key))
            .map((raid) => raid.name);
    }, [raidFilterActive, selectedRaidSet]);
    const selectedRaidTitle = selectedRaidNames.join(', ');

    const filteredSummary = useMemo(() => {
        const rows = profile?.summary || [];
        if (!raidFilterActive) return rows;
        return rows.filter((row) => selectedRaidSet.has(row.raidKey));
    }, [profile?.summary, raidFilterActive, selectedRaidSet]);

    const filteredRecentCompletions = useMemo(() => {
        const rows = profile?.recentCompletions || [];
        if (!raidFilterActive) return rows;
        return rows.filter((row) => selectedRaidSet.has(row.raidKey));
    }, [profile?.recentCompletions, raidFilterActive, selectedRaidSet]);

    const filteredTeammates = useMemo(() => {
        const rows = profile?.teammates || [];
        if (!raidFilterActive) return rows;
        return rows.filter((row) => selectedRaidSet.has(row.raidKey));
    }, [profile?.teammates, raidFilterActive, selectedRaidSet]);
    const filteredCompletions = useMemo(() => {
        return filteredSummary.reduce((sum, row) => sum + row.completions, 0);
    }, [filteredSummary]);
    const loadedCompletionsLimitReached = (profile?.recentCompletions.length || 0) === RECENT_COMPLETIONS_LOADED_LIMIT;

    const sortedSummary = useMemo(() => {
        return sortRaidSummary(filteredSummary, summarySort);
    }, [filteredSummary, summarySort]);

    const sortedCompletions = useMemo(() => {
        return sortRecentCompletions(filteredRecentCompletions, completionSort);
    }, [filteredRecentCompletions, completionSort]);

    const completionTotalPages = Math.max(1, Math.ceil(sortedCompletions.length / completionPageSize));
    const effectiveCompletionPage = Math.min(completionPage, completionTotalPages);
    const paginatedCompletions = useMemo(() => {
        const start = (effectiveCompletionPage - 1) * completionPageSize;
        return sortedCompletions.slice(start, start + completionPageSize);
    }, [effectiveCompletionPage, completionPageSize, sortedCompletions]);
    const completionRangeStart = sortedCompletions.length === 0 ? 0 : (effectiveCompletionPage - 1) * completionPageSize + 1;
    const completionRangeEnd = Math.min(effectiveCompletionPage * completionPageSize, sortedCompletions.length);

    const teammateGroups = useMemo(() => {
        return groupTeammatesByRaid(filteredTeammates, teammateSort);
    }, [filteredTeammates, teammateSort]);

    useEffect(() => {
        setCompletionPage(1);
    }, [completionPageSize, completionSort.direction, completionSort.key, hours, validSelectedRaids]);

    useEffect(() => {
        setCompletionPage((currentPage) => Math.min(currentPage, completionTotalPages));
    }, [completionTotalPages]);

    const toggleSection = (section: SectionKey) => {
        setVisibleSections((current) => {
            if (current.includes(section)) {
                if (current.length === 1) {
                    return current;
                }
                return current.filter((s) => s !== section);
            }
            return [...current, section];
        });
    };

    const toggleTeammateRaid = (raidKey: string) => {
        setExpandedTeammateRaids((current) => {
            const next = new Set(current);
            if (next.has(raidKey)) {
                next.delete(raidKey);
            } else {
                next.add(raidKey);
            }
            return next;
        });
    };

    const onSummarySort = (key: SummarySortKey) => {
        setSummarySort((current) => getNextSortState(current, key, SUMMARY_FIRST_DIRECTIONS));
    };

    const onCompletionSort = (key: CompletionSortKey) => {
        setCompletionSort((current) => getNextSortState(current, key, COMPLETION_FIRST_DIRECTIONS));
    };

    const onTeammateSort = (key: TeammateSortKey) => {
        setTeammateSort((current) => getNextSortState(current, key, TEAMMATE_FIRST_DIRECTIONS));
    };

    if (!membershipType || !membershipId) {
        return (
            <div className="text-red-700 dark:text-red-400">Invalid player path.</div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            {/* <div className="mb-6">
                <StatsBar />
            </div> */}

            {error && (
                <div className="bg-red-100 border border-red-300 rounded-lg p-4 mb-6 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                    Error loading player profile: {error}
                </div>
            )}

            {maintenanceMessage && (
                <div className="ui-card p-4 mb-6 text-sm text-red-700 dark:text-red-400">
                    {maintenanceMessage}
                </div>
            )}

            {currentPlayer && (
                <div className="mb-6">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h1 className="text-3xl font-bold ui-text-primary">{currentPlayer.displayName}</h1>
                        <div className="flex items-center gap-3">
                            <a
                                href={`https://raid.report/${getMembershipPrefix(currentPlayer.membershipType)}/${currentPlayer.membershipId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open on raid.report"
                                title="Open on raid.report"
                                className="text-blue-400 hover:text-blue-300"
                            >
                                <Image
                                    src="https://raid.report/favicon.ico"
                                    alt="Raid Report logo"
                                    width={16}
                                    height={16}
                                    unoptimized
                                    className="w-4 h-4 rounded-sm"
                                />
                            </a>
                            <a
                                href={`https://raidhub.io/profile/${currentPlayer.membershipId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open on RaidHub"
                                title="Open on RaidHub"
                                className="text-blue-400 hover:text-blue-300"
                            >
                                <Image
                                    src="https://raidhub.io/favicon.ico"
                                    alt="RaidHub logo"
                                    width={16}
                                    height={16}
                                    unoptimized
                                    className="w-4 h-4 rounded-sm"
                                />
                            </a>
                        </div>
                    </div>
                    <p className="ui-text-secondary">
                        Raid completions in the last {formatTimeRange(hours)}
                    </p>
                </div>
            )}

            {(activeLoading || activeSession) && (
                <div className="mb-6">
                    <h2 className="text-xl font-bold ui-text-primary mb-3">Active Session</h2>
                    {activeLoading && (
                        <div className="max-w-lg h-44 ui-skeleton rounded animate-pulse" />
                    )}
                    {!activeLoading && activeSession && (
                        <div className="max-w-lg">
                            <ActiveSessionCard session={activeSession} />
                        </div>
                    )}
                </div>
            )}

            {profile && (
                <>
                    <div className="ui-card p-4 mb-6">
                        <div className="flex flex-wrap items-end gap-4 mb-4">
                            <div>
                                <label className="block text-xs ui-text-muted mb-1">Raids</label>
                                <RaidMultiSelect
                                    raids={AVAILABLE_RAIDS}
                                    selected={selectedRaids}
                                    onChange={setSelectedRaids}
                                />
                            </div>

                            <div>
                                <label className="block text-xs ui-text-muted mb-1">Total Clears</label>
                                <div className="text-2xl font-bold ui-text-primary">{totalCompletions}</div>
                            </div>

                            {raidFilterActive && (
                                <div title={selectedRaidTitle}>
                                    <label className="block text-xs ui-text-muted mb-1" title={selectedRaidTitle}>Filtered Clears</label>
                                    <div className="text-2xl font-bold ui-text-primary" title={selectedRaidTitle}>{filteredCompletions}</div>
                                </div>
                            )}

                            <div>
                                <button
                                    onClick={() => {
                                        fetchActiveSession({ verify: true });
                                        fetchProfile({ refresh: true });
                                    }}
                                    disabled={refreshing}
                                    className="px-4 py-2 text-sm rounded-lg ui-btn-primary disabled:opacity-50"
                                >
                                    {refreshing ? 'Refreshing...' : 'Refresh Player Data'}
                                </button>
                            </div>

                        </div>

                        <div className="border-t ui-divider pt-4">
                            <TimeSlider value={hours} onChange={setHours} />
                        </div>
                    </div>

                    <div className="ui-card p-4 mb-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => toggleSection('summary')}
                                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${visibleSections.includes('summary') ? 'ui-toggle-active' : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
                                >
                                    Raid Summary
                                </button>
                                <button
                                    onClick={() => toggleSection('completions')}
                                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${visibleSections.includes('completions') ? 'ui-toggle-active' : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
                                >
                                    Raid Completions
                                </button>
                                <button
                                    onClick={() => toggleSection('teammates')}
                                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${visibleSections.includes('teammates') ? 'ui-toggle-active' : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'}`}
                                >
                                    Teammates
                                </button>
                            </div>
                        </div>
                        <p className="text-xs ui-text-muted mt-2">Toggle 1-3 sections. At least one section stays visible.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                        {visibleSections.includes('summary') && (
                            <div className="ui-card p-4">
                                <h2 className="text-xl font-bold ui-text-primary mb-3">Raid Summary</h2>
                                {loading && !profile.summary.length && (
                                    <div className="h-28 ui-skeleton rounded animate-pulse" />
                                )}
                                {!loading && sortedSummary.length === 0 && (
                                    <p className="ui-text-secondary text-sm">No full clears found in this time range.</p>
                                )}
                                {sortedSummary.length > 0 && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b ui-divider ui-text-muted">
                                                    <th className="text-left py-2">
                                                        <SortHeaderButton
                                                            label="Raid"
                                                            align="left"
                                                            active={summarySort.key === 'raid'}
                                                            direction={summarySort.direction}
                                                            onClick={() => onSummarySort('raid')}
                                                        />
                                                    </th>
                                                    <th className="text-right py-2">
                                                        <SortHeaderButton
                                                            label="Clears"
                                                            align="right"
                                                            active={summarySort.key === 'clears'}
                                                            direction={summarySort.direction}
                                                            onClick={() => onSummarySort('clears')}
                                                        />
                                                    </th>
                                                    <th className="text-right py-2">
                                                        <SortHeaderButton
                                                            label="Avg Time"
                                                            align="right"
                                                            active={summarySort.key === 'avgTime'}
                                                            direction={summarySort.direction}
                                                            onClick={() => onSummarySort('avgTime')}
                                                        />
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedSummary.map((row) => (
                                                    <tr key={row.raidKey} className="border-b border-gray-100 dark:border-gray-800">
                                                        <td className="py-2 ui-text-primary">{row.raidName}</td>
                                                        <td className="py-2 text-right font-mono font-bold ui-text-primary">{row.completions}</td>
                                                        <td className="py-2 text-right ui-text-secondary">{formatDuration(row.avgCompletionSeconds)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {visibleSections.includes('completions') && (
                            <div className="ui-card p-4">
                                <h2 className="text-xl font-bold ui-text-primary mb-3">Raid Completions</h2>
                                {loading && !profile.recentCompletions.length && (
                                    <div className="h-28 ui-skeleton rounded animate-pulse" />
                                )}
                                {!loading && sortedCompletions.length === 0 && (
                                    <p className="ui-text-secondary text-sm">No recent completions found in this time range.</p>
                                )}
                                {sortedCompletions.length > 0 && (
                                    <div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="border-b ui-divider ui-text-muted">
                                                        <th className="text-left py-2">
                                                            <SortHeaderButton
                                                                label="Raid"
                                                                align="left"
                                                                active={completionSort.key === 'raid'}
                                                                direction={completionSort.direction}
                                                                onClick={() => onCompletionSort('raid')}
                                                            />
                                                        </th>
                                                        <th className="text-right py-2">
                                                            <SortHeaderButton
                                                                label="Completed"
                                                                align="right"
                                                                active={completionSort.key === 'completed'}
                                                                direction={completionSort.direction}
                                                                onClick={() => onCompletionSort('completed')}
                                                            />
                                                        </th>
                                                        <th className="text-right py-2">
                                                            <SortHeaderButton
                                                                label="Time"
                                                                align="right"
                                                                active={completionSort.key === 'time'}
                                                                direction={completionSort.direction}
                                                                onClick={() => onCompletionSort('time')}
                                                            />
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {paginatedCompletions.map((row) => (
                                                        <tr key={row.instanceId} className="border-b border-gray-100 dark:border-gray-800">
                                                            <td className="py-2 ui-text-primary">{row.raidName}</td>
                                                            <td className="py-2 text-right ui-text-secondary" title={formatCompletionDate(row.completedAt)}>
                                                                {formatRelativeTime(row.completedAt)}
                                                            </td>
                                                            <td className="py-2 text-right ui-text-secondary">{formatDuration(row.timePlayedSeconds)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <PaginationControls
                                            currentPage={effectiveCompletionPage}
                                            pageSize={completionPageSize}
                                            totalItems={sortedCompletions.length}
                                            totalPages={completionTotalPages}
                                            rangeStart={completionRangeStart}
                                            rangeEnd={completionRangeEnd}
                                            loadedLimitReached={loadedCompletionsLimitReached}
                                            onPageChange={setCompletionPage}
                                            onPageSizeChange={setCompletionPageSize}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {visibleSections.includes('teammates') && (
                            <div className="ui-card p-4">
                                <h2 className="text-xl font-bold ui-text-primary mb-3">Teammates</h2>
                                {loading && !profile.teammates.length && (
                                    <div className="h-28 ui-skeleton rounded animate-pulse" />
                                )}
                                {!loading && teammateGroups.length === 0 && (
                                    <p className="ui-text-secondary text-sm">No teammate completions found in this time range.</p>
                                )}
                                {teammateGroups.length > 0 && (
                                    <div className="space-y-5">
                                        {teammateGroups.map((raidGroup) => (
                                            <div key={raidGroup.raidKey}>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleTeammateRaid(raidGroup.raidKey)}
                                                    className="w-full flex items-center justify-between bg-gray-100 hover:bg-gray-200 rounded-md px-3 py-2 text-left dark:bg-gray-700/40 dark:hover:bg-gray-700/60"
                                                >
                                                    <span className="text-sm font-semibold ui-text-primary">{raidGroup.raidName}</span>
                                                    <span className="text-xs ui-text-muted">
                                                        {expandedTeammateRaids.has(raidGroup.raidKey) ? 'Hide' : 'Show'} ({raidGroup.rows.length})
                                                    </span>
                                                </button>
                                                {expandedTeammateRaids.has(raidGroup.raidKey) && (
                                                    <div className="overflow-x-auto mt-2">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="border-b ui-divider ui-text-muted">
                                                                    <th className="text-left py-2">
                                                                        <SortHeaderButton
                                                                            label="Teammate"
                                                                            align="left"
                                                                            active={teammateSort.key === 'teammate'}
                                                                            direction={teammateSort.direction}
                                                                            onClick={() => onTeammateSort('teammate')}
                                                                        />
                                                                    </th>
                                                                    <th className="text-right py-2">
                                                                        <SortHeaderButton
                                                                            label="Clears Together"
                                                                            align="right"
                                                                            active={teammateSort.key === 'clearsTogether'}
                                                                            direction={teammateSort.direction}
                                                                            onClick={() => onTeammateSort('clearsTogether')}
                                                                        />
                                                                    </th>
                                                                    <th className="text-right py-2">
                                                                        <SortHeaderButton
                                                                            label="Avg Time"
                                                                            align="right"
                                                                            active={teammateSort.key === 'avgTime'}
                                                                            direction={teammateSort.direction}
                                                                            onClick={() => onTeammateSort('avgTime')}
                                                                        />
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {raidGroup.rows.map((row) => (
                                                                    <tr key={`${row.raidKey}:${row.teammateMembershipId}`} className="border-b border-gray-100 dark:border-gray-800">
                                                                        <td className="py-2 ui-text-primary" title={row.teammateDisplayName}>
                                                                            <Link
                                                                                href={`/player/${row.teammateMembershipType}/${row.teammateMembershipId}`}
                                                                                className="ui-text-primary hover:text-blue-600 transition-colors dark:hover:text-blue-400"
                                                                            >
                                                                                {truncateDisplayName(row.teammateDisplayName, 25)}
                                                                            </Link>
                                                                        </td>
                                                                        <td className="py-2 text-right font-mono font-bold ui-text-primary">{row.completions}</td>
                                                                        <td className="py-2 text-right ui-text-secondary">{formatDuration(row.avgCompletionSeconds)}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}

            {loading && !profile && (
                <div className="space-y-3">
                    <div className="h-10 ui-skeleton rounded animate-pulse" />
                    <div className="h-40 ui-skeleton rounded animate-pulse" />
                    <div className="h-64 ui-skeleton rounded animate-pulse" />
                </div>
            )}
        </div>
    );
}

function getMembershipPrefix(membershipType: number): string {
    switch (membershipType) {
        case 1: return 'xb';
        case 2: return 'ps';
        case 3: return 'pc';
        case 5: return 'stadia';
        case 6: return 'epic';
        default: return 'pc';
    }
}

function formatDuration(totalSeconds: number | null | undefined): string {
    if (totalSeconds === null || totalSeconds === undefined) {
        return 'N/A';
    }
    const rounded = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatCompletionDate(dateIso: string): string {
    return new Date(dateIso).toLocaleString(undefined, {
        year: '2-digit',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatRelativeTime(dateIso: string): string {
    const now = Date.now();
    const target = new Date(dateIso).getTime();
    const diffSeconds = Math.max(0, Math.floor((now - target) / 1000));

    const days = Math.floor(diffSeconds / 86400);
    const hours = Math.floor((diffSeconds % 86400) / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h ago`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m ago`;
    }
    if (minutes > 0) {
        return `${minutes}m ago`;
    }
    return 'just now';
}

function sortRaidSummary(
    rows: RaidSummaryRow[],
    sort: { key: SummarySortKey | null; direction: SortDirection },
): RaidSummaryRow[] {
    return [...rows].sort((a, b) => {
        if (sort.key === null) return 0;
        if (sort.key === 'raid') {
            return compareValues(a.raidName, b.raidName, sort.direction);
        }

        if (sort.key === 'clears') {
            return compareValues(
                a.completions,
                b.completions,
                sort.direction,
                compareValues(
                    a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
                    b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
                    'asc',
                    compareValues(a.raidName, b.raidName, 'asc'),
                ),
            );
        }

        return compareValues(
            a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
            b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
            sort.direction,
            compareValues(a.completions, b.completions, 'desc', compareValues(a.raidName, b.raidName, 'asc')),
        );
    });
}

function sortRecentCompletions(
    rows: RecentCompletion[],
    sort: { key: CompletionSortKey | null; direction: SortDirection },
): RecentCompletion[] {
    return [...rows].sort((a, b) => {
        if (sort.key === null) return 0;
        if (sort.key === 'raid') {
            return compareValues(
                a.raidName,
                b.raidName,
                sort.direction,
                compareValues(new Date(a.completedAt).getTime(), new Date(b.completedAt).getTime(), 'desc'),
            );
        }

        if (sort.key === 'completed') {
            return compareValues(
                new Date(a.completedAt).getTime(),
                new Date(b.completedAt).getTime(),
                sort.direction,
                compareValues(a.timePlayedSeconds, b.timePlayedSeconds, 'asc', compareValues(a.raidName, b.raidName, 'asc')),
            );
        }

        return compareValues(
            a.timePlayedSeconds,
            b.timePlayedSeconds,
            sort.direction,
            compareValues(
                new Date(a.completedAt).getTime(),
                new Date(b.completedAt).getTime(),
                'desc',
                compareValues(a.raidName, b.raidName, 'asc'),
            ),
        );
    });
}

function groupTeammatesByRaid(
    rows: TeammateSummaryRow[],
    sort: { key: TeammateSortKey | null; direction: SortDirection },
): Array<{
    raidKey: string;
    raidName: string;
    rows: TeammateSummaryRow[];
}> {
    const grouped = new Map<string, { raidKey: string; raidName: string; rows: TeammateSummaryRow[] }>();

    for (const row of rows) {
        if (!grouped.has(row.raidKey)) {
            grouped.set(row.raidKey, {
                raidKey: row.raidKey,
                raidName: row.raidName,
                rows: [],
            });
        }
        grouped.get(row.raidKey)!.rows.push(row);
    }

    return Array.from(grouped.values())
        .map((group) => ({
            ...group,
            rows: [...group.rows].sort((a, b) => {
                if (sort.key === null) return 0;
                if (sort.key === 'teammate') {
                    return compareValues(
                        a.teammateDisplayName,
                        b.teammateDisplayName,
                        sort.direction,
                        compareValues(
                            a.completions,
                            b.completions,
                            'desc',
                            compareValues(a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER, b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER, 'asc'),
                        ),
                    );
                }

                if (sort.key === 'clearsTogether') {
                    return compareValues(
                        a.completions,
                        b.completions,
                        sort.direction,
                        compareValues(
                            a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
                            b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
                            'asc',
                            compareValues(a.teammateDisplayName, b.teammateDisplayName, 'asc'),
                        ),
                    );
                }

                return compareValues(
                    a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
                    b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER,
                    sort.direction,
                    compareValues(a.completions, b.completions, 'desc', compareValues(a.teammateDisplayName, b.teammateDisplayName, 'asc')),
                );
            }),
        }))
        .sort((a, b) => compareValues(a.raidName, b.raidName, 'asc'));
}

function compareValues(
    a: number | string,
    b: number | string,
    direction: SortDirection,
    tieBreaker = 0,
): number {
    if (a === b) return tieBreaker;

    if (typeof a === 'string' && typeof b === 'string') {
        const value = a.localeCompare(b);
        return direction === 'asc' ? value : -value;
    }

    const value = (a as number) - (b as number);
    return direction === 'asc' ? value : -value;
}

function getNextSortState<TSortKey extends string>(
    current: { key: TSortKey | null; direction: SortDirection },
    clickedKey: TSortKey,
    firstDirections: Record<TSortKey, SortDirection>,
): { key: TSortKey | null; direction: SortDirection } {
    if (current.key === clickedKey) {
        return {
            key: clickedKey,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
    }

    return {
        key: clickedKey,
        direction: firstDirections[clickedKey],
    };
}

function getSortIcon(direction: SortDirection): string {
    return direction === 'asc' ? '↑' : '↓';
}

function truncateDisplayName(name: string, maxLength: number): string {
    if (name.length <= maxLength) return name;
    return `${name.slice(0, maxLength - 1)}...`;
}

function getPaginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    const sortedPages = Array.from(pages)
        .filter((page) => page >= 1 && page <= totalPages)
        .sort((a, b) => a - b);

    const items: Array<number | 'ellipsis'> = [];
    for (const page of sortedPages) {
        const previous = items[items.length - 1];
        if (typeof previous === 'number' && page - previous > 1) {
            items.push('ellipsis');
        }
        items.push(page);
    }

    return items;
}

function PaginationControls({
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    rangeStart,
    rangeEnd,
    loadedLimitReached,
    onPageChange,
    onPageSizeChange,
}: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    rangeStart: number;
    rangeEnd: number;
    loadedLimitReached: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
}) {
    const paginationItems = getPaginationItems(currentPage, totalPages);

    return (
        <div className="flex flex-wrap items-center gap-2 border-t ui-divider mt-3 pt-3 text-xs ui-text-muted">
            <span>
                {rangeStart}-{rangeEnd} of {totalItems}{loadedLimitReached ? ' loaded' : ''}
            </span>
            <span aria-hidden="true">|</span>
            <div className="flex flex-wrap items-center gap-1">
                {PROFILE_COMPLETIONS_PAGE_SIZE_OPTIONS
                    .filter((size) => size !== pageSize)
                    .map((size) => (
                        <button
                            key={size}
                            type="button"
                            onClick={() => onPageSizeChange(size)}
                            className="px-2 py-1 rounded-md bg-gray-100 text-gray-800 hover:bg-gray-200 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                        >
                            {size}
                        </button>
                    ))}
            </div>
            <span aria-hidden="true">|</span>
            <div className="flex flex-wrap items-center gap-1">
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-2 py-1 rounded-md bg-gray-100 text-gray-800 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    aria-label="Previous page"
                >
                    &lt;
                </button>
                {paginationItems.map((item, index) => (
                    item === 'ellipsis' ? (
                        <span key={`ellipsis-${index}`} className="px-1">...</span>
                    ) : (
                        <button
                            key={item}
                            type="button"
                            onClick={() => onPageChange(item)}
                            className={`px-2 py-1 rounded-md transition-colors ${item === currentPage
                                ? 'ui-toggle-active'
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                                }`}
                            aria-current={item === currentPage ? 'page' : undefined}
                        >
                            {item}
                        </button>
                    )
                ))}
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2 py-1 rounded-md bg-gray-100 text-gray-800 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    aria-label="Next page"
                >
                    &gt;
                </button>
            </div>
        </div>
    );
}

function SortHeaderButton({
    label,
    align,
    active,
    direction,
    onClick,
}: {
    label: string;
    align: 'left' | 'right';
    active: boolean;
    direction: SortDirection;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex items-center gap-1 hover:ui-text-primary transition-colors ${align === 'right' ? 'justify-end w-full' : ''} ${active ? 'ui-text-primary' : ''}`}
        >
            <span>{label}</span>
            <span className="text-xs" aria-hidden="true">{active ? getSortIcon(direction) : '↕'}</span>
        </button>
    );
}
