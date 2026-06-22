import type { NextRequest } from 'next/server';

/** Best-effort client IP for rate limiting. Behind the Cloudflare tunnel, prefer the
 * forwarded headers. Falls back to 'unknown' (shared bucket) when unavailable. */
export function getClientIp(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim();
        if (first) return first;
    }
    return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}
