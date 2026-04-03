import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function unauthorizedResponse(realm = 'Admin Stats') {
    return new NextResponse('Authentication required', {
        status: 401,
        headers: {
            'WWW-Authenticate': `Basic realm="${realm}"`,
        },
    });
}

export function middleware(request: NextRequest) {
    const expectedPassword = process.env.ADMIN_STATS_PASSWORD;
    const expectedUsername = process.env.ADMIN_STATS_USERNAME || 'admin';

    if (!expectedPassword) {
        return new NextResponse('Admin password is not configured.', { status: 503 });
    }

    const auth = request.headers.get('authorization');
    if (!auth || !auth.startsWith('Basic ')) {
        return unauthorizedResponse();
    }

    const encoded = auth.slice(6);
    let decoded = '';
    try {
        decoded = atob(encoded);
    } catch {
        return unauthorizedResponse();
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
        return unauthorizedResponse();
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (username !== expectedUsername || password !== expectedPassword) {
        return unauthorizedResponse();
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/admin/stats/:path*', '/api/stats'],
};
