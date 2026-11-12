# #200 — Raid Activity: Raid Stats tab (Clear Time Quartiles, KDA Quartiles, class split per raid)

Spec: `gh issue view 200 --repo agrorithms/destiny-public` (the body, with `## Done when`; the 2026-11-12 comment is the
streaming prototype). Branch `feat/200-raid-stats-tab`, base `feat/204-activity-scope` @ `47325f6`. Seams S1–S9 and six
decisions approved 2026-11-12:

- S1 `isScopeComputed(scope, hoursBack)` in `queries.ts`, read by the query, the route and the page.
- S2 `getRaidStatsFrame` (scalar query + Clear Time Quartiles) and `getRaidScopeStats` (one scope, behind S1) in `queries.ts`;
  `FRESH_RUN` named and shared with `endedRaidRuns` (same SQL text). `getRaidStats` composes them.
- S3 `src/lib/cache/raid-stats-cache.ts`: one cache entry for the frame and one per scope, a 100 ms pause inside the miss path.
- S4 the route composes from S3; `X-Cache` is the least fresh of its entries.
- S5 `activity-url.ts` (`ActivityUrlState`, `activityHref`, the redirect rule) and `activity-view.ts`.
- S6 `raid-stats-view.ts`, the board's pure view model.
- S7 two nested `Suspense` boundaries in the page; both promises made in the page.
- S8 `e2e/activity-stats.spec.ts`; maintenance through `withDbQuiesced` on a cold key, asserted to be the run's first.
- S9 the seed re-stats existing Raid Activity members by kind; no new instance.
- API: flat `clearTimeQuartiles: {p25,p50,p75} | null` plus `fullClearCount`, and `freshRuns`.

**Accepted deviations from the spec (user, 2026-11-12):**

- The rendered empty state is not covered in the browser: the e2e Tracker has data in every window. `raid-stats-view.test.ts`
  proves an empty frame gives the empty state; `docs/e2e-coverage.md` lists the rendered one as uncovered.
- At 30 days the line "30 days shows Full Clears only" replaces the scope links whatever the scope (the spec said only under
  `all` and `fresh`), keyed off `isScopeComputed`.
- A class line shows `Unknown` as a fourth share when a raid has any, in `/gos10k`'s order (count, then name).

1. URL builder refactor, no behaviour change
   - [x] `src/app/activity/activity-url.ts` (new) — `ActivityUrlState`, `activityHref`
   - [x] `src/app/activity/activity-view.ts` (new) — `ACTIVITY_VIEWS`, `ACTIVITY_VIEW_PARAM`
   - [x] `src/app/activity/activity-range.ts` — `activityRangeHref` removed, `ACTIVITY_RANGE_PARAM` exported
   - [x] `src/app/activity/ActivityRangeControl.tsx`, `ActivityScopeControl.tsx`, `ActivityRaidPicker.tsx`, `ActivityChart.tsx`
   - [x] `src/app/activity/page.tsx`
   - [x] `src/app/activity/activity-range.test.ts`, `activity-raids.test.ts` — calls only; every expected URL unchanged
   - [x] every `/activity` spec green, unchanged — `activity.spec.ts` + `activity-scope.spec.ts` 55/55 on a fresh build
2. Query, red then green
   - [x] `tests/db/raid-stats.test.ts`
   - [x] `src/lib/db/queries.ts`
3. Staged cache and route, red then green
   - [x] `tests/db/raid-stats-cache.test.ts` (new)
   - [x] `tests/routes/raid-stats.test.ts`
   - [x] `src/lib/cache/raid-stats-cache.ts` (new)
   - [x] `src/app/api/analytics/raid-stats/route.ts`
4. 7d measurement on a backup copy (below)
   - [x] each scope cold and warm; Fresh Runs `INDEXED BY` decided — **not forced** (below)
   - [x] **Stopped: 7d All cold end to end was 8.5–10.6 s, over the ~8 s rule.** User, 2026-11-12: (a) accept on the
     same-day scaling evidence and continue; All Attempts stays the default. Condition: re-measure 7d All cold once more
     beside the 30d streaming measurement and record both sets with date and time (box 7). The 8 s rule is spent for
     this run. Full Clears as the default and prefetching All Attempts are deferred to #245, not built here.
