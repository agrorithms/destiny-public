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
   - [ ] `src/app/activity/activity-view.test.ts` (new), `activity-url.test.ts` (new)
   - [ ] `src/app/activity/raid-stats-view.test.ts` (new)
   - [ ] `src/app/activity/activity-view.ts`, `activity-url.ts`
   - [ ] `src/app/activity/raid-stats-view.ts` (new)
6. Browser suite and page, red then green
   - [ ] `e2e/support/seed-world.ts` — Raid Activity members re-statted by kind
   - [ ] `e2e/activity-stats.spec.ts` (new)
   - [ ] `src/app/activity/ActivityViewControl.tsx` (new)
   - [ ] `src/app/activity/RaidStatsBoard.tsx` (new)
   - [ ] `src/app/activity/page.tsx`
   - [ ] `e2e/visual.spec.ts` — the stats tab at 7d and 30d
7. Streaming measurement on the backup copy (below)
   - [ ] cold 30d: header, Clear Time, KDA arrival times
   - [ ] 7d All cold end to end, re-measured (the condition above)
8. Docs
   - [ ] `docs/adr/0006-population-kda-quartiles-and-dual-scope.md` — amendment: per-scope cache key for raid stats, the pause
   - [ ] `docs/adr/0004-mock-only-at-the-network-boundary.md` — the 2026-10-15 amendment's premise corrected
   - [ ] `docs/e2e-coverage.md` — flows and journal
   - [ ] this file
9. Bite proofs and suite
   - [ ] `npm run mutate:diff -- 47325f6...HEAD --typecheck`
   - [ ] one deliberate break per new spec, or the recorded red run
   - [ ] `npm run visual:check`
   - [ ] lint, tsc, build, vitest, e2e at HEAD

## Commits so far

- `aa21bf2` URL builder refactor (`/activity` specs 55/55 unchanged on a fresh build).
- `fc238a5` red (14 failing in `tests/db/raid-stats.test.ts`) → `ffa795e` green: frame, per-scope read, gate, Fresh Runs, Clear Time Quartiles.
- `e53e7a5` red (10 failing across `tests/db/raid-stats-cache.test.ts` and `tests/routes/raid-stats.test.ts`) → `ec3e125` green: staged cache, the pause, the route.

## 7d measurement (2026-11-12, x86, WSL2 with 5 GB, `data/raid-tracker.backup-2026-11-05.db` scratch copy)

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
