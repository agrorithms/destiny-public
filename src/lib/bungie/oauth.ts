import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { createBungieClient } from './client';

const AUTH_STATE_COOKIE = 'bungie_oauth_state';
const SESSION_COOKIE = 'bungie_session';
const DEFAULT_RETURN_TO = '/fireteam-finder';
const TOKEN_ENDPOINT = 'https://www.bungie.net/Platform/App/OAuth/token/';
const AUTHORIZE_ENDPOINT = 'https://www.bungie.net/en/OAuth/Authorize';
const CURRENT_USER_ENDPOINT = 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/';

interface BungieOAuthTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    refresh_expires_in?: number;
    membership_id?: string;
}

interface BungieMembership {
    membershipType: number;
    membershipId: string;
    displayName?: string;
    bungieGlobalDisplayName?: string;
    bungieGlobalDisplayNameCode?: number;
    applicableMembershipTypes?: number[];
}

interface BungieMembershipDataResponse {
    destinyMemberships?: BungieMembership[];
    primaryMembershipId?: string | number | null;
    bungieNetUser?: {
        membershipId?: string;
        displayName?: string;
    };
}

interface BungieSessionCookie {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken?: string;
    refreshTokenExpiresAt?: number;
    bungieMembershipId?: string;
    destinyMembershipType: number;
    destinyMembershipId: string;
    characterId: string;
    displayName: string;
}

interface OAuthStatePayload {
    state: string;
    returnTo: string;
}

export interface BungieAuthSession {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt?: number;
    bungieMembershipId?: string;
    destinyMembershipType: number;
    destinyMembershipId: string;
    characterId: string;
    displayName: string;
}

export function getBungieRedirectUri(): string {
    const configured = process.env.BUNGIE_REDIRECT_URI;
    if (configured) {
        return configured;
    }

    const appOrigin = process.env.APP_ORIGIN || 'https://127.0.0.1:3000';
    return `${appOrigin}/api/auth/bungie/callback`;
}

export function getAppOrigin(): string {
    const configuredRedirectUri = process.env.BUNGIE_REDIRECT_URI;
    if (configuredRedirectUri) {
        return new URL(configuredRedirectUri).origin;
    }

    return process.env.APP_ORIGIN || 'https://127.0.0.1:3000';
}

export function buildBungieAuthorizeUrl(state: string): string {
    const clientId = process.env.BUNGIE_CLIENT_ID;
    if (!clientId) throw new Error('BUNGIE_CLIENT_ID not set in environment');

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        state,
        redirect_uri: getBungieRedirectUri(),
    });

    return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export function persistOAuthState(
    response: NextResponse,
    payload: OAuthStatePayload
): void {
    response.cookies.set(AUTH_STATE_COOKIE, encodeSignedCookie(payload), createCookieOptions({
        maxAgeSeconds: 10 * 60,
        httpOnly: true,
    }));
}

export function readOAuthState(request: NextRequest): OAuthStatePayload | null {
    const raw = request.cookies.get(AUTH_STATE_COOKIE)?.value;
    if (!raw) return null;

    return decodeSignedCookie<OAuthStatePayload>(raw);
}

export function clearOAuthState(response: NextResponse): void {
    response.cookies.set(AUTH_STATE_COOKIE, '', createCookieOptions({
        maxAgeSeconds: 0,
        httpOnly: true,
    }));
}

export function persistBungieSession(response: NextResponse, session: BungieAuthSession): void {
    const payload: BungieSessionCookie = {
        accessToken: session.accessToken,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
        refreshToken: session.refreshToken,
        refreshTokenExpiresAt: session.refreshTokenExpiresAt,
        bungieMembershipId: session.bungieMembershipId,
        destinyMembershipType: session.destinyMembershipType,
        destinyMembershipId: session.destinyMembershipId,
        characterId: session.characterId,
        displayName: session.displayName,
    };

    const maxAgeSeconds = session.refreshTokenExpiresAt
        ? Math.max(0, Math.floor((session.refreshTokenExpiresAt - Date.now()) / 1000))
        : Math.max(0, Math.floor((session.accessTokenExpiresAt - Date.now()) / 1000));

    response.cookies.set(SESSION_COOKIE, encodeSignedCookie(payload), createCookieOptions({
        maxAgeSeconds,
        httpOnly: true,
    }));
}

export function clearBungieSession(response: NextResponse): void {
    response.cookies.set(SESSION_COOKIE, '', createCookieOptions({
        maxAgeSeconds: 0,
        httpOnly: true,
    }));
}

export async function getValidBungieSession(request: NextRequest): Promise<BungieAuthSession | null> {
    const raw = request.cookies.get(SESSION_COOKIE)?.value;
    if (!raw) return null;

    const session = decodeSignedCookie<BungieSessionCookie>(raw);
    if (!session) return null;

    if (session.accessTokenExpiresAt > Date.now() + 30_000) {
        return session;
    }

    if (!session.refreshToken || !session.refreshTokenExpiresAt || session.refreshTokenExpiresAt <= Date.now()) {
        return null;
    }

    return refreshBungieSession(session);
}

export async function exchangeCodeForSession(code: string): Promise<BungieAuthSession> {
    const token = await exchangeCodeForTokens(code);
    return hydrateSessionFromTokenResponse(token);
}

