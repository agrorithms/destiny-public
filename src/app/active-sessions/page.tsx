'use client';

import { useEffect, useState, useCallback } from 'react';
import ActiveSessionCard from '@/components/ActiveSessionCard';
import FireteamRow from '@/components/FireteamRow';
import RaidMultiSelect from '@/components/RaidMultiSelect';
import SessionsViewToggle from '@/components/SessionsViewToggle';
import { useRaidFilter } from '@/hooks/useRaidFilter';
import { useSessionsView } from '@/hooks/useSessionsView';
import { useReportPageLiveStatus } from '@/hooks/usePageLiveStatus';
import { followOpenSessions, isOpenSession, sessionIdentity, toggleOpenSession, type SessionIdentity } from '@/lib/active-session/roster';

interface PartyMember {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    status: number;
}

interface ActiveSession {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    activityHash: number;
    raidKey: string;
    raidName: string;
    startedAt: string;
    playerCount: number;
    partyMembers: PartyMember[];
}

interface ApiResponse {
    sessions: ActiveSession[];
    total: number;
    shown: number;
    maintenance?: boolean;
    message?: string;
}

interface RaidOption {
    key: string;
    name: string;
}

const AVAILABLE_RAIDS: RaidOption[] = [
    { key: 'pantheon_insurrection_prime_revolutionary', name: "Pantheon: Insurrection Prime Revolutionary" },
    { key: 'pantheon_morgeth_surpassing', name: 'Pantheon: Morgeth Surpassing' },
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

// Each raid's place in the section order: the order of the list above, which is also the raid
// filter's. A raid key the list doesn't know sorts after all of them.
const RAID_SECTION_ORDER = new Map(AVAILABLE_RAIDS.map((raid, index) => [raid.key, index]));

function raidSectionRank(raidKey: string): number {
    return RAID_SECTION_ORDER.get(raidKey) ?? AVAILABLE_RAIDS.length;
}

// One key for a row and a tile alike, so the two views can't drift apart: the fireteam's raid
// and member set. Never the tracked player or the index, which both change between polls.
// Unique on the page, because dedupe already merged any two sessions in one raid whose member
// sets are equal or nested. Open rows are tracked by the page, so they survive a new key. But
// a Roster change still gives the row a new key and remounts it: keyboard focus inside the row
// is dropped and its useId regenerates. A known limitation, tracked on #168.
function fireteamKey(identity: SessionIdentity): string {
    return `${identity.activityHash}:${identity.memberIds.join(',')}`;
}

export default function ActiveSessionsPage() {
    const [sessions, setSessions] = useState<ActiveSession[]>([]);
    const [selectedRaids, setSelectedRaids] = useRaidFilter();
    const [view, setView] = useSessionsView();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [shown, setShown] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
    // The list rows open right now, by session identity rather than by row, so a row stays
    // open across refreshes even as its tracked player changes or its Roster grows or shrinks.
    const [openSessions, setOpenSessions] = useState<SessionIdentity[]>([]);

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/active-sessions');
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const data: ApiResponse = await response.json();
            const nextSessions = data.sessions || [];
            setSessions(nextSessions);
            // Re-anchor each open row to this poll's Roster, so the next poll compares against
            // it. Fireteams that left the page are forgotten. Not on a maintenance response:
            // its empty list means no sessions could be read, not that they ended, so open rows
            // are kept for when they come back, as they are on a failed fetch.
            if (!data.maintenance) {
                setOpenSessions((open) => followOpenSessions(open, nextSessions.map(sessionIdentity)));
            }
            setTotal(data.total ?? 0);
            setShown(data.shown ?? 0);
            setMaintenanceMessage(data.maintenance ? data.message || 'Database maintenance is in progress.' : null);
            setError(null);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Failed to fetch active sessions:', err);
            setError('Could not load active sessions.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        const interval = setInterval(fetchSessions, 30000);
        return () => clearInterval(interval);
    }, [fetchSessions]);

    function toggleSession(identity: SessionIdentity) {
        setOpenSessions((open) => toggleOpenSession(open, identity));
    }

    // Surface data freshness in the nav stats strip
    useReportPageLiveStatus(lastUpdated, 30);

    // Filter sessions by selected raids (empty = all raids)
    const filteredSessions = selectedRaids.length === 0
        ? sessions
        : sessions.filter((s) => selectedRaids.includes(s.raidKey));

    // Group filtered sessions by raid key, never by display name: two raids sharing a name
    // would merge into one section. The API sends a null key for a raid-mode activity no raid
    // definition knows, so those group under '' rather than under a null React key.
    const sessionsByRaid = new Map<string, ActiveSession[]>();
    for (const session of filteredSessions) {
        const raidKey = session.raidKey ?? '';
        const group = sessionsByRaid.get(raidKey);
        if (group) {
            group.push(session);
        } else {
            sessionsByRaid.set(raidKey, [session]);
        }
    }

    // Fixed order, not busiest first, so sections don't swap places as their fireteam counts
    // change between refreshes. Unknown keys tie on rank, so they fall back to key order.
    const sortedRaidGroups = [...sessionsByRaid.entries()].sort(
        ([a], [b]) => raidSectionRank(a) - raidSectionRank(b) || a.localeCompare(b)
    );

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold ui-text-primary">Active Raid Sessions</h1>
            </div>

            {maintenanceMessage && (
                <div className="ui-card p-4 mb-6 text-sm text-red-700 dark:text-red-400">
                    {maintenanceMessage}
                </div>
            )}

            {error && !loading && (
                <div className="ui-card p-4 mb-6 text-sm text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {/* Controls Card */}
            <div className="ui-card p-4 mb-6">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-xs ui-text-muted mb-1">Raid</label>
                        <RaidMultiSelect
                            raids={AVAILABLE_RAIDS}
                            selected={selectedRaids}
                            onChange={setSelectedRaids}
                        />
                    </div>

                    <div>
                        <button
                            onClick={fetchSessions}
                            disabled={loading}
                            className="px-4 py-2 text-sm rounded-lg ui-btn-primary disabled:opacity-50"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>

                    {/* On the right, apart from the controls that act on the sessions. */}
                    <div className="ml-auto">
                        <span className="block text-xs ui-text-muted mb-1" aria-hidden="true">View</span>
                        <SessionsViewToggle view={view} onChange={setView} />
                    </div>
                </div>
            </div>

            {total > shown && !loading && (
                <p className="text-sm ui-text-muted mb-4">
                    Showing {shown} of {total} active fireteams
                </p>
            )}

            {/* Loading State */}
            {loading && sessions.length === 0 && (
                <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-32 ui-skeleton rounded-lg animate-pulse" />
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!loading && !error && filteredSessions.length === 0 && !maintenanceMessage && (
                <div className="ui-card p-4">
                    <div className="text-center py-12 ui-text-secondary">
                        <p className="text-lg">No active raid sessions found</p>
                        <p className="text-sm mt-1">
                            {selectedRaids.length > 0
                                ? 'Try selecting different raids or wait for new sessions'
                                : 'Sessions will appear here when players are detected in raids'}
                        </p>
                    </div>
                </div>
            )}

            {/* Session Groups. Each is a region landmark named by its h2, so a screen reader can
                list the raids and jump to one. Specs find a section's rows the same way, by raid
                name. The h2's only text stays the bare raid name. */}
            {sortedRaidGroups.map(([raidKey, raidSessions]) => (
                <section key={raidKey} aria-labelledby={`raid-section-${raidKey}`} className="mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <h2 id={`raid-section-${raidKey}`} className="text-xl font-bold ui-text-primary">
                            {raidSessions[0].raidName || 'Unknown Raid'}
                        </h2>
                        <span className="text-sm ui-text-muted">
                            {raidSessions.length} {raidSessions.length === 1 ? 'session' : 'sessions'}
                        </span>
                    </div>

                    {/* One row or one tile per fireteam, never per player (ADR 0001). Both keep
                        the API's order: multi-player fireteams first, then newest first. */}
                    {view === 'list' ? (
                        <ul className="ui-card divide-y ui-divider overflow-hidden">
                            {raidSessions.map((session) => {
                                const identity = sessionIdentity(session);
                                return (
                                    <FireteamRow
                                        key={fireteamKey(identity)}
                                        session={session}
                                        open={isOpenSession(openSessions, identity)}
                                        onToggle={() => toggleSession(identity)}
                                    />
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {raidSessions.map((session) => (
                                <ActiveSessionCard key={fireteamKey(sessionIdentity(session))} session={session} />
                            ))}
                        </div>
                    )}
                </section>
            ))}
        </div>
    );
}
