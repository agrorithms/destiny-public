'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBungieAuth } from '@/hooks/useBungieAuth';

export default function BungieAuthBadge() {
    const pathname = usePathname();
    const {
        authenticated,
        session,
        redirectUri,
        loading,
        sessionExpired,
        acknowledgeSessionExpired,
    } = useBungieAuth();

    const returnTo = pathname || '/fireteam-finder';
    const authBaseOrigin = (() => {
        try {
            return new URL(redirectUri || '').origin;
        } catch {
            return '';
        }
    })();
    const loginHref = authBaseOrigin
        ? `${authBaseOrigin}/api/auth/bungie/login?returnTo=${encodeURIComponent(returnTo)}`
        : `/api/auth/bungie/login?returnTo=${encodeURIComponent(returnTo)}`;
    const logoutHref = authBaseOrigin
        ? `${authBaseOrigin}/api/auth/bungie/logout?returnTo=${encodeURIComponent(returnTo)}`
        : `/api/auth/bungie/logout?returnTo=${encodeURIComponent(returnTo)}`;

    return (
        <div className="flex items-center gap-3 shrink-0">
            {sessionExpired && (
                <span className="rounded-full border border-amber-800 bg-amber-900/30 px-3 py-1 text-xs text-amber-200">
                    Session expired
                </span>
            )}

            {loading ? (
                <div className="h-9 w-40 rounded-full bg-gray-800 animate-pulse" />
            ) : authenticated ? (
                <>
                    <div className="flex items-center gap-2 rounded-full border border-emerald-800 bg-emerald-900/20 px-3 py-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className="text-sm text-emerald-100">
                            {session?.displayName || 'Bungie user'}
                        </span>
                    </div>
                    <Link
                        href={logoutHref}
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                    >
                        Sign out
                    </Link>
                </>
            ) : (
                <Link
                    href={loginHref}
                    onClick={() => {
                        if (sessionExpired) {
                            acknowledgeSessionExpired();
                        }
                    }}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500 transition-colors"
                >
                    Sign in with Bungie
                </Link>
            )}
        </div>
    );
}