function getClientCredentials(): {
    clientId: string;
    clientSecret: string;
} {
    const clientId = process.env.BUNGIE_CLIENT_ID;
    const clientSecret = process.env.BUNGIE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('BUNGIE_CLIENT_ID and BUNGIE_CLIENT_SECRET must be set for OAuth.');
    }

    return { clientId, clientSecret };
}

async function exchangeCodeForTokens(code: string): Promise<BungieOAuthTokenResponse> {
    const { clientId, clientSecret } = getClientCredentials();

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: getBungieRedirectUri(),
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        throw new Error(`Bungie token exchange failed with ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<BungieOAuthTokenResponse>;
}

async function refreshBungieSession(existing: BungieSessionCookie): Promise<BungieAuthSession> {
    const { clientId, clientSecret } = getClientCredentials();

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: existing.refreshToken || '',
        client_id: clientId,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        throw new Error(`Bungie token refresh failed with ${response.status}: ${await response.text()}`);
    }

    const refreshed = await response.json() as BungieOAuthTokenResponse;

    return {
        accessToken: refreshed.access_token,
        accessTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
        refreshToken: refreshed.refresh_token || existing.refreshToken,
        refreshTokenExpiresAt: refreshed.refresh_expires_in
            ? Date.now() + refreshed.refresh_expires_in * 1000
            : existing.refreshTokenExpiresAt,
        bungieMembershipId: refreshed.membership_id || existing.bungieMembershipId,
        destinyMembershipType: existing.destinyMembershipType,
        destinyMembershipId: existing.destinyMembershipId,
        characterId: existing.characterId,
        displayName: existing.displayName,
    };
}

async function hydrateSessionFromTokenResponse(token: BungieOAuthTokenResponse): Promise<BungieAuthSession> {
    const membershipData = await fetchCurrentUserMemberships(token.access_token);
    const selectedMembership = pickDestinyMembership(membershipData);

    if (!selectedMembership) {
        throw new Error('No Destiny membership was returned for the authenticated Bungie account.');
    }

    const client = createBungieClient(token.access_token);
    const profile = await client.getProfile(
        selectedMembership.membershipType,
        selectedMembership.membershipId,
        [100]
    );

    const characterId = profile.Response.profile?.data?.characterIds?.[0];
    if (!characterId) {
        throw new Error('The authenticated Destiny profile does not have any characters.');
    }

    const displayName = formatDisplayName(selectedMembership);

    return {
        accessToken: token.access_token,
        accessTokenExpiresAt: Date.now() + token.expires_in * 1000,
        refreshToken: token.refresh_token,
        refreshTokenExpiresAt: token.refresh_expires_in
            ? Date.now() + token.refresh_expires_in * 1000
            : undefined,
        bungieMembershipId: token.membership_id || membershipData.bungieNetUser?.membershipId,
        destinyMembershipType: selectedMembership.membershipType,
        destinyMembershipId: selectedMembership.membershipId,
        characterId,
        displayName,
    };
}

async function fetchCurrentUserMemberships(accessToken: string): Promise<BungieMembershipDataResponse> {
    const apiKey = process.env.BUNGIE_API_KEY;
    if (!apiKey) throw new Error('BUNGIE_API_KEY not set in environment');

    const response = await fetch(CURRENT_USER_ENDPOINT, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Key': apiKey,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch Bungie memberships: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json() as {
        Response?: BungieMembershipDataResponse;
        ErrorCode?: number;
        Message?: string;
    };

    if (payload.ErrorCode && payload.ErrorCode !== 1) {
        throw new Error(payload.Message || 'Failed to fetch Bungie memberships.');
    }

    return payload.Response || {};
}

function pickDestinyMembership(data: BungieMembershipDataResponse): BungieMembership | null {
    const memberships = data.destinyMemberships || [];
    if (memberships.length === 0) return null;

    const primaryMembershipId = data.primaryMembershipId ? String(data.primaryMembershipId) : null;
    if (primaryMembershipId) {
        const primary = memberships.find((membership) => membership.membershipId === primaryMembershipId);
        if (primary) return primary;
    }

    return memberships[0] || null;
}

function formatDisplayName(membership: BungieMembership): string {
    if (membership.bungieGlobalDisplayName && membership.bungieGlobalDisplayNameCode !== undefined) {
        return `${membership.bungieGlobalDisplayName}#${String(membership.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }

    return membership.bungieGlobalDisplayName
        || membership.displayName
        || membership.membershipId;
}

function encodeSignedCookie(value: object): string {
    const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const signature = sign(payload);
    return `${payload}.${signature}`;
}

function decodeSignedCookie<T>(raw: string): T | null {
    const [payload, signature] = raw.split('.');
    if (!payload || !signature) return null;
    if (sign(payload) !== signature) return null;

    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
    } catch {
        return null;
    }
}

function sign(payload: string): string {
    const secret = process.env.BUNGIE_SESSION_SECRET || process.env.BUNGIE_CLIENT_SECRET;
    if (!secret) {
        throw new Error('BUNGIE_SESSION_SECRET or BUNGIE_CLIENT_SECRET must be set for OAuth cookie signing.');
    }

    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createCookieOptions({
    maxAgeSeconds,
    httpOnly,
}: {
    maxAgeSeconds: number;
    httpOnly: boolean;
}) {
    return {
        httpOnly,
        sameSite: 'lax' as const,
        secure: true,
        path: '/',
        maxAge: maxAgeSeconds,
    };
}

export function sanitizeReturnTo(input: string | null): string {
    if (!input || !input.startsWith('/')) {
        return DEFAULT_RETURN_TO;
    }

    return input;
}
