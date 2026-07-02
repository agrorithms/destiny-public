import type { NextRequest } from 'next/server';

/** Best-effort client IP for rate limiting. `cf-connecting-ip` is set by Cloudflare and
 * cannot be forged by the client, so it is checked first. The first `x-forwarded-for`
 * entry is client-controlled (Cloudflare appends the real IP to the END of any forged
 * list), so it is only a fallback for setups not behind the tunnel (dev, direct access).
 * Falls back to 'unknown' (shared bucket) when unavailable. */
export function getClientIp(request: NextRequest): string {
    const cfIp = request.headers.get('cf-connecting-ip')?.trim();
    if (cfIp) return cfIp;

    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim();
        if (first) return first;
    }
    return 'unknown';
}
