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
   - [ ] `tests/db/raid-stats.test.ts`
   - [ ] `src/lib/db/queries.ts`
3. Staged cache and route, red then green
   - [ ] `tests/db/raid-stats-cache.test.ts` (new)
   - [ ] `tests/routes/raid-stats.test.ts`
   - [ ] `src/lib/cache/raid-stats-cache.ts` (new)
   - [ ] `src/app/api/analytics/raid-stats/route.ts`
4. 7d measurement on a backup copy (below)
   - [ ] each scope cold and warm; Fresh Runs `INDEXED BY` decided
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
