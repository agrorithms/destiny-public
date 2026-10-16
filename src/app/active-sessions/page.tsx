'use client';

import { useEffect, useRef, useState, useCallback, type MouseEvent } from 'react';
import ActiveSessionCard from '@/components/ActiveSessionCard';
import FireteamRow from '@/components/FireteamRow';
import RaidMultiSelect from '@/components/RaidMultiSelect';
import SessionSizeChips from '@/components/SessionSizeChips';
import SessionsViewToggle from '@/components/SessionsViewToggle';
import { useRaidFilter } from '@/hooks/useRaidFilter';
import { useSessionSizes } from '@/hooks/useSessionSizes';
import { useSessionsView } from '@/hooks/useSessionsView';
import { useReportPageLiveStatus } from '@/hooks/usePageLiveStatus';
import { followOpenSessions, isOpenSession, rosterSizeChip, sessionIdentity, toggleOpenSession, type SessionIdentity } from '@/lib/active-session/roster';

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

// Whether the raid filter shows a raid's sessions. No raid selected means every raid.
function isRaidShown(selectedRaids: string[], raidKey: string): boolean {
    return selectedRaids.length === 0 || selectedRaids.includes(raidKey);
}

// A session's raid section, by raid key. The API sends a null key for a raid-mode activity no
// raid definition knows, so those group under '' rather than under a null React key. Grouping,
// the raid filter and the collapse-state forgetting all read the key here, so they can't
// disagree about it.
function raidSectionKey(session: ActiveSession): string {
    return session.raidKey ?? '';
}

// Whether the size chips show a session: its chip, from the player count its row shows, is on.
// No chip on means no size, so nothing shows, unlike the raid filter's empty selection.
function isSizeShown(sizes: readonly number[], session: ActiveSession): boolean {
    return sizes.includes(rosterSizeChip(session.playerCount));
}

// Whether the page shows a session: the raid filter and the size chips both let it through.
// The sessions filter, changeSizes and the fetch's forgetting of collapsed sections read this,
// so a section is on the page exactly when one of its sessions passes it.
function isSessionShown(selectedRaids: string[], sizes: readonly number[], session: ActiveSession): boolean {
    return isRaidShown(selectedRaids, raidSectionKey(session)) && isSizeShown(sizes, session);
}

// The raid sections that hold at least one session the page shows.
function shownRaidKeys(sessions: ActiveSession[], selectedRaids: string[], sizes: readonly number[]): Set<string> {
    return new Set(sessions.filter((session) => isSessionShown(selectedRaids, sizes, session)).map(raidSectionKey));
}

// The empty state's hint, when no session is shown: the chips first, since every chip off hides
// everything, then the chips again if the raid filter alone would show something.
function emptyStateHint(sessions: ActiveSession[], selectedRaids: string[], sizes: readonly number[]): string {
    if (sizes.length === 0) return 'Select at least one fireteam size';
    if (sessions.some((s) => isRaidShown(selectedRaids, raidSectionKey(s)))) return 'Try selecting more fireteam sizes';
    if (selectedRaids.length > 0) return 'Try selecting different raids or wait for new sessions';
    return 'Sessions will appear here when players are detected in raids';
}

