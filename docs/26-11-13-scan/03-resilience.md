# Lens 3: resilience of the background processes (2026-11-13)

Read-only audit of the crawler, scanner, discovery, the active-session poll loop, the rate limiter,
the scanner key pool and `ecosystem.config.js`. Commit audited: `4140409` (branch `sandbox`).
Nothing in the repo was changed except this file.

**How the evidence was gathered**

- Code reading, with `file:line` on every claim.
- Four throwaway scripts that drive the real modules against scratch databases with only `fetch`
  stubbed (the same approach as `tests/scanner/scanner-position.test.ts`). They live outside the
  repo and each refuses to run unless `RAID_TRACKER_DB_PATH` points into the scratchpad:
  - `/tmp/claude-1000/-home-louisagro-destinyCode-destiny-farm-finder/b62e4bde-5dbc-4946-a647-f150e254625d/scratchpad/repro-scanner.ts`
  - `/tmp/claude-1000/-home-louisagro-destinyCode-destiny-farm-finder/b62e4bde-5dbc-4946-a647-f150e254625d/scratchpad/repro-quiesce.ts`
  - `/tmp/claude-1000/-home-louisagro-destinyCode-destiny-farm-finder/b62e4bde-5dbc-4946-a647-f150e254625d/scratchpad/repro-503.ts`
  - Run as `RAID_TRACKER_DB_PATH=<scratch>/x.db npx tsx --tsconfig tsconfig.scripts.json <script> [mode]`.
- One read-only query (`readonly: true`) against `data/raid-tracker.backup-2026-11-05.db`. It is a
  prod backup: 1,868,741 PGCRs from 2026-10-06 to 2026-11-06, 78% scanner-sourced.
- `npm run e2e:maintenance` was **not** run. Per #177 it would send PGCR requests to the real
  `stats.bungie.net`.
- `.env` was not read. PM2 is not installed on this machine, so PM2 behaviour comes from its docs.

**Prod evidence added later on 2026-11-13** (run on the box by the owner, pasted into the session)

| What was checked | Result | What it changed |
| --- | --- | --- |
| `data/maintenance-state.json` | The downtime cleanup has never run | R-07 gains support; R-01 is dormant until that is fixed |
| `grep -c "API maintenance detected" ~/.pm2/logs/*.log` | 0 in every file, rotated ones included | Same |
| `grep -m5 "SystemDisabled" ~/.pm2/logs/crawler-error.log` | Nothing | R-07's trigger is still open (see R-07) |
| `pm2 logs scanner --lines 200000 --nostream \| grep "Disabling key"` | Nothing | R-03 has not fired in the retained logs: high → med |
| `... \| grep -c "Error fetching PGCR"` | 1 | R-02 is rare on prod in the retained logs: high → med |
| `pm2 describe scanner` | 20 restarts, 0 unstable, up 6 days, heap 20 MiB, event-loop p95 1.2 ms | No memory growth or loop blocking; the 20 restarts are unexplained (see R-05) |
| Crawl cycle time | About 12 s | The 300 s heartbeat threshold is not at risk |
| `pm2-logrotate`, `du -sh ~/.pm2/logs` | Installed; 31 MB in total | Logs can't fill the disk. They also only reach back a short way, which limits every grep above |
| `df -h` | 76 GB free of 96 GB | R-01's disk-full hypothesis is ruled out |
| Prod env values (no keys) | See R-08, R-13, R-14 and #207 | Two new low findings; #207 is not live on prod |

The retained logs are small, so "nothing found" above means "not in the last few days", not "never".
The first follow-up in the last section sizes that window.

**Summary** (severities revised after the prod evidence)

| ID | Title | Severity | Effort | Status |
| --- | --- | --- | --- | --- |
| R-01 | A kill or restart during the downtime VACUUM leaves the database gated shut for good | high | S | reproduced; dormant on prod while the VACUUM never runs (R-07) |
| R-02 | The scanner never goes back for an id whose request failed | med (was high) | S | reproduced; 1 occurrence in prod's retained logs |
| R-03 | One HTTP 429 (or 401/403) removes a scanner key until the process restarts | med (was high) | S | reproduced; not seen in prod's retained logs |
| R-04 | About 10.6 hours of failed crawls deactivates a player permanently | med | S | code + arithmetic; has not fired on prod |
| R-05 | The crawl loop and the scan loop have none of ADR 0005's guards | med | S–M | code; prod watchdog count supports it |
| R-06 | A failed PGCR fetch in the crawler still advances the player's coverage watermark | med | S | code |
| R-07 | Maintenance is never detected on prod; a Bungie error on a non-200 status is not a `BungieAPIError` | med | S | prod: cleanup never ran, no detection logged; cause not yet pinned |
| R-08 | A poll the watchdog abandons keeps running beside the next one | low | S | code |
| R-09 | A missing transitory component counts as "cleanly offline" | low | S | code; trigger is a hypothesis |
| R-10 | `ecosystem.config.js`: no restart backoff, no kill timeout for the workers, no log timestamps | low | S | config |
| R-11 | Scanner liveness: `scannerRunning` goes false while it scans, and stays true when it halts | low | S | reproduced / arithmetic |
| R-12 | Crawl-queue rows are deleted for players a cycle skipped | low | S | code |
| R-13 | Prod's 50 s poll interval uses up most of ADR 0001's row-scan headroom | low | S | arithmetic on prod's values; real row count not measured |
| R-14 | Four env knobs set on prod are read by nothing | low | S | grep |

---

## R-01. A kill or restart during the downtime VACUUM leaves the database gated shut for good

**Severity:** high. **Effort:** S.

**Sequence**

1. Bungie goes into maintenance. Five minutes in, whichever of the crawler or scanner wins the lease
   runs `runMaintenanceCleanup` (`src/lib/bungie/maintenance.ts:151`). It writes
   `isVacuuming: true` (`:163`) and `dbQuiesceActive: true` (`:171`) to `data/maintenance-state.json`,
   then runs `VACUUM` synchronously (`:126`). On a 5.5 GB file that is minutes with the event loop blocked.
