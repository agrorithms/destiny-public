# Environment variables: tuning knobs

> Moved from `CLAUDE.md` on 2026-11-21. `CLAUDE.md` keeps the core, Archive and Web variables;
> this file holds the tuning knobs whose *value* matters for a reason the code doesn't explain.
> The scripts named at the bottom list every knob and its default.

## Tuning

- `SQLITE_BUSY_TIMEOUT_MS` (30000) — how long any process waits on a competing write lock before SQLITE_BUSY. The wait blocks that process's event loop.
- `CRAWLER_MEMBER_RESOLVE_CONCURRENCY` (4) — member resolution runs concurrently rather than one-at-a-time; sequential resolution of the full `CRAWLER_MEMBER_RESOLVE_LIMIT` could run ~25 × fetch-timeout ≈ 12.5 min and trip the poll watchdog on its own.
- `BUNGIE_GAME_SERVER_BACKOFF_SEC` (2) — self-imposed per-key pause when Bungie returns ErrorCode 1672 `DestinyThrottledByGameServer`, which arrives with `ThrottleSeconds: 0`.
- `CRAWLER_CLEANUP_BATCH_SIZE` (500) — expired PGCRs deleted per cleanup transaction, sized to keep each write-lock hold sub-second; one whole-backlog DELETE would hold the write lock for minutes and freeze the crawler's event loop. `CRAWLER_CLEANUP_YIELD_MS` (25) pauses between batches so the session/crawl loops and the scanner interleave.
- `SCANNER_HOLE_EMPTY_BATCHES` (5) — empty batches in a row (every id `not_found`, nothing else) before the scanner crosses an Id Hole onto the lowest stored id past the Scanner Position; about 60s at prod's timing. Too low and a quiet spell at the Leading Edge crosses on the crawler's newest row, skipping ids about to appear; too high and each hole stalls the scanner longer. Read only in `DEFAULT_SCANNER_CONFIG`, as `workers` is.
- `SCANNER_LAG_THRESHOLD_SEC` (900) — how long ago the newest scanner-stored raid may have ended before `/api/status` reports degraded ([ADR 0011](adr/0011-the-scanner-is-the-primary-pgcr-source.md)). Read only in `src/app/api/status/route.ts`. 900 sits above the scanner's normal catch-up: in the week to 2026-11-21, 296,415 of its 300,677 PGCRs were stored within 15 minutes of the raid ending. Too low and a quiet spell flips the site degraded for nothing; too high and a stopped scanner stays hidden, as in the 52-hour outage of 2026-11-03. Floored at 60. No maintenance exemption: no raids end during Bungie maintenance, so the check reads degraded then. The read walks `idx_pgcrs_ended` newest-first, about 38 ms median on the x86 dev machine against a copy whose newest 135k rows are crawler-sourced; prod's ARM box runs about 2x slower, so expect about 75–80 ms per `/api/status` during a scanner outage, every request uncached because degraded responses are no-store.

## Active sessions

Active-session display (`/active-sessions` + the StatsBar/OG count): `ACTIVE_SESSION_DISPLAY_LIMIT` (default 600 — max **fireteams** rendered; counted in fireteams, never rows) and `ACTIVE_SESSION_ROW_SCAN_LIMIT` (default 3000 — max raw per-player rows scanned before dedupe). These are two different units and must stay separate: `active_sessions` is keyed by `membership_id`, so one fireteam yields up to 6 rows, and capping rows silently drops the longest-running raids. See `docs/adr/0001-fireteam-denominated-display-cap.md`. Verify with `npx tsx scripts/verify-active-session-limit.ts` (needs the crawler running — 900s freshness window).

Active-session poll backoff (players found offline/private are snoozed instead of re-polled every cycle; maintained by `recordSessionCheck` on `players.next_session_eligible_at`): `SESSION_OFFLINE_BACKOFF_BASE_SEC` (default 120), `SESSION_OFFLINE_BACKOFF_CAP_SEC` (default 960 ≈ 16 min), `SESSION_PRIVACY_BACKOFF_SEC` (default 21600 = 6h).

Active-session poll requests (a player the crawler checks on its next cycle; the profile page sends them through `profile-viewed`): `ACTIVE_SESSION_POLL_REQUEST_MAX_PER_CYCLE` (default 20 — requested players with no session row polled per cycle, one GetProfile each, on top of `CRAWLER_SESSION_POLLING_LIMIT`) and `ACTIVE_SESSION_POLL_REQUEST_QUEUE_MAX` (default 200 — pending no-row requests; an enqueue beyond it is refused). A request on a player who already has a row only marks it due for re-verify, inside `ACTIVE_SESSION_STALE_REVERIFY_LIMIT`; a player in session privacy backoff is declined.

`ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN` (default 60) and `ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC` (default 300) — web-side limits on `POST /api/players/profile-viewed`: one limiter across all callers and a per-player cooldown started only by an accepted request. In memory and per web process, so up to twice the value under PM2 cluster x2; neither is keyed on the caller's address.

## History-crawl requests

History-crawl requests (`profile-viewed`, the viewed player only): `HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN` (default 60) and `HISTORY_CRAWL_REQUEST_QUEUE_MAX` (default 200 — profile-view rows in `crawl_queue`; the crawler's own session-end enqueues are not counted or capped). The limiter is web-side and in memory per process, so up to twice the value under PM2 cluster x2; the queue cap is enforced in SQLite and holds across processes. Neither is keyed on the caller's address; the per-player cooldown is a fixed 120s.

## Full list

`scripts/start-crawler.ts`, `scripts/start-scanner.ts`, `scripts/discover.ts`.
