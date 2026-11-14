# Cloudflare configuration

Cloudflare sits in front of the app (tunnel from the Oracle box) and its settings are **not in the
repo**. This file records the ones the app's behaviour depends on, so a code change that assumes edge
behaviour can be checked against it. Recorded from the dashboard and from `curl` on the box,
**2026-11-14**; verify against the dashboard before relying on any row, since nothing keeps this file
in sync.

Zone: `destinyfarmfinder.qzz.io`. Plan: Free.

For why the cache rules matter and how a missing Browser TTL bit us, see `docs/decisions.md` (cache
entries) and the comment on `archiveCacheControl` in `src/lib/http/cache.ts`.

WAF, rate-limiting, Access and bot-protection state is deliberately not recorded here; it lives in
the private scan notes.

## Cache Rules (Caching → Cache Rules, 5 active)

| # | Name | Match | Action |
|---|---|---|---|
| 1 | Bypass cache for API routes | URI Path starts with `/api/status` | Bypass cache |
| 2 | Cache leaderboard API | Hostname equals `destinyfarmfinder.qzz.io` and URI Path starts with `/api/leaderboard` | Browser TTL, eligible for cache, Edge TTL |
| 3 | cache live-stats 15s | URI Path starts with `/api/live-stats` | Browser TTL, eligible for cache, Edge TTL |
| 4 | active-sessions temp cache | URI Path starts with `/api/active-sessions` | Browser TTL, eligible for cache, Edge TTL |
| 5 | Aggressive cache for static assets | URI Path ends with `.js`, `.css` or `.png` | Eligible for cache, Edge TTL |

Not covered by any rule, so never cached at the edge: `/player/*` and every other HTML page,
`/api/analytics/*`, `/api/players/*`, `/api/stats`, `/api/discovery`, `/api/gos10k/*`.

## Network and TLS

| Setting | State | Why it matters |
|---|---|---|
| Network → IPv6 Compatibility | On | Default. IPv6 visitors reach the site |
| Network → Pseudo IPv4 | **Off** | Leave off. The origin gets the visitor's real address in `CF-Connecting-IP`; on, it could receive a synthetic IPv4 and change what per-address limits key on |
| SSL/TLS → Edge Certificates → HSTS | **Not enabled** | No `strict-transport-security` header is sent. If enabled: short `max-age`, no preload (hard to undo) |

## Headers prod returns (curl from the box, 2026-11-14)

| Path | `cache-control` | `cf-cache-status` | Other |
|---|---|---|---|
| `/` | `s-maxage=31536000` | `DYNAMIC` | `x-nextjs-prerender: 1`, `x-powered-by: Next.js`, no HSTS |
| `/player/3/<id>` | `private, no-cache, no-store, max-age=0, must-revalidate` | `DYNAMIC` | no `age`, no `set-cookie`, not prerendered |
| `/api/active-sessions` | `public, max-age=1, s-maxage=10, stale-while-revalidate=30` | `EXPIRED` then `HIT` | caches as designed |

`/player/*` carries the page token, so it must never be edge-cached. Do not add a cache rule that
matches it, or a "cache everything" rule, without re-running the check below.

## How to re-check caching and headers

Use GET, never `curl -I`: HEAD does not populate Cloudflare's cache, and requests can land on
different data centres (`cf-ray` shows which), so a single `MISS` proves nothing.

```bash
H=https://destinyfarmfinder.qzz.io
ID=<a real membershipId>
curl -sS -D - -o /dev/null "$H/player/3/$ID" | grep -iE "^(HTTP|cache-control|cf-cache-status|age|set-cookie)"
curl -sS -D - -o /dev/null "$H/api/active-sessions" | grep -i cf-cache
curl -sS -D - -o /dev/null "$H/" | grep -iE "^(strict-transport|x-powered-by)"
```

Run each twice; the second run is the one that shows a cache `HIT`. Keep a `grep` pattern on one
line when pasting, or the shell splits it.
