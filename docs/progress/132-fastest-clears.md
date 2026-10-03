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