2. The owner is killed in that window: a deploy (`pm2 restart all`), a reboot, an OOM kill. A blocked
   event loop can't run the SIGTERM handler, so PM2 follows up with SIGKILL.
3. Neither the `catch` (`:200`) nor the lease `finally` (`:229`) runs. The state file still says
   quiesce and vacuuming, and `maintenance-cleanup.lease` still exists.
4. From then on every `getDb()` in every process throws `DatabaseMaintenanceError`
   (`src/lib/db/index.ts:134`). Nothing clears it:
   - The only writers of `dbQuiesceActive: false` are the cleanup's own success and failure paths
     (`maintenance.ts:193`, `:204`).
   - The lease is taken with `flag: 'wx'` and `acquiredAt` is never read (`src/lib/maintenance/state.ts:131`),
     so no later cleanup can ever acquire it. The comment at `state.ts:154` says a future run "can
     overwrite state after restart"; it can't.
   - `scripts/run-db-maintenance.ts:133` sees `cleanupStatus: 'running'`, prints "A cleanup is already
     in progress. Nothing to do." and exits. It clears a stale `isVacuuming` (`:138`) but not this.
5. The restarted crawler calls `getPlayerCount()` before anything else (`scripts/start-crawler.ts:33`,
   and `main()` at `:73` has no catch) and the scanner calls `getDbStats()` (`scripts/start-scanner.ts:22`).
   Both exit 1 within a second. PM2 restarts with no delay, and marks an app errored after 16 unstable
   restarts. The web workers serve the maintenance snapshot indefinitely.

**A second, likelier trigger of step 5 alone:** the VACUUM finishes normally, but the *other* worker
restarts while it runs. It crash-loops on the same startup `getDb()` and ends up errored in PM2, and
stays down after maintenance until someone notices. Weekly-reset maintenance is when a new raid hash
would be deployed.

**Evidence** (`repro-quiesce.ts`: writes the state a killed owner leaves, then asks the real modules)

```
[REPRO] files left behind: [ 'maintenance-cleanup.lease', 'maintenance-state.json' ]
[REPRO] getDb(): throws DatabaseMaintenanceError: Database maintenance is in progress
[REPRO] after maybeRunDowntimeCleanup(): dbQuiesceActive=true isVacuuming=true cleanupStatus=running
[REPRO] tryAcquireCleanupLease('scanner-123') -> false
[REPRO] executeMaintenanceCleanup('manual', ...) -> false
[BUNGIE] crawler waiting for DB maintenance quiesce.
[REPRO] waitForBungieMaintenancePause(): still waiting after 3s (Bungie pause expired an hour ago)
```

```
$ grep -rn "dbQuiesceActive: false\|acquiredAt" src scripts --include=*.ts | grep -v test
src/lib/maintenance/state.ts:49:        dbQuiesceActive: false,          (the default state)
src/lib/maintenance/state.ts:131:        fs.writeFileSync(CLEANUP_LEASE_PATH, JSON.stringify({ owner, acquiredAt: Date.now() }), {
src/lib/bungie/maintenance.ts:193:            dbQuiesceActive: false,
src/lib/bungie/maintenance.ts:204:            dbQuiesceActive: false,
```

**Why it matters here.** The trigger is rare (the VACUUM runs at most once per 48 h), but the result is
a total outage with no alert and a recovery nobody would guess at 3am: hand-edit a JSON file, delete a
lease file, then `pm2 restart` the errored apps. With ~5 visitors a day it could sit for days.

**Prod, 2026-11-13.** Two things follow from the evidence table at the top.

- The downtime cleanup has never run on prod, so this has never had the chance to fire. It becomes live
  the day maintenance detection works (R-07). **Fix this before, or together with, R-07.**
- The disk-full variant I had as a hypothesis is ruled out: `df -h` shows 76 GB free on `/`.

**Suggested fix**

- Make the gate self-expiring: treat the lease and the quiesce flag as stale when the owning pid in
  the lease is dead (`process.kill(pid, 0)`), or when `cleanupStartedAt` is older than a generous bound.
- In both start scripts, call `waitForBungieMaintenancePause` before the first `getDb()`, and give
  `start-crawler.ts`'s `main()` a catch.
- Have `run-db-maintenance.ts --force` clear a stale run instead of refusing.

**ADR impact.** None contradicted. No ADR covers the downtime VACUUM. This is worth a `docs/decisions.md`
entry with the manual recovery steps, whether or not the code changes.

---

## R-02. The scanner never goes back for an id whose request failed

**Severity:** high. **Effort:** S.

**Sequence**

1. A batch is in flight. One id's request times out, hits a network error, returns HTTP 500, or its
   insert throws (`SQLITE_BUSY`, `DatabaseMaintenanceError`). `scanSinglePGCR` returns `'error'`
   (`src/lib/scanner/index.ts:519-520`). Only 502/503/504 become `'error_retryable'` (`:507-516`).
2. A later id in the same batch comes back, so the Scanner Position moves past the failed one (`:612-618`).
3. Only `not_found` and `error_retryable` below the last confirmed id are queued as Missed Ids
   (`:625-632`). `'error'` is counted as scanned (`:587-589`) and dropped.
4. Nothing asks for that id again. If it was a raid, only the crawler can recover it (see R-06).

This is ADR 0005's fourth guard in a different loop: a timeout is being read as an answer.

**Evidence** (`repro-scanner.ts error-skip`: S+1 and S+5 exist, S+2 times out, S+3 is a plain miss, S+4 is HTTP 500)

```
[SCANNER] Error fetching PGCR 17000000002: The operation was aborted due to timeout
[SCANNER] Error fetching PGCR 17000000004: Bungie API error 500: Internal Server Error
[REPRO] scanner_position = S+5
[REPRO] S+2 (fetch TIMEOUT)      requested 1x
[REPRO] S+3 (plain not_found)    requested 149x   <- control, queued as a Missed Id
[REPRO] S+4 (HTTP 500)           requested 1x
```

