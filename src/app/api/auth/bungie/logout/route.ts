import { NextRequest, NextResponse } from 'next/server';
import { clearBungieSession, clearOAuthState, getAppOrigin, sanitizeReturnTo } from '@/lib/bungie/oauth';

export async function GET(request: NextRequest) {
    const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));
    const destination = new URL(returnTo, getAppOrigin());
    destination.searchParams.set('auth', 'signed_out');

    const response = NextResponse.redirect(destination);
    clearBungieSession(response);
    clearOAuthState(response);
    return response;
}