// The collapsed raids for which `stillShown` holds. A section that leaves the page is
// forgotten, so it comes back expanded, as anything newly on the page does.
function keepCollapsed(collapsed: ReadonlySet<string>, stillShown: (raidKey: string) => boolean): ReadonlySet<string> {
    return new Set([...collapsed].filter(stillShown));
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
    const [sizes, setSizes] = useSessionSizes();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [shown, setShown] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
    // The list rows open right now, by session identity rather than by row, so a row stays
    // open across refreshes even as its tracked player changes or its Roster grows or shrinks.
    const [openSessions, setOpenSessions] = useState<SessionIdentity[]>([]);
    // The raid sections collapsed right now, by raid key, in memory only: they survive refreshes
    // but not a reload. Every raid the API sends a null key for groups under '', so those
    // sections collapse and expand together; they have no key to tell them apart.
    const [collapsedRaids, setCollapsedRaids] = useState<ReadonlySet<string>>(() => new Set());
    // The filters as of the latest render, for the fetch: it is created once, so its own
    // closure would only ever see the first render's. Written in an effect, never in render.
    const filtersRef = useRef({ selectedRaids, sizes });
    useEffect(() => {
        filtersRef.current = { selectedRaids, sizes };
    }, [selectedRaids, sizes]);

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
            // Collapsed sections are kept for the same reason, and otherwise forgotten once
            // their raid has no session left on the page, so a raid that comes back starts
            // expanded. On the page, not just in the response: a fireteam that grows to a size
            // the chips hide can empty a section the API still sends.
            if (!data.maintenance) {
                setOpenSessions((open) => followOpenSessions(open, nextSessions.map(sessionIdentity)));
                const { selectedRaids: raidsNow, sizes: sizesNow } = filtersRef.current;
                const liveRaids = shownRaidKeys(nextSessions, raidsNow, sizesNow);
                setCollapsedRaids((collapsed) => keepCollapsed(collapsed, (raidKey) => liveRaids.has(raidKey)));
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

    // A section the filter hides is forgotten as collapsed, so it starts expanded when the
    // filter shows it again.
    function changeRaidFilter(nextRaids: string[]) {
        setSelectedRaids(nextRaids);
        setCollapsedRaids((collapsed) => keepCollapsed(collapsed, (raidKey) => isRaidShown(nextRaids, raidKey)));
    }

    // The same for the size chips: a section they empty is forgotten as collapsed, so it starts
    // expanded when they show it again. A section they leave on the page keeps its collapse.
    function changeSizes(nextSizes: readonly number[]) {
        setSizes(nextSizes);
        // Not while the maintenance banner shows: `sessions` is then the response's empty list,
        // which says nothing about which sections are on the page. The next real response
        // forgets what the chips emptied, through the fetch's own forgetting.
        if (maintenanceMessage) return;
        const stillShown = shownRaidKeys(sessions, selectedRaids, nextSizes);
        setCollapsedRaids((collapsed) => keepCollapsed(collapsed, (raidKey) => stillShown.has(raidKey)));
    }

    function toggleSection(raidKey: string) {
        setCollapsedRaids((collapsed) => {
            const next = new Set(collapsed);
            if (!next.delete(raidKey)) next.add(raidKey);
            return next;
        });
    }

    // A click anywhere on a section's header toggles it, like a list row's (#158). The button
    // inside the h2 toggles by itself, so a click on it is left to it.
    function handleHeaderClick(event: MouseEvent<HTMLDivElement>, raidKey: string) {
        const control = (event.target as Element).closest('button');
        if (control && event.currentTarget.contains(control)) return;
        toggleSection(raidKey);
    }

    // Surface data freshness in the nav stats strip
    useReportPageLiveStatus(lastUpdated, 30);

    const filteredSessions = sessions.filter((s) => isSessionShown(selectedRaids, sizes, s));

    // Group filtered sessions by raid key, never by display name: two raids sharing a name
    // would merge into one section.
    const sessionsByRaid = new Map<string, ActiveSession[]>();
    for (const session of filteredSessions) {
        const raidKey = raidSectionKey(session);
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

    // Collapse all acts on the sections on the page now. It offers Expand all only once every
    // one of them is collapsed; with no sections at all it offers nothing, so it is disabled.
    const visibleRaidKeys = sortedRaidGroups.map(([raidKey]) => raidKey);
    const allCollapsed = visibleRaidKeys.length > 0 && visibleRaidKeys.every((raidKey) => collapsedRaids.has(raidKey));

    function toggleAllSections() {
        setCollapsedRaids((collapsed) => {
            const next = new Set(collapsed);
            for (const raidKey of visibleRaidKeys) {
                if (allCollapsed) next.delete(raidKey);
                else next.add(raidKey);
            }
            return next;
        });
    }

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
                            onChange={changeRaidFilter}
                        />
                    </div>

                    {/* One flex item, so Collapse all wraps with Refresh and stays beside it. */}
                    <div className="flex gap-2">
                        <button
                            onClick={fetchSessions}
                            disabled={loading}
                            className="px-4 py-2 text-sm rounded-lg ui-btn-primary disabled:opacity-50"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                        <button
                            type="button"
                            onClick={toggleAllSections}
                            disabled={visibleRaidKeys.length === 0}
                            className="inline-flex items-center h-9 px-4 text-sm rounded-lg border border-[var(--ui-border-input)] ui-toggle-idle disabled:opacity-50"
                        >
                            {allCollapsed ? 'Expand all' : 'Collapse all'}
                        </button>
                    </div>

                    {/* The chips and View as one flex item, so they wrap together and share a line
                        down to a 360px phone. flex-auto, not flex-1: its basis is the pair's full
                        width, so the bar moves the pair to a new line whole rather than splitting
                        it. It grows to the bar's end, so View, on the right, apart from the
                        controls that act on the sessions, sits at the far right. Its own wrap only
                        lets View drop below the chips on a screen narrower than the pair. */}
                    <div className="flex flex-auto flex-wrap items-end gap-x-2 gap-y-4">
                        <div>
                            <span className="block text-xs ui-text-muted mb-1" aria-hidden="true">Size</span>
                            <SessionSizeChips sizes={sizes} onChange={changeSizes} />
                        </div>

                        <div className="ml-auto">
                            <span className="block text-xs ui-text-muted mb-1" aria-hidden="true">View</span>
                            <SessionsViewToggle view={view} onChange={setView} />
                        </div>
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
                        <p className="text-sm mt-1">{emptyStateHint(sessions, selectedRaids, sizes)}</p>
                    </div>
                </div>
            )}

            {/* Session Groups. Each is a region landmark named by its h2, so a screen reader can
                list the raids and jump to one. Specs find a section's rows the same way, by raid
                name. The h2's only text stays the bare raid name: the chevron is an aria-hidden
                icon, and the count sits outside the h2. */}
            {sortedRaidGroups.map(([raidKey, raidSessions]) => {
                const collapsed = collapsedRaids.has(raidKey);
                const headingId = `raid-section-${raidKey}`;
                const contentId = `${headingId}-content`;
                return (
                    <section key={raidKey} aria-labelledby={headingId} className="mb-8">
                        {/* The whole strip is the click target, so it takes the list rows' warm
                            hover. The negative margin cancels its padding, so the raid name and
                            count stay in line with the rows below; it stays inside the page's
                            gutter, so a phone doesn't scroll sideways. */}
                        <div
                            onClick={(event) => handleHeaderClick(event, raidKey)}
                            className="group flex items-center justify-between gap-3 cursor-pointer -mx-3 px-3 py-2 rounded-lg ui-list-item-hover"
                        >
                            <h2 id={headingId} className="min-w-0 text-xl font-bold ui-text-primary">
                                {/* The keyboard and screen-reader path: a real button that says
                                    whether the section is open and names the content it hides. */}
                                <button
                                    type="button"
                                    onClick={() => toggleSection(raidKey)}
                                    aria-expanded={!collapsed}
                                    aria-controls={contentId}
                                    className="flex items-center gap-2 text-left group-hover:text-[var(--ui-accent)] transition-colors"
                                >
                                    <svg
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        aria-hidden="true"
                                        className={`w-5 h-5 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                    {raidSessions[0].raidName || 'Unknown Raid'}
                                </button>
                            </h2>
                            <span className="shrink-0 text-sm ui-text-muted">
                                {raidSessions.length} {raidSessions.length === 1 ? 'session' : 'sessions'}
                            </span>
                        </div>

                        {/* One wrapper for both views. It stays in the page while collapsed, so the
                            header's aria-controls always resolves; only its rows or tiles go. Open
                            rows are the page's state, so they come back open. */}
                        <div id={contentId} hidden={collapsed} className="mt-1">
                            {/* One row or one tile per fireteam, never per player (ADR 0001). Both
                                keep the API's order: multi-player fireteams first, then newest first. */}
                            {!collapsed && (view === 'list' ? (
                                <ul className="ui-card divide-y ui-divider">
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
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