5. View, red then green
   - [x] `src/app/activity/activity-view.test.ts` (new), `activity-url.test.ts` (new)
   - [x] `src/app/activity/raid-stats-view.test.ts` (new)
   - [x] `src/app/activity/activity-view.ts`, `activity-url.ts`
   - [x] `src/app/activity/raid-stats-view.ts` (new)
6. Browser suite and page, red then green
   - [x] `e2e/support/seed-world.ts` — Raid Activity members re-statted by kind
   - [x] `e2e/activity-stats.spec.ts` (new)
   - [x] `src/app/activity/ActivityViewControl.tsx` (new)
   - [x] `src/app/activity/RaidStatsBoard.tsx` (new)
   - [x] `src/app/activity/page.tsx`
   - [x] `e2e/visual.spec.ts` — the stats tab at 7d and 30d
   - [x] `src/app/activity/ActivityLinkToggle.tsx` — comment only
   - [x] `src/app/activity/raid-stats-view.ts` — `peek` (red `f1e7793`), after the warm JavaScript-off spec caught a warm board
     arriving as fallback + hidden segment
7. Streaming measurement on the backup copy (below)
   - [x] cold 30d: header, Clear Time, KDA arrival times — on a running server, header 30–46 ms, Clear Time 1.7–3.7 s, KDA
     11.6–20.6 s (3/3 in order). On a freshly started server's first request the header waited for the frame in 2 of 3
     runs: a decision for the user (below)
   - [x] 7d All cold end to end, re-measured (the condition above) — 5,345 / 5,290 / 8,682 ms (below)
8. Docs
   - [x] `docs/adr/0006-population-kda-quartiles-and-dual-scope.md` — amendment: per-scope cache key for raid stats, the pause
   - [x] `docs/adr/0004-mock-only-at-the-network-boundary.md` — the 2026-10-15 amendment's premise corrected
   - [x] `docs/e2e-coverage.md` — flows and journal
   - [x] this file
9. Bite proofs and suite
   - [x] `npm run mutate:diff -- 47325f6...HEAD --typecheck` — first full run at `a03b05e`: 94.1% overall (96/102), 6 survivors.
     Loop 1 (`ab39ae1`): the scope predicates moved into `queryScope` as literals, as `pgcrsSource` already was, and
     `FRESH_RUN` dropped (its two top-level lines were static mutants Stryker ran but could not reach; `FULL_CLEAR` and
     `endedRaidRuns` are back to their base text); `cleanActivityHref`'s stats branch removed as redundant (the stats tab
     reads no raids, so the #198 rule already redirects any `raids`); a route test for a MISS from the frame alone; cache
     tests for `ANALYTICS_CACHE_FRESH_SEC` / `_SWR_SEC`. Full run at `ab39ae1`: **100.0% overall (96/96), 100.0% covered**,
     108 compile errors discarded, 15 static ignored, PASS. No survivors, no `Stryker disable`. (The one incremental rerun
     between was polluted by another branch's incremental file and is not reported.)
   - [x] one deliberate break per new spec, or the recorded red run — red run at `fa899ef` (16/16 failed, 221 passed), then one build of eight breaks, 10 specs failed, all reverted (table in `docs/e2e-coverage.md`)
   - [x] `npm run visual:check` — run at the commit that ticks this box; result in the implementer's report
   - [x] lint, tsc, build, vitest, e2e at HEAD — run at the commit that ticks this box; result in the implementer's report
10. Simplify
   - [x] /simplify pass (`a933b6f`, `66b9dba`): the route reads its three scopes by name, so `assembleRaidStats`' record
     type checks them (the `SCOPES` list and its `as` cast are gone); the board's read types aliased once (`FrameValue`,
     `ScopeValue`, `Staged<T>`) and its three figure-less KDA sections share `KdaSection`; `RaidStatsMaintenance` no longer
     exported; `sleep` and `plural` reused; `raidKeys` passed to the chart tab instead of rebuilt; `rank` searches once;
     `getRaidStats`' comment no longer says it is what the route runs. No test file changed, so no `expect` line moved.
