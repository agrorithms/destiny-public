'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import StatsBar from '@/components/StatsBar';
import FireteamListingCard from '@/components/FireteamListingCard';
import { notifyBungieAuthChanged, useBungieAuth } from '@/hooks/useBungieAuth';

interface ActivityOption {
    hash: number;
    name: string;
}

interface FireteamListing {
    id: string;
    title: string;
    description: string | null;
    activityHash: number | null;
    activityName: string;
    hostDisplayName: string;
    createdAt: string | null;
    scheduledAt: string | null;
    availableSlots: number | null;
    totalSlots: number | null;
    memberCount: number | null;
    isMicRequired: boolean | null;
    language: string | null;
    platformLabel: string | null;
    rawState: string | number | null;
}

interface FireteamFinderResponse {
    viewerConfigured: boolean;
    authenticated?: boolean;
    activities: ActivityOption[];
    listings: FireteamListing[];
    error?: string;
    help?: string;
}

export default function FireteamFinderPage() {
    const searchParams = useSearchParams();
    const [activities, setActivities] = useState<ActivityOption[]>([]);
    const [selectedActivityHash, setSelectedActivityHash] = useState<string>('');
    const [listings, setListings] = useState<FireteamListing[]>([]);
    const [viewerConfigured, setViewerConfigured] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [help, setHelp] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const {
        authenticated,
        session,
        redirectUri,
        sessionExpired,
        refreshSession,
        acknowledgeSessionExpired,
    } = useBungieAuth();
    const authBaseOrigin = (() => {
        try {
            return new URL(redirectUri || '').origin;
        } catch {
            return '';
        }
    })();
    const loginHref = authBaseOrigin
        ? `${authBaseOrigin}/api/auth/bungie/login?returnTo=${encodeURIComponent('/fireteam-finder')}`
        : '/api/auth/bungie/login?returnTo=/fireteam-finder';
    const usingCanonicalOrigin = typeof window === 'undefined'
        ? true
        : !authBaseOrigin || window.location.origin === authBaseOrigin;

    const fetchListings = useCallback(async () => {
        setLoading(true);
        setError(null);
        setHelp(null);

        try {
            const params = new URLSearchParams({ pageSize: '50' });
            if (selectedActivityHash) {
                params.set('activityHash', selectedActivityHash);
            }

            const response = await fetch(`/api/fireteam-finder?${params.toString()}`);
            const data: FireteamFinderResponse = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `API error: ${response.status}`);
            }

            setActivities(data.activities || []);
            setListings(data.listings || []);
            setViewerConfigured(data.viewerConfigured);
            if (!data.authenticated) {
                setListings([]);
            }
            setHelp(data.help || null);
            setLastUpdated(new Date());
        } catch (err) {
            setError((err as Error).message);
            setListings([]);
        } finally {
            setLoading(false);
        }
    }, [selectedActivityHash]);

    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    useEffect(() => {
        const interval = setInterval(fetchListings, 60000);
        return () => clearInterval(interval);
    }, [fetchListings]);

    useEffect(() => {
        if (searchParams.get('auth') === 'success') {
            notifyBungieAuthChanged();
            void refreshSession().catch((sessionError) => {
                console.error('Failed to refresh Bungie auth session after callback:', sessionError);
            });
        }
    }, [refreshSession, searchParams]);

    useEffect(() => {
        if (authenticated) {
            setViewerConfigured(true);
        }
    }, [authenticated]);

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="mb-6">
                <StatsBar />
            </div>

            <div className="flex flex-col gap-2 mb-6 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white">Fireteam Finder</h1>
                    <p className="text-gray-400 mt-2 max-w-3xl">
                        Browse active Fireteam Finder postings from Bungie&apos;s API. This first pass focuses on listing public posts and filtering them by activity.
                    </p>
                    {redirectUri && (
                        <p className="text-xs text-gray-500 mt-3">
                            Bungie redirect URL for this environment: <span className="text-gray-300">{redirectUri}</span>
                        </p>
                    )}
                </div>
                {lastUpdated && (
                    <span className="text-sm text-gray-500">
                        Last updated: {lastUpdated.toLocaleTimeString()}
                    </span>
                )}
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
                <div className="flex flex-wrap items-end gap-4">
                    <div className="min-w-[280px]">
                        <label htmlFor="activityHash" className="block text-xs text-gray-500 mb-1">
                            Activity
                        </label>
                        <select
                            id="activityHash"
                            value={selectedActivityHash}
                            onChange={(event) => setSelectedActivityHash(event.target.value)}
                            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                        >
                            <option value="">All activities</option>
                            {activities.map((activity) => (
                                <option key={activity.hash} value={activity.hash}>
                                    {activity.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <button
                            onClick={fetchListings}
                            disabled={loading}
                            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>

                    {!authenticated && (
                        <div className="ml-auto">
                            <Link
                                href={loginHref}
                                onClick={() => acknowledgeSessionExpired()}
                                className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                            >
                                Sign in with Bungie
                            </Link>
                        </div>
                    )}
                </div>
            </div>

            {searchParams.get('auth') === 'success' && (
                <div className="bg-emerald-900/20 border border-emerald-800 rounded-lg p-4 mb-6 text-emerald-200">
                    Bungie sign-in succeeded. Fireteam Finder requests will now use your OAuth session for {session?.displayName || 'your account'}.
                </div>
            )}

            {searchParams.get('authError') && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6 text-red-300">
                    Bungie sign-in failed: {searchParams.get('authError')}
                </div>
            )}

            {!usingCanonicalOrigin && authBaseOrigin && (
                <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-4 mb-6 text-amber-200">
                    Bungie OAuth is registered against <span className="text-amber-100">{authBaseOrigin}</span>. Use that exact origin while testing, or the callback state cookie can be lost.
                </div>
            )}

            {sessionExpired && !authenticated && (
                <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-4 mb-6 text-amber-200">
                    Your Bungie session expired. Sign in again to continue browsing Fireteam Finder listings.
                </div>
            )}

            {!viewerConfigured && (
                <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-4 mb-6 text-amber-200">
                    <p className="font-medium">Fireteam Finder needs a Bungie sign-in before it can browse listings.</p>
                    {help && <p className="text-sm mt-1 text-amber-300">{help}</p>}
                </div>
            )}

            {error && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6 text-red-300">
                    Error loading Fireteam Finder: {error}
                    {help && <p className="text-sm mt-1 text-red-200">{help}</p>}
                </div>
            )}

            {loading && listings.length === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-64 bg-gray-800 rounded-lg animate-pulse" />
                    ))}
                </div>
            )}

            {!loading && !error && listings.length === 0 && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                    <div className="text-center py-12 text-gray-400">
                        <p className="text-lg">No Fireteam Finder listings found</p>
                        <p className="text-sm mt-1">
                            {selectedActivityHash
                                ? 'Try another activity or refresh in a moment.'
                                : 'Public listings will appear here when Bungie returns active posts.'}
                        </p>
                    </div>
                </div>
            )}

            {listings.length > 0 && (
                <div className="mb-4 text-sm text-gray-400">
                    Showing {listings.length} active {listings.length === 1 ? 'listing' : 'listings'}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {listings.map((listing) => (
                    <FireteamListingCard key={listing.id} listing={listing} />
                ))}
            </div>
        </div>
    );
}
