import { NextRequest, NextResponse } from 'next/server';
import { createBungieClient, getBungieClient } from '@/lib/bungie/client';
import {
    getActivityNameFromHash,
    getManifestActivityOptions,
} from '@/lib/bungie/manifest';
import {
    clearBungieSession,
    getValidBungieSession,
    persistBungieSession,
} from '@/lib/bungie/oauth';

interface FireteamFinderViewerConfig {
    membershipType: number;
    membershipId: string;
    characterId?: string;
}

interface NormalizedFireteamListing {
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

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const requestedActivityHash = parseNullableNumber(searchParams.get('activityHash'));
    const pageSize = clamp(parseNullableNumber(searchParams.get('pageSize')) || 50, 1, 100);
    const overrideOfflineFilter = parseBoolean(searchParams.get('overrideOfflineFilter'));
    const activities = getManifestActivityOptions();

    if (requestedActivityHash !== null && Number.isNaN(requestedActivityHash)) {
        return NextResponse.json(
            { error: 'activityHash must be a number' },
            { status: 400 }
        );
    }

    const session = await getValidBungieSession(request);
    const viewerConfig = session
        ? {
            membershipType: session.destinyMembershipType,
            membershipId: session.destinyMembershipId,
            characterId: session.characterId,
        }
        : getViewerConfig();

    if (!viewerConfig) {
        return NextResponse.json({
            viewerConfigured: false,
            authenticated: false,
            activities,
            listings: [],
            error: 'Sign in with Bungie to browse Fireteam Finder listings.',
            help: 'Use /api/auth/bungie/login or the Sign in button on the Fireteam Finder page.',
        });
    }

    try {
        const client = session
            ? createBungieClient(session.accessToken)
            : getBungieClient();
        const characterId = viewerConfig.characterId || await resolveCharacterId(client, viewerConfig);

        const response = await client.searchFireteamListingsByFilters(
            viewerConfig.membershipType,
            viewerConfig.membershipId,
            characterId,
            { pageSize, filters: [] },
            overrideOfflineFilter
        );

        const rawResponse = response.Response || {};
        const rawListings = extractListings(rawResponse);
        const normalized = rawListings.map(normalizeListing);
        const filtered = requestedActivityHash === null
            ? normalized
            : normalized.filter((listing) => listing.activityHash === requestedActivityHash);

        const jsonResponse = NextResponse.json({
            viewerConfigured: true,
            authenticated: !!session,
            viewer: {
                membershipType: viewerConfig.membershipType,
                membershipId: viewerConfig.membershipId,
                characterId,
            },
            selectedActivityHash: requestedActivityHash,
            activities,
            count: filtered.length,
            nextPageToken: getString(rawResponse, ['nextPageToken']),
            listings: filtered,
        });

        if (session) {
            persistBungieSession(jsonResponse, session);
        }

        return jsonResponse;
    } catch (error) {
        console.error('[ERROR] Fireteam Finder query failed:', error);

        const message = error instanceof Error ? error.message : 'Failed to load Fireteam Finder listings';
        const requiresAuth = message.includes('WebAuthRequired') || message.includes('Please sign-in to continue');
        const requiresPrivilegedScope = message.includes('AccessNotPermittedByApplicationScope')
            || message.includes('PrivilegedScope');

        const jsonResponse = NextResponse.json({
            viewerConfigured: true,
            authenticated: (requiresAuth || requiresPrivilegedScope) ? false : !!session,
            activities,
            listings: [],
            error: requiresPrivilegedScope
                ? 'Bungie rejected Fireteam Finder for this app because the endpoint requires the application scope `PrivilegedScope`.'
                : requiresAuth
                ? 'Bungie requires an authenticated access token for Fireteam Finder browse requests.'
                : message,
            help: requiresPrivilegedScope
                ? 'Your Bungie application appears to be missing a Bungie-granted privileged scope. Normal OAuth sign-in is working, but the app itself is not allowed to browse Fireteam Finder listings.'
                : requiresAuth
                ? 'Sign in with Bungie on this site so we can attach your OAuth access token to Fireteam Finder requests.'
                : undefined,
        }, { status: requiresPrivilegedScope ? 403 : requiresAuth ? 401 : 500 });

        if (requiresAuth) {
            clearBungieSession(jsonResponse);
        } else if (session) {
            persistBungieSession(jsonResponse, session);
        }

        return jsonResponse;
    }
}

function getViewerConfig(): FireteamFinderViewerConfig | null {
    const membershipType = parseNullableNumber(process.env.FIRETEAM_FINDER_MEMBERSHIP_TYPE || null);
    const membershipId = process.env.FIRETEAM_FINDER_MEMBERSHIP_ID || '';
    const characterId = process.env.FIRETEAM_FINDER_CHARACTER_ID || undefined;

    if (membershipType === null || !membershipId) {
        return null;
    }

    return {
        membershipType,
        membershipId,
        characterId,
    };
}