**Why it matters here.** The scanner supplies 78% of prod's PGCRs and is the source ADR 0009 relies on
for Raid Activity. Failures cluster: a Bungie brownout, or a 30-second `busy_timeout` block that makes
every in-flight request (up to 15) time out together. Each is a hole that ADR 0009 already warns "looks
like a quiet period", and it is silent apart from one log line per id.

**Suggested fix.** Queue `'error'` the same way as `'error_retryable'` at `index.ts:626`. The cap and the
Retry Pass already bound the cost. Keep `'error'` out of the Id Hole count as it is today (`:842`).

**ADR impact.** Hardens ADR 0005's "timeout ≠ offline" principle; I'd add one line to ADR 0005 saying it
applies to every loop, not a new ADR. Consistent with ADR 0009. The Missed Id entry in `CONTEXT.md`
("usually because the activity is still in progress") would need "or the request failed".

**Prod, 2026-11-13:** `pm2 logs scanner --lines 200000 --nostream | grep -c "Error fetching PGCR"`
returned **1**. So this path is hit rarely in normal running, and the severity drops from high to med.
It stays a real loss in a brownout, which the retained logs may not contain. If R-07's hypothesis holds,
a maintenance window arrives as 503s, which take the `'error_retryable'` path and are queued, not dropped.

---

## R-03. One HTTP 429 (or 401/403) removes a scanner key until the process restarts

**Severity:** high. **Effort:** S.

**Sequence**

1. Bungie answers one scanner request with HTTP 429. `BungieClient.request` pauses that key's limiter
   for `Retry-After` or 5 s and throws (`src/lib/bungie/client.ts:65-69`). That is the intended handling.
2. The scanner then disables the key outright (`shouldDisableScannerClient`, `src/lib/scanner/index.ts:184-191`,
   used at `:478-479`). Nothing ever re-enables a slot.
3. With keys left, the scanner carries on at reduced throughput with one warn line as the only trace.
4. With none left, the loop returns without rescheduling (`:856-865`). `writeScannerStats()` runs before
   `isRunning` is set to false (`:860` then `:862`), so the last persisted stats say it is running.

The two behaviours were written at different times and now contradict each other: the disable is from
`95deff5` ("multiple scanners"), the pause from `21ac7ae` (2026-07-04). No test covers a 429 in the scanner
(`grep -n "429" tests/scanner/scanner-position.test.ts` returns nothing).

**Evidence** (`repro-scanner.ts`: exactly one 429, then a healthy Bungie)

```
=== two keys
⚠️ HTTP 429 from Bungie — pausing key for 1s
[SCANNER] Disabling key-1 after HTTP 429. 1/2 scanner keys remain active.
[REPRO] requests by key over 1.5s: key-A=1 key-B=327

=== one key
[SCANNER] Disabling key-1 after HTTP 429. 0/1 scanner keys remain active.
[SCANNER] All scanner API keys are disabled or unavailable. Stopping scanner until keys are fixed.
[REPRO] 1s later: requests made = 1
[REPRO] persisted scanner_stats.isRunning = true
[REPRO] event loop drained on its own; process exiting with code 0
```

**Why it matters here.** Prod runs two or more scanner keys, so the likely outcome is the quiet one: half
the throughput for days. A scanner that can't keep up falls behind the Leading Edge, which is the
condition ADR 0009 recorded for 8–15 October ("the scanner was hours behind") and which biases the
Provisional estimate. **Hypothesis:** that backlog was this. Check with
`pm2 logs scanner --lines 200000 --nostream | grep "Disabling key"`. A 403 from Cloudflare's own block
page is treated the same as a revoked key.

