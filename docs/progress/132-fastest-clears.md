# #132 — Leaderboard: Fastest Clears tab ranked by Clear Time

Branch `feat/time-leaderboard`. Spec: `gh issue view 132`, parent `gh issue view 130`
(its Implementation Decisions, Testing Decisions and Out of Scope are authoritative).
Briefing from the peer session `orchestrate-time-leaderboard`.

Seams agreed with the user before any test:
1. the database seam — the new fastest-clear runner, in `tests/db/`, seeded with `seedRun`;
2. the browser seam — one new e2e spec, with the seeded world extended by runs of differing
   Clear Times.

No route tests and no cache-entry tests.

Settled: no minimum duration and no plausibility filter; a 2-minute run ranks like any other.
Out of this ticket: the raid.report link and date tooltip (#133), rank arrows / NEW / change
highlight on Fastest Clears (#134), anything from #131.

## Chunks

1. Server — runner, cache, route, DB tests
   - [x] `src/lib/cache/leaderboard-cache.ts` — `runFastestClearRows`, the `fastest` board's cache paths
   - [x] `tests/db/fastest-clears.test.ts` (new)
   - [x] `src/app/api/leaderboard/route.ts` — `board` parameter; maintenance body for `fastest`
2. UI — tabs, table, copy, maintenance message, e2e
   - [x] `src/app/leaderboard/leaderboard-board.ts` (new) — the URL's spelling of the tab
   - [x] `src/app/leaderboard/LeaderboardTabs.tsx` (new) — the tab strip
   - [x] `src/app/leaderboard/page.tsx` — tab-aware fetch, heading, View toggle, maintenance message
   - [x] `src/components/LeaderboardTable.tsx` — Clears or Clear Time column, per-tab empty state
   - [x] `e2e/support/seed-world.ts` — runs of differing Clear Times
   - [x] `e2e/leaderboard-fastest.spec.ts` (new)
3. Bookkeeping
   - [x] `docs/progress/132-fastest-clears.md` (this file)
   - [x] `docs/handoffs/260803-playwright-e2e.md` — covered-flows list (gitignored: edited locally, not committed)

## Notes

- The DB tests were written one slice at a time, but the runner's SQL was complete after the
  first slice, so most later tests were green on first run. Each was then mutation-checked against
  the runner: dropping `pp.completed`, dropping the checkpoint conjunct, a window that keeps the
  slowest run, no end-time tie-break, no Players filter, dense ranking, a 300 s floor, and no raid
  filter each fail at least one test.
- The maintenance snapshot holds a Full Clears board only, so `board=fastest` during maintenance
  returns an empty `leaderboards` with `maintenance: true` (no snapshot read, so it never 500s for
  a missing snapshot).
- `/leaderboard` is now rendered on demand (ƒ in the build output): the client page reads the
  tab from `searchParams` via `use()`. That's the cost of reading the URL without `useSearchParams`
  and its Suspense boundary, which would blank the server-rendered shell.
- The e2e spec was mutation-checked too; see the 2026-10-03 section of
  `docs/handoffs/260803-playwright-e2e.md`.
- Against the dev Tracker (`npm run dev`), `board=fastest&mode=aggregate` returned 13 per-raid
  boards. A Salvation's Edge fireteam shared rank 1, and 2-minute Desert Perpetual / Last Wish clears
  topped their boards, as decided. Cold misses over 700 h: Fastest Clears all raids 1.3 s, Full Clears
  per raid 7.1 s, Fastest Clears single raid 0.18 s. The OS page cache was warm, and the very first
  request (15 s) included dev-mode route compilation.

## Review fixes (2026-10-03)

From the two-axis review of `cec5487...HEAD`. Four fixes; the rest of the review is left for the
user to decide on.

- [x] `src/lib/db/queries.ts` — export `CLEAR_TIME` (`p.ended_at - p.period`); `CLEARED_DURATION`
  is built from it, and its SQL text hasn't changed
- [x] `src/lib/cache/leaderboard-cache.ts` — `runFastestClearRows` uses `CLEAR_TIME`; `fastestBody`
  is exported
- [x] `src/app/api/leaderboard/route.ts` — `board` goes through `parseLeaderboardBoard`, and the
  Fastest maintenance body comes from `fastestBody` (same shape and key order)
- [x] `src/app/leaderboard/page.tsx` — the maintenance banner reads `shown`, not `data`. On
  Fastest Clears it drops the "last known leaderboard snapshot" sentence, because there is no
  Fastest Clears snapshot. That wording change was approved later; the Full Clears banner is
  unchanged.

No new test. Fixes 1 and 2 are refactors. The banner is visible only while the database is in
maintenance, and the e2e world has no maintenance state, so it was checked by hand instead. I ran
`npm run dev` with `RAID_TRACKER_DATA_DIR` set to a scratch dir: there, `dbQuiesceActive` was
true and a Full Clears snapshot was present, and the real `data/maintenance-state.json` was never
touched. Then I drove Chromium through it:
- `/api/leaderboard?board=fastest` returned
  `{"board":"fastest","mode":"individual","hours":4,"raidKeys":[…],"leaderboards":{},"maintenance":true}`,
  the same shape and key order as before. `board=nope` returned the Full Clears snapshot.
- On Fastest Clears, by direct load and after a tab click, the banner read "Database maintenance
  is in progress. Filters are temporarily frozen until maintenance completes." The body showed
  "Fastest Clears are unavailable during maintenance".
- On Full Clears, by direct load and after a tab click, the banner read "…Showing the last known
  leaderboard snapshot from <date>. Filters are…", which is unchanged.
- I did not catch the old other-tab flash on screen, so the `shown` gating itself is only
  confirmed by reading the code.

Results after the fixes, at the commit that adds this section:

- `npx vitest run` on fastest-clears, leaderboard, player-stats, full-clear-predicates and
  raid-stats: 5 files, 90 tests passed
- `npm run lint`: exit 0, 0 errors and 29 warnings, all `no-explicit-any` in `gos10k/`
  (none in a file changed here)
- `npm run build`: exit 0; `/leaderboard` is ƒ, as before
- `npm test`: 45 files, 538 tests passed
- `npm run e2e`: 94 passed (51.1 s), including the 5 in `leaderboard-fastest.spec.ts`

## #133 — Clear Time links to the run on raid.report, with a date tooltip (2026-10-04)

Spec: `gh issue view 133`, parent #130. Same branch and the same two seams:
`tests/db/fastest-clears.test.ts` and `e2e/leaderboard-fastest.spec.ts`. No route or cache-entry
tests. Out of this ticket: #134's rank arrows / NEW / flash, #131, #135–#138.

The server side already shipped in #132: `runFastestClearRows` returns `instanceId` and `endedAt`,
and its window orders a player's runs `CLEAR_TIME, ended_at, instance_id`. The only server addition
is a test.

- [x] `tests/db/fastest-clears.test.ts` — a player's two equal-fastest runs link the earlier one
- [x] `src/components/LeaderboardTable.tsx` — the Clear Time is a link to
  `https://raid.report/pgcr/<instanceId>` (`target="_blank" rel="noopener noreferrer"`, the player
  profile's raid.report attributes), with a `role="tooltip"` showing the run's end in the
  viewer's zone and locale. The tooltip is shown on hover (`peer-hover`) and on keyboard focus
  (`peer-focus-visible`), and wired with `aria-describedby`. No new column.
- [x] `e2e/leaderboard-fastest.spec.ts` — new test for the link target, `target`/`rel`, the
  accessible description, and the tooltip on hover, gone on mouse-out, and shown on Tab focus.
  `expectBoardRows` now reads the player from the row's first link and the time from the last
  cell's link.
- [x] `docs/progress/132-fastest-clears.md` (this file)
- [x] `docs/handoffs/260803-playwright-e2e.md` — gitignored, edited locally, not committed

### Notes

- **raid.report's URL** was confirmed from raid.report's own route table. Its SPA answers 200 for any
  path, so a 200 proves nothing. Its main bundle (`/static/js/main.f7ffd749.chunk.js`) registers
  `path:"/pgcr/:activityId"`.
- **Date in the e2e test.** The spec pins `timezoneId: 'Asia/Kathmandu'` (UTC+5:45, no DST) and
  `locale: 'en-GB'`. It reads Echo's `endedAt` from the page's own `board=fastest` response and works
  out the local day, year and HH:MM by hand, not with the page's formatter. Every part comes from
  that one timestamp, so the test can't flake near midnight. It ran green while it was already the
  next day in Kathmandu. The month spelling is left to locale data: ICU's en-GB "Sept" varies by
  version.
- **The link target is asserted against a literal**, `900011`: Echo's second, fastest run in
  seed-world's numbering. Her first run is slower, so a link to the first run can't pass.
- **The tooltip sits above the cell.** The table's wrapper is `overflow-hidden`, so a tooltip below
  the last row would be clipped. Above the first row is the header, which is tall enough to hold it.
  Checked in screenshots at 1280 and 360 px wide.
- **Mutation checks.** DB: flipping the window's `p.ended_at ASC` to `DESC` fails only the new
  test. e2e, each rebuilt: formatting the date in UTC fails the description assertion (expected
  `5 … 2026 … 01:59`, received `4 Oct 2026, 20:14`). Dropping `peer-focus-visible:block` fails the
  Tab-focus assertion.

Results:

- `npx vitest run tests/db/fastest-clears.test.ts`: 19 passed
- `npm run lint`: exit 0, 0 errors and 29 warnings, all `no-explicit-any` in `gos10k/`
  (none in a file changed here)
- `npm run build`: exit 0; `/leaderboard` is ƒ, as before
- `npm test`: 45 files, 539 tests passed
- `npm run e2e`: 95 passed (50.7 s), including the 6 in `leaderboard-fastest.spec.ts`

## #133 review fixes (2026-10-04)

From the two-axis review of `c1d56f9..b95ba14`.

- [x] `src/lib/utils/helpers.ts` — `formatTimestamp` restored as it was before b95ba14; no diff
  against c1d56f9.
- [x] `src/components/LeaderboardTable.tsx` — the shared, lazily built date formatter and its
  client-only rule now sit beside `ClearTimeLink` as `formatRunEnd`, its only caller. The link
  carries hidden text, " on raid.report, opens in a new tab", rather than an `aria-label`, so its
  name keeps the time. `relative` goes on the right-hand cell only for a Clear Time, so the Full
  Clears cell's markup matches c1d56f9.
- [x] `e2e/leaderboard-fastest.spec.ts` — the link's accessible name is asserted whole, both the
  time and the raid.report hint. `expectBoardRows` reads each time from that name, because the
  link's text now ends with the hidden hint; it still checks the full time exactly. The header also
  lists what the #133 tests cover.
- [x] `docs/progress/132-fastest-clears.md` (this file)

The assertion went in first. Against the unchanged component, 3 of the spec's 6 tests failed:
`Expected: "25:00 on raid.report, opens in a new tab"`, `Received: "25:00"`. With the fix, all 6
passed.

Results, on the final tree:

- `npx tsc --noEmit`: exit 0
- `npm run lint`: exit 0, 0 errors and 29 warnings, all `no-explicit-any` in `gos10k/`
- `npm run build`: exit 0; `/leaderboard` is ƒ, as before
- `npm test`: 45 files, 539 tests passed
- `npm run e2e`: 95 passed (45.7 s), including the 6 in `leaderboard-fastest.spec.ts`

## #134 — Fastest Clears: live rank movement measured on Clear Time (2026-10-04)

Spec: `gh issue view 134` (and its carry-over comment), parent #130. Same branch. Verified by hand,
as the user decided; there is no automated test for live movement on either tab.

- [x] `src/app/leaderboard/page.tsx`
  - `annotateMovement` takes the scopes and a `metricOf` for the active board, and runs on both
    tabs. A row's change is measured on `completions` on Full Clears and `clearTimeSeconds` on
    Fastest Clears, so a faster personal best flashes even when the rank holds. `prevRowsRef`
    stores `metric` in place of `completions`.
  - The movement fields moved into a `RowMovement` interface, and Fastest Clears rows carry them too.
  - The baseline is dropped by an effect on `board`, which closes the carry-over race: the reset
    happens on the switch itself, not when the other tab's response lands. Board in `comboKey`
    alone would not have fixed it: on a quick switch back the key matches again, and the old
    baseline is still there.
- [x] `src/components/LeaderboardTable.tsx` (4be8ae3): `RowMovement` is declared here once and
  the page imports it; the table's own entry type extends it. Types only.
- [x] `docs/progress/132-fastest-clears.md` (this file)

### The simplify commit (4be8ae3)

Besides moving types, it makes `comboKey` the request itself, `params.toString()`, in place of the
hand-built `${hours}|${mode}|${leaderboardSize}|${raids}|${playersFilter}`. The hand check below
ran on 6f9559a, before this commit, and still covers HEAD:
- **Full Clears:** the key resets exactly when the old one did. `params` is built in a fixed order
  (hours, `fullClearsOnly=true`, mode, limit, then `raids` only when any are selected, then
  `maxPlayers=3` for lowman or `exactPlayers=N`). Each filter value maps to a distinct string,
  and the key holds no timestamp or cache-buster.
- **Fastest Clears:** the key drops `mode` (never sent) and gains `board`. It can only reset more
  often than before, never less. In 6f9559a the tabs shared the hand-built key, so the hand check
  exercised the tab separation through the `[board]` effect alone.
- Everything else in the commit is types: `RowMovement`, `PrevRow`, `perRaidScopes` and
  `IndividualLeaderboard<E>`. In-place annotation and `setData(result)` after both branches were
  already in 6f9559a.

### TDD

No agreed seam qualified. The runners aren't touched, so nothing changes at `tests/db/`. The first
render on either tab has no arrows, NEW or flash, so nothing static changes for
`e2e/leaderboard-fastest.spec.ts`. No test was added.

### Optional cleanups: all skipped

Each would have made the diff bigger, not simpler:
- **Shared competition-rank loop / `board()` raid-name lookup** (`leaderboard-cache.ts`). #134 doesn't
  touch the server. A shared helper is net-neutral in lines and would put a server refactor into a
  client-only ticket.
- **One description per board on `LEADERBOARD_BOARDS`.** The movement metric didn't add an
  `isFastest` branch: it's chosen where the page already branches on the response kind. A descriptor
  holding a JSX value renderer can't sit in `leaderboard-board.ts`, because the route imports it, so
  it would need a new client module and a rewrite of every branch in the page and the table.
- **Optional entry fields / `ClearTimeLink`'s whole-entry prop / the `endedAt === undefined` guard.**
  #134 changes `LeaderboardTable.tsx` only to host `RowMovement` (4be8ae3, types only). Tying
  entries to `metric` means a discriminated props union, which is a table refactor in its own right.
- **Names (`fastestFirst`, `board()`, `shown`).** None of those lines changes here.

### Hand verification

Against a **scratch copy** of the dev Tracker, made with
`sqlite3 "file:data/raid-tracker.db?mode=ro" "VACUUM INTO '<scratchpad>/tracker-134.db'"`. The real
`data/raid-tracker.db` was never written. `npm run dev` ran with `RAID_TRACKER_DB_PATH` pointing at
the copy; the dev log confirmed the path. Chromium was driven by a scratch Playwright script with
Last Wish and King's Fall selected, so every refresh bypasses the server's SWR cache, plus 30 days,
12 rows and All players. The script inserted Completions with instance ids `99134…` and deleted them
afterwards. It ran once on this change, then once on `f92d02d`'s page for comparison.

| Step | This change | `f92d02d` |
|---|---|---|
| Fastest, LW #3 Plushie gets 2:37 (was 2:55), still #3 | #3 flashes, no arrow; no other row flashes | nothing |
| Fastest, Kuri 3:41→2:10, Avy (not on board) 1:40 | Avy #1 NEW; Kuri ▲4; the rest ▼1/▼2; all 12 flash (every rank moved) | nothing |
| Switch to Full Clears, then back to Fastest | no arrows, NEW or flash on either; Fastest's rows differ from its earlier baseline | — |
| Full Clears baseline; 27 runs move SixMuffin #12→#11; quick switch to Fastest and back with the Fastest response held 6 s (it never reached the page) | **no arrows**: a fresh baseline | **▲1 SixMuffin / ▼1 Ava**: the stale baseline survived (race reproduced) |
| Full Clears, +1 for #1, Ava passes SixMuffin | count/rank changes flash, ▼1 L (fell out of a tie at #1), Ava ▲1 / SixMuffin ▼1 against the fresh baseline | same flash rule; Ava/SixMuffin show no arrow, because they are back at their stale-baseline ranks |

The Full Clears flash rule (rank or count changed) and the arrows (against the baseline) behave
the same in both runs. The rows differ only because of the race fix and because the 30-day window
slid forward between runs, so a few players lost a run off its tail.

**Found while verifying, not fixed (pre-existing, outside #134):** each 60 s refresh shows the
*previous* tick's data in Chromium. `/api/leaderboard` sends
`cache-control: public, max-age=0, s-maxage=…, stale-while-revalidate=…`, and the browser's own
HTTP cache honours `stale-while-revalidate`. The refresh is answered from the cache, and the fresh
response is fetched in the background for the next tick. In both runs, every insert showed up one
refresh late; the script logged the response `Date` the page received. In prod, Cloudflare rewrites
these headers (CLAUDE.md), so whether prod lags too is unverified.

Results at 6f9559a. The suite was green on the tree as hand-verified, and again after the "Tab or
filters changed" comment. These results predate 4be8ae3. The section below re-runs them on the
tree after the review fixes.

- `npx tsc --noEmit`: exit 0
- `npm run lint`: exit 0, 0 errors and 29 warnings, all `no-explicit-any` in
  `gos10k/bungie-fetch.ts` and `gos10k/gos_10k_pgcr.smoke.ts`
- `npm run build`: exit 0; `/leaderboard` and `/api/leaderboard` are ƒ, as before
- `npm test`: 45 files, 539 tests passed
- `npm run e2e`: 95 passed (48.7 s), including the 6 in `leaderboard-fastest.spec.ts`

## #134 review fixes (2026-10-04)

Three fixes from the two-axis review of `f92d02d..4be8ae3`. Nothing else changed.

- [x] `src/app/leaderboard/page.tsx`
  - A Fastest Clears maintenance body (`leaderboards: {}`) no longer goes through
    `annotateMovement`. Annotating it emptied `prevRowsRef` under an unchanged `comboKey`, so on
    recovery every row flashed. If the page was opened during maintenance, every row also wore NEW.
    The baseline and previous rows now stay as they were before maintenance, and `setData` still
    runs, so the "unavailable during maintenance" message renders as before. Full Clears'
    maintenance path (a snapshot with rows) is unchanged.
  - Rename, no behaviour change: the row's number is `value` (`PrevRow.value`, `valueOfRow`), so
    `metric` keeps one meaning, the column (`LeaderboardMetric`).
- [x] `src/components/LeaderboardTable.tsx`: the `changeStamp` doc says "board value", for the
  same rename.
- [x] `docs/progress/132-fastest-clears.md` (this file): `LeaderboardTable.tsx` is in the #134
  checklist, and the 4be8ae3 key change and the stale results line are corrected above.

No test, as for #134: live movement has no automated seam, and none was added for this.

### Maintenance hand check

The run used `npx next dev -p 3134`, with `RAID_TRACKER_DB_PATH` and `RAID_TRACKER_DATA_DIR`
pointing at a scratch dir. That dir held a `VACUUM INTO` copy of the dev Tracker (opened `mode=ro`)
and its own `maintenance-state.json`. The dev log confirmed the scratch path. The real
`data/maintenance-state.json` and `data/raid-tracker.db` were never written; their mtimes are
unchanged.
- A scratch Playwright script loaded `/leaderboard?board=fastest`, with Last Wish and King's Fall
  selected (which bypasses the SWR cache), 30 days, 12 rows and All players: 24 rows.
- It toggled `dbQuiesceActive` in the scratch state file and waited out the 60 s refreshes.
- For comparison, the guard was disabled temporarily (`if (true || …)`), which is the old
  behaviour, and then restored.

| Case | Old (no guard) | This fix |
|---|---|---|
| Board loaded → maintenance → recovery | first board after recovery: 24/24 rows flash, 0 NEW, 0 arrows | 0 flash, 0 NEW, 0 arrows; the same on the following refresh |
| Page opened during maintenance → recovery | 24/24 flash, **24/24 NEW** | 0 flash, 0 NEW, 0 arrows |

The #139 lag showed as expected. The first refresh after `dbQuiesceActive` went on still got the
cached pre-maintenance body (the same `Date`), and the maintenance message came one tick later.
On the first try, the script's NEW count was wrong: a `\bNEW\b` text match misses a badge that sits
next to the rank digit. It now counts the badge by its `title`, and the "old" open-during-maintenance
run reporting 24 NEW confirms the count works. The NEW-sensitive cases were re-run with it.

### Results, on the final tree

- `npx tsc --noEmit`: exit 0
- `npm run lint`: exit 0, 0 errors and 29 warnings, all `no-explicit-any` in
  `gos10k/bungie-fetch.ts` and `gos10k/gos_10k_pgcr.smoke.ts`
- `npm run build`: exit 0; `/leaderboard` and `/api/leaderboard` are ƒ, as before
- `npm test`: 45 files, 539 tests passed
- `npm run e2e`: 95 passed (1.2 m), including the 6 in `leaderboard-fastest.spec.ts`
