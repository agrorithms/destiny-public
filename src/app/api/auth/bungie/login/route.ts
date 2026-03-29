import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
    buildBungieAuthorizeUrl,
    persistOAuthState,
    sanitizeReturnTo,
} from '@/lib/bungie/oauth';

export async function GET(request: NextRequest) {
    const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));
    const state = crypto.randomBytes(24).toString('base64url');
    const authorizeUrl = buildBungieAuthorizeUrl(state);

    const response = NextResponse.redirect(authorizeUrl);
    persistOAuthState(response, { state, returnTo });
    return response;
}
