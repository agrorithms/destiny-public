import type { NextResponse } from 'next/server';

export function cacheControl(sMaxAgeSeconds: number, staleWhileRevalidateSeconds: number): string {
    return `public, max-age=0, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}

export function noStore(): string {
    return 'no-store';
}

export function withCache<T extends NextResponse>(response: T, sMaxAgeSeconds: number, staleWhileRevalidateSeconds: number): T {
    response.headers.set('Cache-Control', cacheControl(sMaxAgeSeconds, staleWhileRevalidateSeconds));
    return response;
}

export function withNoStore<T extends NextResponse>(response: T): T {
    response.headers.set('Cache-Control', noStore());
    return response;
}