11. Review fix loop 1 (the user picked all six; S5 follow-up, P1 and O2 declined)
   - [x] O1 `src/lib/db/queries.ts` — one `FRESH_RUN` again, read by `queryScope`, `endedRaidRuns` and `FULL_CLEAR`; every
     SQL text byte-identical to before (the two constants' values checked), so #204's checked plan stands
   - [ ] P2 `e2e/activity-stats.spec.ts` — the 30d "Full Clears only" line with JavaScript off, warm; `docs/e2e-coverage.md`
   - [ ] S1 `docs/adr/0006-population-kda-quartiles-and-dual-scope.md` — the no-refetch text marked as superseded for raid stats
   - [ ] S2 `docs/adr/0004-mock-only-at-the-network-boundary.md` — `serveMaintenance` kept pending a follow-up issue
   - [ ] S3 `src/app/activity/peek.ts` (new) — `peek`, `settle`, `Peeked`, `Settled`, with `peek` built on `settle`; tests moved
   - [ ] S4 `src/app/activity/RaidStatsBoard.tsx`, `page.tsx` — `Staged<T>.now` → `seen`, `frameSeen`, `scopeSeen`
   - [ ] lint, tsc, build, vitest, e2e, visual:check and `mutate:diff -- 47325f6...HEAD --typecheck` at the loop's HEAD

## Commits so far

- `aa21bf2` URL builder refactor (`/activity` specs 55/55 unchanged on a fresh build).
- `fc238a5` red (14 failing in `tests/db/raid-stats.test.ts`) → `ffa795e` green: frame, per-scope read, gate, Fresh Runs, Clear Time Quartiles.
- `34a4786` red (21 failing in `src/app/activity`) → next commit green: `parseActivityView`, `cleanActivityHref`, `raid-stats-view.ts`.
- `fa899ef` red: the whole e2e suite with the new spec and seed, before the page — `activity-stats.spec.ts` 16/16 failed,
  the other 221 passed, so the re-statted seed moved no existing expectation. Green: next commit, the three `/activity`
  specs 71/71. In between, a first green attempt failed 2: the warm JavaScript-off spec and one 30d spec saw the cards
  twice (a warm board still streamed as fallback + hidden segment; React outlines every async component). `peek` (red
  `f1e7793`) fixed it, and the spec reads only visible cards, since React can reveal a streamed segment after `load`.
- `56de974` green view chunk; `f1e7793` red → `a39e52f` green page; `d66c4d0` measurements; `a03b05e` docs; `ab39ae1` mutation loop 1.
- `e53e7a5` red (10 failing across `tests/db/raid-stats-cache.test.ts` and `tests/routes/raid-stats.test.ts`) → `ec3e125` green: staged cache, the pause, the route.

## 7d measurement (2026-11-12 14:05–14:09 -05:00, x86, WSL2 with 5 GB, `data/raid-tracker.backup-2026-11-05.db` scratch copy)

The copy was opened once through `getDb()` (which built `idx_pgcrs_ended_period_raid_clear`, ~1.3 s) and its WAL
checkpointed. `Date.now` pinned to the backup's newest `ended_at` (1793931697). Cold means `sync` then
`posix_fadvise(DONTNEED)` on the file, `fincore` reporting 0 B resident, then a fresh process. Times are the statements
through `getRaidStatsFrame` / `getRaidScopeStats`, not including the 2 × 100 ms pause. Player-Runs at 168h: All 1,100,232,
Fresh 437,929, Full Clears 222,836.

End to end as the page computes it (the frame, then the URL's scope), three cold runs each, interleaved:

| scope | frame + scope, cold (ms) | of which the scope | frame + scope, warm (ms) |
|---|---|---|---|
| All Attempts | 10,487 / 8,500 / 10,572 | 10,007 / 7,922 / 9,998 | 4,357 / 6,464 / 8,288 |
| Fresh Runs (unforced) | 7,681 / 4,552 / 7,180 | 7,149 / 4,217 / 6,710 | 3,621 / 3,322 / 3,395 |
| Full Clears | 4,385 / 2,576 / 4,031 | 3,842 / 2,285 / 3,478 | 1,691 / 1,609 / 1,698 |

The frame alone is 290–610 ms cold.

**Same-day calibration against figures ADR 0006 recorded on this same backup (#227, 2026-11-07):** the scope statement
alone, cold, three runs each today — Full Clears 4,382 / 3,123 / 2,412 ms (recorded: 2,060 / 2,091), All Attempts
10,145 / 6,569 / 6,386 ms (recorded: 5,288 / 4,989); warm All 4.0–7.8 s (recorded: 3,291). The machine is 1.2–2× slower
than on the day the ADR measured, and noisy: identical cold runs differ by up to 4 s.

**Fresh Runs `INDEXED BY idx_pgcrs_ended_period_raid_clear`: not forced.** Scope statement alone, cold, interleaved:
unforced 7,828 / 7,236 / 4,325 ms, forced 6,879 / 4,720 / 5,969 ms (and an earlier unforced batch 6,946 / 4,351 / 5,963).
Warm: unforced 1,607 / 1,719 / 1,810, forced 1,564 / 1,409 / 1,462. Forced is ~0.6 s faster cold on the means, inside the
2–3.5 s run-to-run spread, so the rule keeps the planner's choice.

### 7d All Attempts re-measured (2026-11-12 14:46:56–14:47:18 -05:00, same machine, copy and method)

The user's condition for accepting the first set: one more cold end-to-end run of the default view, recorded beside it.
Load average 0.87 at the start. Frame + All Attempts, cold, three runs: **5,345 / 5,290 / 8,682 ms** (frame 281 / 219 /
231 ms, the All statement 5,064 / 5,071 / 8,451 ms), plus the 2 × 100 ms pause. Two of three are under the 8 s line and
in line with ADR 0006's recorded 5.0–5.3 s for the statement; the third is not. The 8 s rule was spent on the first set,
so this is recorded, not a stop.

## Streaming measurement (2026-11-12 14:44–14:46 -05:00, same machine and copy)

Production build of `a39e52f`'s code (`next build`, the e2e build), `next start -p 3200` with `RAID_TRACKER_DB_PATH` on the
scratch copy, `WARMER_ENABLED=false`, and `Date.now` pinned to the copy's newest `ended_at` through a `--import` preload.
URL `/activity?range=30d&view=stats` (All Attempts in the URL, so the tab shows Full Clears). Before each cold request the
copy was evicted from the page cache (`fincore` 0 B), on a server that had made no Tracker query. Timed by the 2026-11-12
probe with `Accept-Encoding: gzip`: when each marker first reached the client. Header = the intro "Clear times and KDA
per raid"; Clear Time = the first Clear Time panel (the second stage's fallback); KDA = the first class line. Each server
was stopped by its `next-server` PID after its run.

**On a running server** (the route's code loaded first by two requests for the same URL during maintenance, which run the
page and no query):

| run | header | Clear Time | KDA | end |
|---|---|---|---|---|
| 14:45:01 | 30 ms | 1,726 ms | 11,584 ms | 11,590 ms |
| 14:45:31 | 46 ms | 3,072 ms | 20,582 ms | 20,606 ms |
| 14:46:19 | 41 ms | 3,734 ms | 14,654 ms | 14,661 ms |

The header arrives before the first query finishes and Clear Time before KDA, every run. Warm, straight after each: the
whole board at 32–93 ms, with no skeleton (`raid-stats-skeleton` absent).

**On a freshly started server's first request** (nothing loaded before):

| run | header | Clear Time | KDA | end |
|---|---|---|---|---|
| 14:44:10 | 3,354 ms | 3,354 ms | 23,433 ms | 23,471 ms |
| 14:45:56 | 4,198 ms | 4,198 ms | 20,062 ms | 20,088 ms |
| 14:46:36 | 125 ms | 1,772 ms | 11,632 ms | 11,647 ms |

Twice of three the header waited for the frame's query: loading the route's code took longer than the 100 ms pause, so
the query started before anything flushed. Clear Time still came before KDA every time. Put to the user as a decision.

**Decided 2026-11-12 (user):** accepted and recorded. It hits one request per worker restart, and a running server
passed 3 of 3.

**Also decided 2026-11-12 (user):** each panel shows its sample size once, muted beside its heading, where the spec
says beside every figure. An accepted deviation: every figure in a panel shares one sample.