async function resolveCharacterId(
    client: ReturnType<typeof getBungieClient>,
    viewer: FireteamFinderViewerConfig
): Promise<string> {
    if (viewer.characterId) {
        return viewer.characterId;
    }

    const profile = await client.getProfile(viewer.membershipType, viewer.membershipId, [100]);
    const characterId = profile.Response.profile?.data?.characterIds?.[0];

    if (!characterId) {
        throw new Error('Unable to resolve a Destiny character for the configured Fireteam Finder viewer account.');
    }

    return characterId;
}

function extractListings(response: Record<string, unknown>): any[] {
    const candidates = [
        response.listings,
        response.results,
        (response.results as any)?.results,
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    return [];
}

function normalizeListing(rawListing: any): NormalizedFireteamListing {
    const activityHash = getNumber(rawListing,
        ['activityHash'],
        ['activity', 'activityHash'],
        ['activity', 'referenceId'],
        ['lobby', 'activityHash'],
        ['listing', 'activityHash'],
    );

    const totalSlots = getNumber(rawListing,
        ['playerSlotCount'],
        ['totalPlayerSlotCount'],
        ['lobby', 'playerSlotCount'],
    );

    const availableSlots = getNumber(rawListing,
        ['availablePlayerSlotCount'],
        ['availableSlots'],
        ['lobby', 'availablePlayerSlotCount'],
    );

    const memberCount = getNumber(rawListing,
        ['filledPlayerSlotCount'],
        ['memberCount'],
        ['currentPlayerCount'],
        ['lobby', 'memberCount'],
    ) ?? (totalSlots !== null && availableSlots !== null ? totalSlots - availableSlots : null);

    const title = getString(rawListing,
        ['title'],
        ['listingTitle'],
        ['settings', 'title'],
        ['listingValues', 'title'],
        ['lobby', 'title'],
    ) || `Listing ${String(getString(rawListing, ['listingId']) || getString(rawListing, ['id']) || 'Unknown')}`;

    return {
        id: String(getString(rawListing, ['listingId']) || getString(rawListing, ['id']) || crypto.randomUUID()),
        title,
        description: getString(rawListing,
            ['description'],
            ['details'],
            ['listingValues', 'description'],
            ['settings', 'description'],
        ),
        activityHash,
        activityName: activityHash ? getActivityNameFromHash(activityHash) : 'Unknown Activity',
        hostDisplayName: getString(rawListing,
            ['owner', 'bungieGlobalDisplayName'],
            ['owner', 'displayName'],
            ['host', 'bungieGlobalDisplayName'],
            ['host', 'displayName'],
            ['creator', 'bungieGlobalDisplayName'],
            ['creator', 'displayName'],
        ) || 'Unknown Host',
        createdAt: getString(rawListing, ['createdAt'], ['creationDateTime'], ['createdDateTime']),
        scheduledAt: getString(rawListing, ['scheduledAt'], ['scheduledDateTime'], ['activitySlot'], ['scheduledDateTime']),
        availableSlots,
        totalSlots,
        memberCount,
        isMicRequired: getBoolean(rawListing, ['micRequired'], ['requirements', 'micRequired']),
        language: getString(rawListing, ['language'], ['requirements', 'language']),
        platformLabel: getString(rawListing, ['platform'], ['platformLabel'], ['crossplayPlatform']),
        rawState: getString(rawListing, ['state']) || getNumber(rawListing, ['state']),
    };
}

function getNestedValue(source: unknown, path: string[]): unknown {
    let current = source;

    for (const key of path) {
        if (!current || typeof current !== 'object' || !(key in current)) {
            return undefined;
        }

        current = (current as Record<string, unknown>)[key];
    }

    return current;
}

function getString(source: unknown, ...paths: string[][]): string | null {
    for (const path of paths) {
        const value = getNestedValue(source, path);
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
        if (typeof value === 'number') {
            return String(value);
        }
    }

    return null;
}

function getNumber(source: unknown, ...paths: string[][]): number | null {
    for (const path of paths) {
        const value = getNestedValue(source, path);
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number(value);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
    }

    return null;
}

function getBoolean(source: unknown, ...paths: string[][]): boolean | null {
    for (const path of paths) {
        const value = getNestedValue(source, path);
        if (typeof value === 'boolean') {
            return value;
        }
    }

    return null;
}

function parseNullableNumber(value: string | null): number | null {
    if (value === null || value.trim() === '') return null;
    return Number(value);
}

function parseBoolean(value: string | null): boolean | undefined {
    if (value === null) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
