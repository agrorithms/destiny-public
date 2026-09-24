---
name: verify
description: Build/launch/drive recipe for verifying changes to the Destiny Farm Finder web app and data pipeline locally.
---

# Verifying destiny-farm-finder locally

## Web app / API routes

- `npm run dev` (background), wait for `http://localhost:3000` to respond. `/api/status` returns 503 when the crawler heartbeat is stale — that's a status report, not a server failure.
- A ~3.5 GB dev copy of the Tracker lives at `data/raid-tracker.db`. Read it with the system `sqlite3` CLI in read-only mode: `sqlite3 "file:data/raid-tracker.db?mode=ro" "..."`. The system sqlite3 is old — no `unixepoch()`; use `strftime('%s','now')`.
- `/gos10k` reads the Archive instead: `data/gos-10k.db` (or `GOS10K_ARCHIVE_DB_PATH`), opened read-only, and it must exist and match `src/lib/db/archive/gos-10k-manifest.json`. A missing or mismatched file 500s `/gos10k` on first access and nothing else (ADR 0007); `npm run build-gos10k` rebuilds it from the master under `gos10k/`.
- **Do not read `.env`** (denied by policy). `PAGE_TOKEN_SECRET` is set locally, so client-write POSTs (`active-session-update`, `players/identity`, `queue-crawl`) need both `Origin: http://localhost:3000` and a valid `x-page-token`. Harvest a real token from a served player page (it's in the escaped RSC flight payload):

  ```bash
  TOKEN=$(curl -s http://localhost:3000/player/1/<membershipId> \
    | grep -oE 'pageToken\\":\\"[0-9]+\.[A-Za-z0-9_-]+' | head -1 | sed 's/.*\\"//')
  curl -X POST http://localhost:3000/api/players/queue-crawl \
    -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
    -H "x-page-token: $TOKEN" -d '{...}'
  ```

- Tokens expire after 15 min — re-harvest if 403s reappear.
- Chromium is installed via Playwright. `npm run e2e` builds and serves on port 3100 against a seeded throwaway Tracker and a fixture Archive, each proved by a canary through the running server before any spec runs. `npm run e2e:nobuild` skips the build and is wrong when `.next` is stale.
- The suite covers only the flows listed in CLAUDE.md's Verification section and `docs/handoffs/260803-playwright-e2e.md`; report browser behaviour outside them as unverified.
- New `/gos10k` specs: below `xl` the range forms sit behind "Change range", so click it first; a spec that reaches a panel loads that panel's `?tab=`.
- Test-data writes to the dev DB are fine (data is re-crawlable) but restore what you change (`next_eligible_at`, `checked_at`, `crawl_queue` rows) so scheduling state stays realistic.

## Crawler (one bounded cycle, real Bungie calls)

```bash
CRAWLER_MAX_PLAYERS_PER_CYCLE=0 CRAWLER_INTERVAL_MS=600000 \
  CRAWLER_ACTIVE_SESSION_INTERVAL_MS=600000 timeout 45 npm run crawler > /tmp/crawler.log 2>&1
```

`MAX_PLAYERS_PER_CYCLE=0` zeroes the bucket crawl so the cycle only drains `crawl_queue` (plant rows via SQL first). Watch for `[CRAWLER] Draining N players from crawl_queue` in the log. Each drained player triggers real Bungie API calls with the dev key — keep the queue tiny.
