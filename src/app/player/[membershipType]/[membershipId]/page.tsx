'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
// import StatsBar from '@/components/StatsBar';
import ActiveSessionCard from '@/components/ActiveSessionCard';

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
    player: ProfilePlayer;
    hours: number;
    summary: RaidSummaryRow[];
    recentCompletions: RecentCompletion[];
    teammates: TeammateSummaryRow[];
    activeSession: ActiveSession | null;
}

type SectionKey = 'summary' | 'completions' | 'teammates';
type SortBy = 'clears' | 'avgTime';

interface ActiveSessionResponse {
    player: ProfilePlayer;
    activeSession: ActiveSession | null;
}

const HOUR_MARKS = Array.from({ length: 48 }, (_, i) => i + 1);

function formatHours(hours: number): string {
    return hours === 1 ? '1 hour' : `${hours} hours`;
}

export default function PlayerProfilePage() {
    const params = useParams<{ membershipType: string; membershipId: string }>();

    const membershipType = params?.membershipType;
    const membershipId = params?.membershipId;

    const [hours, setHours] = useState(48);
    const [pendingHours, setPendingHours] = useState(48);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [headerPlayer, setHeaderPlayer] = useState<ProfilePlayer | null>(null);
    const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
    const [activeLoading, setActiveLoading] = useState(true);
    const [visibleSections, setVisibleSections] = useState<SectionKey[]>(['summary', 'completions', 'teammates']);
    const [sortBy, setSortBy] = useState<SortBy>('clears');
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

            if (opts?.verify !== false) {
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

    useEffect(() => {
        setPendingHours(hours);
    }, [hours]);

    const totalCompletions = useMemo(() => {
        return (profile?.summary || []).reduce((sum, row) => sum + row.completions, 0);
    }, [profile]);
    const currentPlayer = profile?.player || headerPlayer;

    const sortedSummary = useMemo(() => {
        return sortRaidSummary(profile?.summary || [], sortBy);
    }, [profile?.summary, sortBy]);

    const teammateGroups = useMemo(() => {
        return groupTeammatesByRaid(profile?.teammates || [], sortBy);
    }, [profile?.teammates, sortBy]);

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

    const commitPendingHours = useCallback(() => {
        if (pendingHours !== hours) {
            setHours(pendingHours);
        }
    }, [pendingHours, hours]);

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
                        Raid completions in the last {formatHours(hours)}
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
                                <label className="block text-xs ui-text-muted mb-1">Total Clears</label>
                                <div className="text-2xl font-bold ui-text-primary">{totalCompletions}</div>
                            </div>

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
                            <div className="flex items-center gap-2">
                                <label className="text-sm ui-text-secondary">Sort</label>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-md px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                >
                                    <option value="clears">Total Clears</option>
                                    <option value="avgTime">Avg Time</option>
                                </select>
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
                                {!loading && profile.summary.length === 0 && (
                                    <p className="ui-text-secondary text-sm">No full clears found in this time range.</p>
                                )}
                                {sortedSummary.length > 0 && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b ui-divider ui-text-muted">
                                                    <th className="text-left py-2">Raid</th>
                                                    <th className="text-right py-2">Clears</th>
                                                    <th className="text-right py-2">Avg Time</th>
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
                                {!loading && profile.recentCompletions.length === 0 && (
                                    <p className="ui-text-secondary text-sm">No recent completions found in this time range.</p>
                                )}
                                {profile.recentCompletions.length > 0 && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b ui-divider ui-text-muted">
                                                    <th className="text-left py-2">Raid</th>
                                                    <th className="text-right py-2">Completed</th>
                                                    <th className="text-right py-2">Time</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {profile.recentCompletions.map((row) => (
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
                                )}
                            </div>
                        )}

                        {visibleSections.includes('teammates') && (
                            <div className="ui-card p-4">
                                <h2 className="text-xl font-bold ui-text-primary mb-3">Teammates</h2>
                                {loading && !profile.teammates.length && (
                                    <div className="h-28 ui-skeleton rounded animate-pulse" />
                                )}
                                {!loading && profile.teammates.length === 0 && (
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
                                                                    <th className="text-left py-2">Teammate</th>
                                                                    <th className="text-right py-2">Clears Together</th>
                                                                    <th className="text-right py-2">Avg Time</th>
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

function sortRaidSummary(rows: RaidSummaryRow[], sortBy: SortBy): RaidSummaryRow[] {
    return [...rows].sort((a, b) => {
        if (sortBy === 'avgTime') {
            const aAvg = a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
            const bAvg = b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
            if (aAvg !== bAvg) return aAvg - bAvg;
            if (a.completions !== b.completions) return b.completions - a.completions;
            return a.raidName.localeCompare(b.raidName);
        }

        if (a.completions !== b.completions) return b.completions - a.completions;
        const aAvg = a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
        const bAvg = b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
        if (aAvg !== bAvg) return aAvg - bAvg;
        return a.raidName.localeCompare(b.raidName);
    });
}

function groupTeammatesByRaid(rows: TeammateSummaryRow[], sortBy: SortBy): Array<{
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

    const groups = Array.from(grouped.values()).map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) => {
            if (sortBy === 'avgTime') {
                const aAvg = a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
                const bAvg = b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
                if (aAvg !== bAvg) return aAvg - bAvg;
                if (a.completions !== b.completions) return b.completions - a.completions;
                return a.teammateDisplayName.localeCompare(b.teammateDisplayName);
            }

            if (a.completions !== b.completions) return b.completions - a.completions;
            const aAvg = a.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
            const bAvg = b.avgCompletionSeconds ?? Number.MAX_SAFE_INTEGER;
            if (aAvg !== bAvg) return aAvg - bAvg;
            return a.teammateDisplayName.localeCompare(b.teammateDisplayName);
        }),
    }));

    return groups.sort((a, b) => {
        const clearsA = a.rows.reduce((sum, row) => sum + row.completions, 0);
        const clearsB = b.rows.reduce((sum, row) => sum + row.completions, 0);

        const avgA = calculateWeightedAverage(a.rows);
        const avgB = calculateWeightedAverage(b.rows);

        if (sortBy === 'avgTime') {
            const aSort = avgA ?? Number.MAX_SAFE_INTEGER;
            const bSort = avgB ?? Number.MAX_SAFE_INTEGER;
            if (aSort !== bSort) return aSort - bSort;
            if (clearsA !== clearsB) return clearsB - clearsA;
            return a.raidName.localeCompare(b.raidName);
        }

        if (clearsA !== clearsB) return clearsB - clearsA;
        const aSort = avgA ?? Number.MAX_SAFE_INTEGER;
        const bSort = avgB ?? Number.MAX_SAFE_INTEGER;
        if (aSort !== bSort) return aSort - bSort;
        return a.raidName.localeCompare(b.raidName);
    });
}

function calculateWeightedAverage(rows: TeammateSummaryRow[]): number | null {
    let weightedSum = 0;
    let weight = 0;

    for (const row of rows) {
        if (row.avgCompletionSeconds === null || row.avgCompletionSeconds === undefined) {
            continue;
        }
        weightedSum += row.avgCompletionSeconds * row.completions;
        weight += row.completions;
    }

    if (weight === 0) return null;
    return weightedSum / weight;
}

function truncateDisplayName(name: string, maxLength: number): string {
    if (name.length <= maxLength) return name;
    return `${name.slice(0, maxLength - 1)}...`;
}
