// Lightweight request-authenticity guard for the public client-write endpoints
// (active-session-update, identity, queue-crawl). These accept browser POSTs using the public
// Bungie key, so they're reachable by anyone. This raises the bar against scripted abuse —
// it is NOT airtight auth (a determined attacker can scrape a token within its TTL):
//   1. Same-origin check  — Origin/Referer must match the site (blocks CSRF + lazy bots).
//   2. Short-lived HMAC page token — minted into the page server-side, echoed back by the
//      browser, proving the caller loaded a real page recently.
import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

const DEFAULT_SITE_URL = 'https://destinyfarmfinder.qzz.io';
const TOKEN_TTL_MS = 15 * 60_000; // 15 minutes

export const PAGE_TOKEN_HEADER = 'x-page-token';

function allowedHosts(request: NextRequest): Set<string> {
    const hosts = new Set<string>();
    try {
        hosts.add(new URL(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).host);
    } catch {
        // ignore malformed config
    }
    // Same-origin: the request's own Host (handles dev + any deploy domain).
    const host = request.headers.get('host');
    if (host) hosts.add(host);
    hosts.add('localhost:3000');
    return hosts;
}

function hostFromHeader(value: string | null): string | null {
    if (!value) return null;
    try {
        return new URL(value).host;
    } catch {
        return null;
    }
}

/** True when the request's Origin (or Referer) belongs to this site. */
export function isSameOrigin(request: NextRequest): boolean {
    const hosts = allowedHosts(request);
    const originHost = hostFromHeader(request.headers.get('origin'));
    if (originHost) return hosts.has(originHost);
    // Some browsers omit Origin on same-origin requests; fall back to Referer.
    const refererHost = hostFromHeader(request.headers.get('referer'));
    if (refererHost) return hosts.has(refererHost);
    return false;
}

function getSecret(): string | null {
    const secret = process.env.PAGE_TOKEN_SECRET;
    return secret && secret.length > 0 ? secret : null;
}

function sign(expiryMs: number, secret: string): string {
    return createHmac('sha256', secret).update(String(expiryMs)).digest('base64url');
}

/**
 * Mint a token for embedding in a server-rendered page. Returns '' when PAGE_TOKEN_SECRET is
 * unset (token layer disabled — the same-origin check still applies).
 */
export function mintPageToken(ttlMs: number = TOKEN_TTL_MS): string {
    const secret = getSecret();
    if (!secret) return '';
    const expiry = Date.now() + ttlMs;
    return `${expiry}.${sign(expiry, secret)}`;
}

/** Validate a page token's signature and expiry. Fails open when no secret is configured. */
export function verifyPageToken(token: string | null | undefined): boolean {
    const secret = getSecret();
    if (!secret) return true; // token layer not enabled
    if (!token) return false;

    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const expiryMs = Number(token.slice(0, dot));
    const providedSig = token.slice(dot + 1);
    if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;

    const expectedSig = sign(expiryMs, secret);
    const a = Buffer.from(providedSig);
    const b = Buffer.from(expectedSig);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Combined guard for the client-write endpoints. Returns true when the request is allowed.
 * Routes should 403 when this returns false.
 */
export function isTrustedClientWrite(request: NextRequest): boolean {
    if (!isSameOrigin(request)) return false;
    if (!verifyPageToken(request.headers.get(PAGE_TOKEN_HEADER))) return false;
    return true;
}