In the all-keys case the standalone process exits 0. PM2 restarts an app that "ends peacefully", so it
probably recovers by restart, losing every Missed Id (#235). Whether it exits under PM2 is unverified.

**Prod, 2026-11-13:** `grep "Disabling key"` over the last 200,000 scanner log lines returned nothing.
It has not fired in the retained window, so the severity drops from high to med, and my hypothesis that
it caused the 8–15 October backlog has no support (those logs are gone). Whether prod has one key or
several is still unknown; it decides which of the two outcomes above applies.

**Suggested fix.** Don't disable on 429: the limiter pause already covers it, so return `'error_retryable'`.
For 401/403, disable with a cool-down and re-enable (say 10 minutes) instead of for good. When no key is
usable, wait and retry rather than ending the loop.

**ADR impact.** None. `CLAUDE.md`'s "each key gets its own RPS budget" stays true.

---

## R-04. About 10.6 hours of failed crawls deactivates a player permanently

**Severity:** med (severe if it fires, and it has not yet). **Effort:** S.

**Sequence**

1. Something makes every crawl fail for half a day: the crawler's API key expires or is revoked, the box
   loses DNS or outbound network, or Bungie has a long outage that doesn't arrive as `SystemDisabled`
   (see R-07).
2. Each attempt records `'transient'` (`src/lib/crawler/players.ts:386-389`, `:501`, `:508-518`). The
   backoff doubles from 300 s, and the eighth consecutive failure sets `is_active = 0`
   (`src/lib/db/queries.ts:399-407`).
3. Nothing ever sets it back. Both the crawl buckets and the session poll select `is_active = 1` only
   (`queries.ts:244`, `:605`, `:637`), so the player is gone from crawling and from `/active-sessions`
   even after the cause is fixed, and even if the scanner sees them raid every day.

**Evidence**

```
$ grep -rn "is_active = 1\|is_active = CASE" src scripts --include=*.ts   (writes only)
src/lib/db/queries.ts:405:          is_active = CASE WHEN consecutive_failures + 1 >= ? THEN 0 ELSE is_active END

$ node -e "let t=0;for(let n=0;n<7;n++){t+=Math.min(21600,300*(1<<n));} console.log(...)"
8th failure lands 10.6 h after the 1st
```

Prod backup, 2026-11-05:

```
players by is_active [ { is_active: 0, n: 6 }, { is_active: 1, n: 1417865 } ]
inactive but seen in a PGCR in the 7 days before the backup [ { n: 1, by_failures: 1 } ]
```

So it is latent: six players in 1.4 million, one of them deactivated by failures while still raiding.

**Why it matters here.** One unattended night with a dead key would deactivate the most active Tracked
Players first (the hot bucket is crawled most often), and there is no column that tells a wrongly
deactivated player from a deleted account, so undoing it means restoring a backup.

**Suggested fix.** Reactivate on evidence of life: when `insertFullPGCR` bumps `last_seen_at`
(`queries.ts:1412-1415`), also set `is_active = 1, consecutive_failures = 0`. A deleted account can't
appear in a new PGCR, so this can't resurrect one. Optionally skip the failure count when most of a
cycle failed.

**ADR impact.** Hardens ADR 0005 (transient failure is not "gone"). No amendment needed beyond the line
suggested under R-02.

---

## R-05. The crawl loop and the scan loop have none of ADR 0005's guards

**Severity:** med. **Effort:** S–M.

ADR 0005 says a Bungie request can hang past its `AbortSignal.timeout`, "a rare escape, but it happens",
and gave the session loop a watchdog. The other two loops share the same client code and have none.

- **Crawl loop** (`src/lib/crawler/index.ts:438-483`). `crawlCycle` awaits every worker (`:320`); one
  request that never settles parks the loop for good. There is no watchdog. The heartbeat is written at
  the start of a cycle (`:456`), so it goes stale and `/api/status` reports `degraded`, but nothing restarts
  anything. Separately, the maintenance wait and both state writes sit outside the `try` (`:447`, `:456-457`),
  and the reschedule is not in a `finally` (`:482`): the exact shape ADR 0005 removed from the session loop.
  Here a throw becomes an unhandled rejection, and no handler is registered
  (`grep -rn "unhandledRejection" src scripts` finds only a comment), so Node exits and PM2 restarts it.
  That is recovery by accident.
- **Scan loop** (`src/lib/scanner/index.ts:602-606`, `:710-714`). Same `Promise.all` over workers, no
  watchdog. A parked scanner is not part of the health verdict at all: `/api/status` computes `stale` from
  the two crawler heartbeats only (`src/app/api/status/route.ts:11-25`) and reports `scannerRunning` as a
  bare field.

**Evidence that the escape is real on prod** (backup, 2026-11-05):

```
{ key: 'session_watchdog_trips', v: '74', u: '2026-11-04 13:35:34' }
```

74 abandoned polls since the watchdog shipped (2026-07-22), about 0.7 a day. I can't tell from the count
how many were true hangs and how many were slow polls. If even a few were hangs, the same hang in a scanner
worker stops 78% of ingestion until the next deploy.

**Prod, 2026-11-13.**

- Crawl cycles take about 12 s, far under the 300 s threshold in `/api/status`, so a stale crawl
  heartbeat on prod does mean a parked or dead loop, not a slow cycle.
- `pm2 describe scanner` shows the scanner healthy after 6 days: heap 20 MiB, event-loop p95 1.2 ms.
- It also shows **20 restarts and 0 unstable restarts** on an entry created 2026-11-06T17:39Z, with 6 days
  of uptime. If PM2 keeps `created at` across restarts, all 20 happened within about a day of creation.
  That could be deploys of #234 and #237, or the scanner exiting and being restarted. I can't tell which
  from this output; the follow-up table has the command.

**Why it matters here.** A stopped scanner draws as a quiet period on Raid Activity (ADR 0009) and
back-fills only after a restart. A stopped crawl loop shows as stale Data Freshness, which is at least visible.

**Suggested fix.** One small progress watchdog per process rather than per loop: each loop stamps
`lastProgressAt` when a batch or cycle finishes, and an unref'd `setInterval` logs loudly and calls
`process.exit(1)` when it is more than N minutes old outside a maintenance wait. PM2 does the restart.
Add the scanner's stats age to the `/api/status` verdict. For the scanner a restart costs the Missed Ids (#235).

**ADR impact.** Hardens ADR 0005 by extending guards 1–3 to the other loops; amend ADR 0005 with a short
section. Its deferred Option B (an `AbortController` through `request()`) would remove the cause for all
three loops and is the better long-term fix, but it is not needed for this.

---

## R-06. A failed PGCR fetch in the crawler still advances the player's coverage watermark

**Severity:** med. **Effort:** S.

**Sequence**

1. `crawlPlayer` collects instance ids from a player's history, then calls `fetchAndStorePGCR` for each
   (`src/lib/crawler/players.ts:480-481`).
2. A fetch times out or 5xxs, or the insert throws. `fetchAndStorePGCR` logs and returns `null`
   (`src/lib/crawler/pgcr.ts:122-128`), the same value as "already stored" (`:67-69`) and "not a raid" (`:79-81`).
3. `hadError` is only set by history-page errors, so the outcome is `'success'` and `last_crawled_at`
   moves to now (`players.ts:501`).
4. The next crawl stops at runs that ended before `last_crawled_at - 30 min` (`players.ts:300`), so the
   failed id is not collected again unless it ended within that half hour.

**Why it matters here.** The crawler and scanner each lean on the other for what they drop. R-02 and this
fail together, in the same Bungie brownout, and that raid is then in neither.

**Suggested fix.** Return a distinct result for a failed fetch (or rethrow) and treat it as `hadError`, so
the watermark holds and the id is collected again.

**ADR impact.** Same line as R-02 in ADR 0005.

---

## R-07. Maintenance is never detected on prod; a Bungie error on a non-200 status is not a `BungieAPIError`

**Severity:** med. **Effort:** S. **The code path is reproduced. Prod shows the symptom; the cause is not pinned yet.**

**Prod, 2026-11-13.**

- `data/maintenance-state.json` shows the downtime cleanup has never run.
- `"API maintenance detected"` appears 0 times in every PM2 log file, rotated ones included.
- `"SystemDisabled"` does not appear in `crawler-error.log` (the current file only).

So the pause and the VACUUM have not happened in the retained window. What that doesn't settle:

- **Whether a maintenance window is inside the retained logs at all.** They total 31 MB. If Tuesday
  2026-11-10 is not covered, or Bungie's API stayed up that day, these greps prove nothing.
- **What Bungie actually sent.** A 503 with a `SystemDisabled` body would have left that word in the
  crawler's error log, because the crawler logs the whole message. It isn't there. That leaves a 503
  with a non-JSON body (a Cloudflare page), some other error code such as `DestinyPGCRNotFound`
  (the guess in `docs/handoffs/261020-scanner-ahead-fix.md:24`), or no maintenance in the window.
- **A lesser alternative:** detection works but the cleanup never becomes eligible. The pause and the
  cleanup delay are both 5 minutes (`maintenance.ts:12-13`), so the cleanup is only eligible in the gap
  a second detection opens by extending the pause (`:295-297`, `:89`). I expect that gap to be a few
  seconds and to be caught, but I have not tested it. The zero count for "API maintenance detected"
  argues against this one: detection would have logged.

**A consequence either way: the prod database has never been vacuumed.** The 2026-11-05 backup, which
`VACUUM INTO` compacts, is 2.07 GB. If the live file is still near the 5.5 GB on record, more than half
of it is free pages. The follow-up table has the command.

`request()` throws a plain `Error` for any non-2xx response, even when the body is a Bungie envelope
(`src/lib/bungie/client.ts:62-85`). Every classifier downstream is `instanceof BungieAPIError`, patched with
string matching on the message in some places (`scanner/index.ts:494-495`, `active-sessions.ts:94-99`,
`players.ts:194-197`) and not in others. `isBungieSystemDisabledError` has no such patch
(`src/lib/bungie/maintenance.ts:259-261`).

```
HTTP 200 + SystemDisabled body -> BungieAPIError, instanceof BungieAPIError=true, isBungieSystemDisabledError=true
HTTP 503 + SystemDisabled body -> Error, instanceof BungieAPIError=false, isBungieSystemDisabledError=false
```

**Hypothesis:** Bungie sends `SystemDisabled` on HTTP 503 at least some of the time. The repo already knows
1672 arrives as a 503 with a JSON body (`client.ts:19-21`), and `docs/handoffs/261020-scanner-ahead-fix.md:24`
records as "Not proven" what the PGCR endpoint returned during the 2026-10-20 maintenance. The mock used by
`e2e:maintenance` sends it on HTTP 200 (`scripts/mock-bungie-maintenance.ts:236-238`), so the harness can't
settle it.

**If it is true:** the maintenance pause never starts. The scanner retries through the whole window at full
rate with one warn line per request (`scanner/index.ts:514`), the downtime VACUUM never runs, and crawled
players pile up transient failures and up to 6 h of backoff (and R-04 past 10.6 h).

**Confirm or kill:** the three commands under "Maintenance detection" in the follow-up table. The
decisive one is a `curl -i` during the next maintenance window.

**Suggested fix.** Wait for that capture before choosing, since the fix depends on what Bungie sends. If
it is an envelope on a non-200 status: in the non-2xx branch, when the body parses as a Bungie envelope with `ErrorCode !== 1`,
throw `BungieAPIError` (keeping the HTTP status on it). That makes maintenance, not-found and privacy classify
the same on any status and lets the string matching go.

**ADR impact.** None. ADR 0004 is unaffected (still only `fetch` stubbed in tests).

---

## R-08. A poll the watchdog abandons keeps running beside the next one

**Severity:** low. **Effort:** S.

ADR 0005 accepts leaking "the one hung request". What the code abandons is the whole `pollWork` promise
(`src/lib/crawler/index.ts:513-557`): its remaining workers keep pulling players, calling Bungie through the
shared limiter and writing to the database while the next poll does the same. In a storm where requests time
out at 30 s, 200 candidates at concurrency 4 take about 25 minutes, so two or three polls overlap. The
abandoned one can also still delete rows from its own stale re-verify. 74 trips on prod (see R-05) means this
has happened 74 times.

**With prod's values** (`ACTIVE_SESSION_CONCURRENCY=18`, `ACTIVE_SESSION_STALE_REVERIFY_LIMIT=300`,
`CRAWLER_SESSION_POLLING_LIMIT=200`, 30 s fetch timeout, default 10-minute watchdog): if every request
timed out, the 200 candidates alone take about 5.6 minutes, and the stale re-verify before them takes
8 minutes at one probe per session and up to 25 at three. So a full timeout storm trips the watchdog on
every poll and stacks them. Prod also sets `MAX_ACTIVE_SESSION_AGE_SECONDS=32760`, so the force-delete
that ADR 0005 calls the backstop is 9.1 hours away, not 2. The page's own 900 s freshness window still
hides such rows, so this is table size and re-verify load, not wrong output.

