'use client';

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

export default function FireteamListingCard({ listing }: { listing: FireteamListing }) {
    return (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 space-y-4">
            <div className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-semibold text-white">{listing.title}</h3>
                        <p className="text-sm text-blue-300">{listing.activityName}</p>
                    </div>
                    {listing.availableSlots !== null && (
                        <span className="shrink-0 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
                            {formatSlots(listing)}
                        </span>
                    )}
                </div>
                {listing.description && (
                    <p className="text-sm text-gray-300 line-clamp-3">{listing.description}</p>
                )}
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <dt className="text-gray-500">Host</dt>
                    <dd className="text-gray-100">{listing.hostDisplayName}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Members</dt>
                    <dd className="text-gray-100">{formatMemberCount(listing)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Created</dt>
                    <dd className="text-gray-100">{formatDateTime(listing.createdAt)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Scheduled</dt>
                    <dd className="text-gray-100">{formatDateTime(listing.scheduledAt)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Mic</dt>
                    <dd className="text-gray-100">{formatBoolean(listing.isMicRequired)}</dd>
                </div>
                <div>
                    <dt className="text-gray-500">Platform</dt>
                    <dd className="text-gray-100">{listing.platformLabel || 'Unknown'}</dd>
                </div>
            </dl>

            <div className="flex flex-wrap gap-2 border-t border-gray-700 pt-4">
                {listing.language && (
                    <span className="rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-200">
                        {listing.language}
                    </span>
                )}
                {listing.rawState !== null && (
                    <span className="rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-200">
                        State: {String(listing.rawState)}
                    </span>
                )}
                {listing.activityHash !== null && (
                    <span className="rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-200">
                        Hash: {listing.activityHash}
                    </span>
                )}
            </div>
        </div>
    );
}

function formatSlots(listing: FireteamListing): string {
    if (listing.availableSlots === null) return 'Slots unknown';
    if (listing.totalSlots === null) return `${listing.availableSlots} open`;
    return `${listing.availableSlots}/${listing.totalSlots} open`;
}

function formatMemberCount(listing: FireteamListing): string {
    if (listing.memberCount === null) return 'Unknown';
    if (listing.totalSlots === null) return String(listing.memberCount);
    return `${listing.memberCount}/${listing.totalSlots}`;
}

function formatBoolean(value: boolean | null): string {
    if (value === null) return 'Unknown';
    return value ? 'Required' : 'Not required';
}

function formatDateTime(value: string | null): string {
    if (!value) return 'Unknown';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString();
}
