'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRef } from 'react';

export interface BungieAuthSession {
    displayName: string;
    destinyMembershipType: number;
    destinyMembershipId: string;
    characterId: string;
    accessTokenExpiresAt: number;
}

interface BungieAuthSessionResponse {
    authenticated: boolean;
    redirectUri: string;
    session: BungieAuthSession | null;
}

const AUTH_CHANGE_EVENT = 'bungie-auth-changed';

export function notifyBungieAuthChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
}

export function useBungieAuth() {
    const wasAuthenticatedRef = useRef(false);
    const [authenticated, setAuthenticated] = useState(false);
    const [session, setSession] = useState<BungieAuthSession | null>(null);
    const [redirectUri, setRedirectUri] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [sessionExpired, setSessionExpired] = useState(false);

    const refreshSession = useCallback(async () => {
        const response = await fetch('/api/auth/bungie/session', {
            cache: 'no-store',
            credentials: 'same-origin',
        });
        const data: BungieAuthSessionResponse = await response.json();

        setRedirectUri(data.redirectUri);
        if (wasAuthenticatedRef.current && !data.authenticated) {
            setSessionExpired(true);
        } else if (data.authenticated) {
            setSessionExpired(false);
        }

        wasAuthenticatedRef.current = data.authenticated;
        setSession(data.session);
        setAuthenticated(data.authenticated);
        setLoading(false);
        return data;
    }, []);

    const acknowledgeSessionExpired = useCallback(() => {
        setSessionExpired(false);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshSession().catch((error) => {
                console.error('Failed to load Bungie auth session:', error);
                setLoading(false);
            });
        }, 0);

        return () => window.clearTimeout(timer);
    }, [refreshSession]);

    useEffect(() => {
        const interval = setInterval(() => {
            void refreshSession().catch((error) => {
                console.error('Failed to refresh Bungie auth session:', error);
            });
        }, 60_000);

        const onFocus = () => {
            void refreshSession().catch((error) => {
                console.error('Failed to refresh Bungie auth session on focus:', error);
            });
        };

        const onAuthChanged = () => {
            void refreshSession().catch((error) => {
                console.error('Failed to refresh Bungie auth session after auth change:', error);
            });
        };

        window.addEventListener('focus', onFocus);
        window.addEventListener(AUTH_CHANGE_EVENT, onAuthChanged);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChanged);
        };
    }, [refreshSession]);

    return {
        authenticated,
        session,
        redirectUri,
        loading,
        sessionExpired,
        refreshSession,
        acknowledgeSessionExpired,
    };
}
