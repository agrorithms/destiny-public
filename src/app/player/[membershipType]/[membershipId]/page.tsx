'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import StatsBar from '@/components/StatsBar';
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
}

interface RecentCompletion {
    instanceId: string;
    raidKey: string;
    raidName: string;
    completedAt: string;
    period: number;
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
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const hasRefreshedOnIdentity = useRef<string | null>(null);

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
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [hours, membershipId, membershipType]);

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

    if (!membershipType || !membershipId) {
        return (
            <div className="text-red-400">Invalid player path.</div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="mb-6">
                <StatsBar />
            </div>

            {error && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6 text-red-400">
                    Error loading player profile: {error}
                </div>
            )}

            {profile && (
                <>
                    <h1 className="text-3xl font-bold text-white mb-2">{profile.player.displayName}</h1>
                    <p className="text-gray-400 mb-6">
                        Raid completions in the last {formatHours(hours)}
                    </p>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
                        <div className="flex flex-wrap items-end gap-4 mb-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Total Clears</label>
                                <div className="text-2xl font-bold text-white">{totalCompletions}</div>
                            </div>

                            <div>
                                <button
                                    onClick={() => fetchProfile({ refresh: true })}
                                    disabled={refreshing}
                                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                                >
                                    {refreshing ? 'Refreshing...' : 'Refresh Player Data'}
                                </button>
                            </div>

                            <div>
                                <a
                                    href={`https://raid.report/${getMembershipPrefix(profile.player.membershipType)}/${profile.player.membershipId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-400 hover:text-blue-300"
                                >
                                    Open on raid.report
                                </a>
                            </div>
                        </div>

                        <div className="border-t border-gray-700 pt-4">
                            <div className="flex items-center justify-between mb-3">
                                <label className="text-sm text-gray-400">Time Range</label>
                                <span className="text-sm font-medium text-gray-200">
                                    Last {formatHours(hours)}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={HOUR_MARKS.length - 1}
                                value={HOUR_MARKS.indexOf(hours)}
                                onChange={(e) => setHours(HOUR_MARKS[parseInt(e.target.value, 10)])}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                            <div className="flex justify-between mt-1">
                                {[1, 6, 12, 24, 36, 48].map((h) => (
                                    <span
                                        key={h}
                                        className={`text-xs cursor-pointer ${h === hours ? 'text-blue-400 font-medium' : 'text-gray-600'}`}
                                        onClick={() => setHours(h)}
                                    >
                                        {h}h
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {profile.activeSession && (
                        <div className="mb-6">
                            <h2 className="text-xl font-bold text-white mb-3">Active Session</h2>
                            <div className="max-w-lg">
                                <ActiveSessionCard session={profile.activeSession} />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                            <h2 className="text-xl font-bold text-white mb-3">Raid Summary</h2>
                            {loading && !profile.summary.length && (
                                <div className="h-28 bg-gray-700/40 rounded animate-pulse" />
                            )}
                            {!loading && profile.summary.length === 0 && (
                                <p className="text-gray-400 text-sm">No full clears found in this time range.</p>
                            )}
                            {profile.summary.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-700 text-gray-400">
                                                <th className="text-left py-2">Raid</th>
                                                <th className="text-right py-2">Clears</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {profile.summary.map((row) => (
                                                <tr key={row.raidKey} className="border-b border-gray-800">
                                                    <td className="py-2 text-gray-200">{row.raidName}</td>
                                                    <td className="py-2 text-right font-mono font-bold text-gray-200">{row.completions}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                            <h2 className="text-xl font-bold text-white mb-3">Recent Completions</h2>
                            {loading && !profile.recentCompletions.length && (
                                <div className="h-28 bg-gray-700/40 rounded animate-pulse" />
                            )}
                            {!loading && profile.recentCompletions.length === 0 && (
                                <p className="text-gray-400 text-sm">No recent completions found in this time range.</p>
                            )}
                            {profile.recentCompletions.length > 0 && (
                                <div className="overflow-x-auto max-h-96">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-700 text-gray-400">
                                                <th className="text-left py-2">Raid</th>
                                                <th className="text-right py-2">Completed</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {profile.recentCompletions.map((row) => (
                                                <tr key={row.instanceId} className="border-b border-gray-800">
                                                    <td className="py-2 text-gray-200">{row.raidName}</td>
                                                    <td className="py-2 text-right text-gray-300">
                                                        {new Date(row.completedAt).toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {loading && !profile && (
                <div className="space-y-3">
                    <div className="h-10 bg-gray-800 rounded animate-pulse" />
                    <div className="h-40 bg-gray-800 rounded animate-pulse" />
                    <div className="h-64 bg-gray-800 rounded animate-pulse" />
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
