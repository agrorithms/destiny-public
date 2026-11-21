# The active-session loop can't silently die

The crawl loop and the active-session poll loop run on the same event loop and share **one**
singleton Bungie client / rate limiter (`getBungieClient()`). The session loop reschedules itself
only *after* a poll returns, so a single Bungie request that hangs past its `AbortSignal.timeout`
(`BUNGIE_FETCH_TIMEOUT_MS`, default 30s) — a rare escape, but it happens — used to park the whole
session loop **indefinitely** (observed: overnight stalls) while the cheaper PGCR crawl cycles kept
looping and its heartbeat stayed green.

Four guards close this off (`src/lib/crawler/index.ts` `activeSessionLoop`,
`src/lib/crawler/active-sessions.ts`):

- **Per-poll watchdog** (`ACTIVE_SESSION_POLL_WATCHDOG_MS`, default 600000 = 10 min). The whole
  poll body races a timer; on expiry we log, bump `session_watchdog_trips`, and reschedule.
  **Option A (abandon-in-place):** `Promise.race` does *not* cancel the losing promise, so the one
  hung request keeps its socket and leaks until process restart — acceptable at ~1 socket per rare
  event. **Future Option B (not yet done):** thread an `AbortController` (`AbortSignal.any`)
  through `BungieClient.request()` so the watchdog actually tears the hung request down instead of
  leaking it — deferred because it changes `request()` for the PGCR crawler and scanner too.
- **Bulletproof reschedule.** `setTimeout(activeSessionLoop, …)` lives in a `finally` (guarded by
  `shouldStop`/enable), and the Bungie-maintenance wait sits *inside* the try — so nothing thrown
  in a poll (watchdog, DB error, or the maintenance wait itself) can skip the reschedule. The
  `SystemDisabled` catch is record-only; the single maintenance-wait at the top of the next
  iteration does the actual blocking.
- **Completion-anchored heartbeat.** `crawler_state.session_heartbeat` is written only when a poll
  *completes* within budget (separate from the crawl-loop `heartbeat`, which stays fresh even when
  the session loop is dead). Surfaced on the admin stats page and factored into the `/api/status`
  health verdict — `SESSION_HEARTBEAT_STALE_SEC` (default 900 = 15 min) is when `/api/status`
  reports `degraded`.
- **Timeout ≠ offline.** `checkPlayerActivityDetailed` returns a distinct `error` status for a
  timeout/5xx (vs a *clean* `inactive`). During a Bungie storm this stops the re-verify from
  **deleting live fireteams** (no positive "raid ended" confirmation → keep the row; the
  `MAX_ACTIVE_SESSION_AGE_SECONDS` force-delete is the backstop) and stops the candidate poll from
  **benching live raiders** on offline backoff. It also skips the doomed teammate probes on a
  failed anchor, cutting wasted storm API calls.
- **The rule covers every writer** (2026-11-14): no path removes an Active Session without a positive
  confirmation from the crawler's own Bungie call. No browser request removes an Active Session
  (ADR 0010).
- **The teammate probe now runs** (2026-11-18, #9002): Bungie's transitory party members carry no
  membership type, so until then the re-verify found no teammate it could probe, and a cleanly
  gone player's row was removed unprobed. Each teammate's type now comes from the `players`
  table; a teammate the Tracker doesn't know is still skipped.
- **A slow poll is not a hung request** (2026-11-21, noted while planning ADR 0011). Option A
  assumes the work the watchdog abandons is one hung request. A poll that is only *slow* (more
  players than fit in the budget) keeps running in full after it is abandoned, alongside the next
  poll, so the two share the key and each runs slower, and the next is likelier to trip too. The
  watchdog is fixed at 600s while the interval (`CRAWLER_ACTIVE_SESSION_INTERVAL_MS`, 120s) is
  start-to-start: past 120s polls run back-to-back, and shortening the interval below a poll's
  duration changes nothing. Before raising `CRAWLER_SESSION_POLLING_LIMIT`, measure poll duration
  (`Poll took` in the crawler log) and keep its p95 under about a third of the watchdog. Raise the
  frequency first, then the limit in steps. If p95 nears that bound, Option B stops being optional.