**Suggested fix.** A per-poll `abandoned` flag set by the watchdog and checked at the top of each processor in
`pollActiveSessions` and `refreshStaleSessionsWithOptions`, the way `shouldStop` is in `crawlCycle`.

**ADR impact.** Hardens ADR 0005 Option A without touching `request()`. One sentence in the ADR.

---

## R-09. A missing transitory component counts as "cleanly offline"

**Severity:** low. **Effort:** S. **Trigger is a hypothesis.**

`parseAndStoreActivity` returns `'inactive'` whenever `profileTransitoryData.data` is absent
(`src/lib/crawler/active-sessions.ts:166-169`). `'inactive'` is the clean signal that lets the stale re-verify
delete a session (`:378-382`) and puts the player on offline backoff (`:583-586`). The type has `privacy` but
no `disabled` flag (`src/lib/bungie/types.ts:23-26`; `grep -n "disabled" src/lib/bungie/types.ts` is empty).

**Hypothesis:** Bungie can return a successful profile with component 1000 switched off (the API's component
wrapper carries a `disabled` flag). Every player would then read as offline, every stale fireteam would be
deleted after its teammate probes agreed, and every candidate benched for up to 16 minutes. Confirm against
Bungie's API documentation for `SingleComponentResponse`, or a captured profile from an incident.

