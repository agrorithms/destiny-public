import { NextRequest, NextResponse } from 'next/server';
import {
    clearOAuthState,
    exchangeCodeForSession,
    getAppOrigin,
    persistBungieSession,
    readOAuthState,
} from '@/lib/bungie/oauth';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');
    const error = searchParams.get('error');
    const stateCookie = readOAuthState(request);
    const appOrigin = getAppOrigin();

    if (error) {
        const destination = new URL(stateCookie?.returnTo || '/fireteam-finder', appOrigin);
        destination.searchParams.set('authError', error);
        const response = NextResponse.redirect(destination);
        clearOAuthState(response);
        return response;
    }

    if (!code || !returnedState || !stateCookie || stateCookie.state !== returnedState) {
        const destination = new URL('/fireteam-finder', appOrigin);
        destination.searchParams.set('authError', 'state_mismatch');
        const response = NextResponse.redirect(destination);
        clearOAuthState(response);
        return response;
    }

    try {
        const session = await exchangeCodeForSession(code);
        const destination = new URL(stateCookie.returnTo, appOrigin);
        destination.searchParams.set('auth', 'success');

        const response = NextResponse.redirect(destination);
        clearOAuthState(response);
        persistBungieSession(response, session);
        return response;
    } catch (callbackError) {
        const destination = new URL(stateCookie.returnTo, appOrigin);
        destination.searchParams.set(
            'authError',
            callbackError instanceof Error ? callbackError.message : 'oauth_callback_failed'
        );

        const response = NextResponse.redirect(destination);
        clearOAuthState(response);
        return response;
    }
}
