import { NextRequest, NextResponse } from 'next/server';
import {
    clearBungieSession,
    getBungieRedirectUri,
    getValidBungieSession,
    persistBungieSession,
} from '@/lib/bungie/oauth';

export async function GET(request: NextRequest) {
    const session = await getValidBungieSession(request);

    const response = NextResponse.json({
        authenticated: !!session,
        redirectUri: getBungieRedirectUri(),
        session: session
            ? {
                displayName: session.displayName,
                destinyMembershipType: session.destinyMembershipType,
                destinyMembershipId: session.destinyMembershipId,
                characterId: session.characterId,
                accessTokenExpiresAt: session.accessTokenExpiresAt,
            }
            : null,
    });

    if (session) {
        persistBungieSession(response, session);
    } else if (request.cookies.get('bungie_session')) {
        clearBungieSession(response);
    }

    return response;
}