**Suggested fix.** Return `'error'` when the component is present but disabled, and `'privacyRestricted'` when
`privacy` says withheld, leaving `'inactive'` for a component that is simply empty.

**ADR impact.** Hardens ADR 0005 guard 4.

---

## R-10. `ecosystem.config.js`: no restart backoff, no kill timeout for the workers, no log timestamps

**Severity:** low. **Effort:** S.

```
$ grep -n "kill_timeout\|max_restarts\|min_uptime\|restart_delay\|exp_backoff\|max_memory\|log_date_format\|time:" ecosystem.config.js
25:            kill_timeout: 5000,          (the web app only)
```

- **Restart backoff.** PM2's `restart_delay` defaults to 0 and an app is errored after 16 restarts that each
  lived under 1 s (PM2 docs, "Ecosystem File"). Any startup failure (R-01, a missing key, an empty players
  table at `start-crawler.ts:34-39`) burns through that in seconds and the app stays down.
  `exp_backoff_restart_delay: 1000` fixes it.
- **Kill timeout.** The crawler waits 2 s and the scanner 3 s before `closeDb()` and exit
  (`scripts/start-crawler.ts:52-56`, `scripts/start-scanner.ts:37-41`). PM2's default SIGKILL delay is 1.6 s
  (from PM2's documentation as I remember it; the page I fetched gives 1600 only as its example value), so the
  graceful path never finishes. SQLite's WAL makes that harmless for data. It matters for R-01. Set
  `kill_timeout: 5000` on both.
- **Timestamps.** Most scanner and session log lines carry no time. `time: true` is one line and is what makes
  "when did it stop" answerable at 3am.

**Prod, 2026-11-13.** `pm2-logrotate` 3.0.0 is installed and the logs total 31 MB, so log growth is not a
disk risk. The cost is the other way: the retained history is short, which is why several checks in this
audit could only speak for the last few days. Raising `pm2-logrotate`'s `retain` is free with 76 GB of disk.
`pm2 describe` does not print the kill timeout, so that default is still unconfirmed.

**ADR impact.** None.

---

## R-11. Scanner liveness: `scannerRunning` goes false while it scans, and stays true when it halts

**Severity:** low. **Effort:** S.

- The web derives `isRunning` from `scanner_stats` being under 60 s old (`src/lib/system-stats.ts:64-67`). The
  scanner writes it on a catch-up pause (`scanner/index.ts:915`) or when `totalScanned % (batchSize * 5) === 0`
  (`:898`). `totalScanned` stops being a multiple of the batch size after the first batch with a retryable
  error, and never realigns:

  ```
  periodic stats writes in 100000 batches after one 49-id batch: 0
  ```

  So a scanner that is behind and scanning flat out (no pauses) reads as not running. Prod runs
  `SCANNER_BATCH_SIZE=100`, so the modulus there is 500; the argument is the same.
- The all-keys-disabled path persists `isRunning: true` as its last word (R-03 output above).

**Suggested fix.** Write stats on a time interval, and after `state.isRunning = false` at `:862`.

**ADR impact.** None.

---

## R-12. Crawl-queue rows are deleted for players a cycle skipped

**Severity:** low. **Effort:** S.

`crawlCycle` drains up to 100 queue rows (`src/lib/crawler/index.ts:209`). When maintenance is detected or a
stop is requested, the remaining tasks return `skipped` (`:324-326`), and then every drained row is deleted
anyway (`:379-381`), before the maintenance throw (`:389-391`). Session-end crawls and visitor-requested
crawls queued just before a maintenance window are dropped without a log line. The bucket crawl reaches those
players eventually, so the loss is delay, not data.

**Suggested fix.** Delete only the rows whose task ran.

**ADR impact.** None.

---

## R-13. Prod's 50 s poll interval uses up most of ADR 0001's row-scan headroom

**Severity:** low. **Effort:** S. Added 2026-11-13 from prod's env values.

ADR 0001 sizes the raw-row bound at "roughly 2x headroom" over what the poller can produce:
`CRAWLER_SESSION_POLLING_LIMIT` rows per cycle across the 900 s freshness window, which is 1,500 rows
at the default 120 s interval against a bound of 3,000. It adds that raising the polling limit "should
prompt a review of this bound".

Prod kept the limit at 200 but runs `CRAWLER_ACTIVE_SESSION_INTERVAL_MS=50000`:

```
900 s / 50 s = 18 cycles x 200 players = 3,600 rows at most, against ACTIVE_SESSION_ROW_SCAN_LIMIT=4000
headroom 1.11x, where the ADR assumes about 2x
```

3,600 is a ceiling, not a measurement: it needs 18 cycles of entirely different players, all in an
activity. Players found online are polled again every cycle, so the real figure is far lower (the
2026-07-26 notes had about 1,000 live rows). If the bound were hit, the scan sheds the stalest rows
first, as the ADR designed. So nothing is wrong today; the margin the ADR describes is just no longer
there, and the interval is a second knob that erodes it without the ADR naming it.

**Suggested fix.** Measure the real row count (follow-up table). If it is well under 4,000, add the
interval to the ADR's sentence about what should prompt a review.

**ADR impact.** ADR 0001 is not contradicted. I'd amend its last consequence to name the poll interval
alongside the polling limit.

---

## R-14. Four env knobs set on prod are read by nothing

**Severity:** low. **Effort:** S. Added 2026-11-13 from prod's env values.

```
CRAWLER_SESSION_POLLING_CANDIDATE_LIMIT:      (no file in src/, scripts/ or middleware.ts)
APP_ORIGIN:                                   (none)
BUNGIE_REDIRECT_URI:                          (none)
CRAWLER_HOURS_BACK: scripts/start-crawler.ts  (read into `hoursBack`, which CrawlerConfig doesn't have)
```

`CRAWLER_HOURS_BACK=720` is parsed at `scripts/start-crawler.ts:13` and passed to `startCrawler`, but
`CrawlerConfig` (`src/lib/crawler/index.ts:75-104`) has no such field and nothing reads it; the live knob
is `CRAWLER_BACKFILL_MAX_HOURS`, which prod also sets to 720. `CRAWLER_SESSION_POLLING_CANDIDATE_LIMIT=300`
is the one to care about: it looks like it widens the session poll and does nothing.

**Why it matters here.** A knob that reads as set but isn't wired is how a tuning session ends with the
wrong conclusion. Same family as #207's two defaults.

**Suggested fix.** Delete the four lines from prod's env and the dead `hoursBack` line.

**ADR impact.** None.

---

## Known issues (status)

| Issue | Status | Notes |
| --- | --- | --- |
| #174 discovery's position jump | **Confirmed, somewhat broader.** | `scripts/discover.ts:211-213` writes the position before back-filling. The back-fill also stops after 100 consecutive misses (`:58`, `:242`), not only at 5,000 ids, and it starts at the Leading Edge where in-progress ids are densest. How often that ends it early is unmeasured: the script prints its stop reason. The prod backup holds 159 `discover backscan` PGCRs in 30 days, so the jump has run recently. `probeExists` reads any error as "does not exist" (`:178-190`), which only ever lands the jump lower, so that part is safe. |
| #178 retry pass may fire rarely | **Can't assess from here.** | Needs the prod grep in the issue. R-02's fix would add ids to the same queue, so answer #178 first or together. |
| #235 restart forgets Missed Ids | **Confirmed, and more paths lead to it.** | `missedIdsSet` is module state (`scanner/index.ts:40`). R-03 (a restart after all keys are disabled) and R-05's suggested watchdog both end in a restart, which raises the value of at least logging the queue size at shutdown. |
| #236 `totalRaidsFound` undercounts | **Confirmed as filed.** | `scanner/index.ts:401-403` and `:925`. Reporting only. |
| #207 cleanup max-age default | **Confirmed, worse than filed.** | The 720 in `crawler/index.ts:135` is dead on the PM2 path: `start-crawler.ts:18` always passes a value and `{ ...DEFAULT_CONFIG, ...overrides }` (`index.ts:404`) lets it win. So the effective default is 48 h, the first cleanup runs 5 minutes after start (`index.ts:643`), and the deletion can't be re-crawled: the scanner only moves forward. The parse is also loose: `"30d"` reads as 30 hours, `"0"` deletes everything, and a non-number makes the cutoff `NaN`, which matches no rows, so cleanup silently stops (checked: `rows matched by period < NaN: 0`). **Prod, 2026-11-13:** the box sets `CRAWLER_CLEANUP_MAX_AGE_HOURS=728`, so the 48 h default is not in effect there today. The trap is for any start where that line is missing. **Sibling of the same kind:** `start-scanner.ts:9-11` defaults batch size 50 and catch-up pause 10000 against 75 and 20000 in `scanner/index.ts:95-96`. Harmless today, same trap. |
| #177 e2e:maintenance and PGCR requests | **Confirmed.** | `test-maintenance-cycle.ts:148` sets only `BUNGIE_BASE_URL`; `endpoints.ts:2` reads `BUNGIE_PGCR_BASE_URL`. The issue's open question is answered: the mock does serve the PGCR path (`mock-bungie-maintenance.ts:241`). With R-03, a `mock-key` request to real Bungie that gets a 401/403 disables the only key and ends the scanner. Also see R-07: the mock's `SystemDisabled` is HTTP 200 only. |
| #154 active-sessions fetch race | **Confirmed, unchanged.** | `src/app/active-sessions/page.tsx:152-195`: one unguarded callback behind a 30 s `setInterval` and the Refresh button; no `AbortController` or request id. Client-side, outside this lens. |

No other open issue overlaps these findings (`gh issue list --state open`, 100 issues read by title).

## Checked, no issue

- **ADR 0005's four guards are intact.** Watchdog race `crawler/index.ts:550-557`; reschedule in `finally`
  `:576-584` with the maintenance wait inside the `try` `:502`; heartbeat only on completion `:560`; `'error'`
  kept distinct from `'inactive'` at `active-sessions.ts:131-134`, `:345`, `:367-375`, `:579`. A DB error while
  storing a session also lands on `'error'`, the safe side.
- **ADR 0001.** Not touched by anything here. The force-delete backstop (`active-sessions.ts:406`) sits after
  an early return (`:319`), but any new stale row reaches it within minutes and the display has its own 900 s window.
- **Rate limiter.** Grants are FIFO through one promise chain and re-read `nextSlot` after a pause
  (`utils/rate-limiter.ts:13-28`); a rejected grant can't break the chain. 1672 pauses the key for 2 s and the
  scanner queues the id (`'error_retryable'`).
- **Long write locks.** None in steady state: cleanup deletes 500 PGCRs per transaction with a yield
  (`queries.ts:2100-2130`, `crawler/index.ts:604-618`), and each PGCR insert is its own transaction. The VACUUM
  is behind the quiesce gate. `backup-db.ts`'s `VACUUM INTO` is a reader; it holds the WAL open while it runs
  but blocks no writer.
- **Crash mid-batch.** `insertFullPGCR` is `INSERT OR IGNORE` in one transaction (`queries.ts:1392-1467`), and
  the scanner saves its position every batch, so a restart re-scans at most one batch and re-inserts nothing.
- **Scanner Position rules.** Forward-only on the scanner's side (`scanner/index.ts:315`); a batch cut short by
  `SystemDisabled` doesn't move it (`:844-854`); any error resets the Id Hole count (`:842`). As decided in #176 and #234.
- **Unbounded memory.** The only growing module-level collection in the crawler, scanner, Bungie client and
  query module is `missedIdsSet`, capped at 20,000 (`scanner/index.ts:41`, `:53`). The crawl queue and per-cycle
  buffers are bounded.
- **Cleanup loop.** Catches everything and always reschedules (`crawler/index.ts:596-631`).
- **`/api/discovery`.** Token-gated and limited to 3 per 15 minutes in `middleware.ts:82-104`, `:216-217`. It
  uses the crawler's key through a second limiter in the web process, which only matters while someone runs it.
- **`session_snapshots`** is never pruned (no `DELETE` anywhere), but at one small row per poll it is about
  260,000 rows a year. Not worth a change yet; ADR 0009 keeps them on purpose.

## Couldn't verify, and what I'd need

Revised 2026-11-13. Answered and removed: free disk, a disabled scanner key, the dropped-id count, crawl
cycle time, log rotation, and prod's cleanup max-age. All commands below are read-only and run on the box
from `~/destiny-farm-finder`. `zgrep` reads rotated files whether or not they are compressed.

### Maintenance detection (R-07, and whether R-01 is armed)

| Question | Command |
| --- | --- |
| How far back do the logs reach, and do they cover Tuesday 2026-11-10? Every "nothing found" above depends on this. | `ls -la ~/.pm2/logs/` then `zgrep -h "Starting crawl cycle at" ~/.pm2/logs/crawler-out* \| sort \| head -1` |
| Was maintenance ever *detected*, as opposed to cleaned up after? Null in the first two fields means never detected. | `grep -E "maintenanceEventStartedAt\|bungieMaintenanceUntil\|cleanupStatus\|lastCleanupAttemptedEventId" data/maintenance-state.json` |
| What errors did Bungie send the crawler, by status and first words of the body? The earlier `SystemDisabled` grep read only the current file. | `zgrep -h "Bungie API error" ~/.pm2/logs/crawler-error* \| grep -o "Bungie API error [0-9]*: .\{0,80\}" \| sort \| uniq -c \| sort -rn \| head -20` |
| How many 5xx did the scanner retry through? A large count clustered in one file is a maintenance window it scanned straight through. | `zgrep -c "Bungie API server error" ~/.pm2/logs/scanner-error*` |
| **The decisive one:** what does Bungie send during maintenance, status line and body? Run during the next window, with a scanner key in `$KEY`. | `curl -si -H "X-API-Key: $KEY" "https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/17266771287/" \| head -30` and the same against `https://www.bungie.net/Platform/Destiny2/Manifest/` |
| Is the live database mostly free pages, having never been vacuumed? | `ls -la data/raid-tracker.db*` then `node -e "const D=require('better-sqlite3');const d=new D('data/raid-tracker.db',{readonly:true});console.log(d.pragma('page_count'),d.pragma('freelist_count'),d.pragma('page_size'))"` |
| How long will the first VACUUM block its owner (the R-01 window)? It has never run, so use the backup as a proxy. | Time the next `npx tsx scripts/backup-db.ts` with `time`. |

### Scanner and PM2 (R-03, R-05, R-10, #235)

| Question | Command |
| --- | --- |
| Why 20 restarts on an entry created 2026-11-06? Deploys restart both workers, so compare the crawler. | `pm2 describe crawler \| grep -E "restarts\|uptime\|created at"` |
| How many scanner starts are in the logs, and did any follow the all-keys-disabled line? | `zgrep -c "Starting PGCR scanner" ~/.pm2/logs/scanner-out*` then `zgrep -h "All scanner API keys" ~/.pm2/logs/scanner-*` |
| How many scanner keys does prod run? Decides which R-03 outcome applies. | `zgrep -h "API keys:" ~/.pm2/logs/scanner-out* \| tail -1` |
| PM2's SIGKILL delay. `pm2 describe` doesn't print it and the docs give 1600 only as an example. | `grep -n "KILL_TIMEOUT" "$(npm root -g)/pm2/constants.js"` |
| Does the scanner process really exit under PM2 when its loop ends, and get restarted? | Not safely testable on prod. Answered if the second row above finds the line followed by a start. |
| Is the Missed Id queue staying bounded (#178's own check)? | `pm2 logs scanner --lines 20000 --nostream \| grep -E "Missed queue\|dropped" \| tail -40` |

### Session loop (R-05, R-08, R-13)

| Question | Command |
| --- | --- |
| Were the watchdog trips true hangs or slow polls? The earlier command tailed live output, and the warning and the progress lines are in different files. A count stuck at one value before the hit is a hang. | `zgrep -h -B8 "Poll took 6[0-9][0-9]\." ~/.pm2/logs/crawler-out* \| tail -80` |
| Is it still tripping? Compare with 74 on 2026-11-04. | `node -e "const D=require('better-sqlite3');const d=new D('data/raid-tracker.db',{readonly:true});console.log(d.prepare(\"select value, datetime(updated_at,'unixepoch') at from crawler_state where key='session_watchdog_trips'\").get())"` |
| How many `active_sessions` rows are fresh at once, against the 4,000 bound? | `node -e "const D=require('better-sqlite3');const d=new D('data/raid-tracker.db',{readonly:true});console.log(d.prepare('select count(*) fresh from active_sessions where checked_at > unixepoch()-900').get(), d.prepare('select count(*) total from active_sessions').get())"` |

### Not answerable from the box

| Question | What would answer it |
| --- | --- |
| Does Bungie mark a switched-off component with `disabled` (R-09)? | Bungie's API docs for the component response wrapper, or a profile captured during an incident. |
| How does a request escape `AbortSignal.timeout` at all? | Not reproduced. ADR 0005 records that it happens; Option B there would make the cause moot. |
| Does the mock-Bungie harness pass end to end? | Fix #177 first, then `npm run e2e:maintenance`. I did not run it. |
