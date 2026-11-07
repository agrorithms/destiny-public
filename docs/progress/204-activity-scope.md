# #204 — Raid Activity: scope toggle (All Attempts / Fresh Runs / Full Clears)

Spec: `gh issue view 204 --repo agrorithms/destiny-public` (the body; the grill comment's Data section is superseded).
Branch `feat/204-activity-scope`, base `feat/227-widen-ended-index` @ `fd26b2c`. Seams and decisions approved 2026-11-07:

- Seams: (1) `src/app/activity/activity-scope.ts`, a pure URL module with a colocated test, plus `activityRangeHref` cases in
  `activity-range.test.ts`; (2) `tests/db/raids-in-progress.test.ts` `describe('scopes (#204)')` on real SQLite; (3)
  `tests/db/completeness-curve.test.ts`, per-scope curves and the in-scope minimum; (4) plan check and 30d cold miss in a
  scratchpad harness on a backup copy, no Vitest plan test; (5) the seed re-flags existing Activity runs ≥36h old, so the
  All Attempts world is unchanged; (6) `e2e/activity-scope.spec.ts`, plus `/activity?scope=full` in `e2e/visual.spec.ts`.
- `getRaidsInProgress` returns `Record<ActivityScope, RaidsInProgressSeries>` from one sweep. The page takes `[scope]` from
  the cached value (one cache key per range, as before). `getCompletenessCurves` is per scope. `getCompletenessCurve` stays
  All Attempts' total. The existing tests read All Attempts through a one-line helper.
- Series keys `allAttempts | freshRuns | fullClear`. The URL ids `all | fresh | full` map to them in `activity-scope.ts`.
  `RaidScope` (getRaidStats') is untouched.
- The sweep's SELECT returns `p.activity_was_started_from_beginning = 1` and the named `FULL_CLEAR` as two 0/1 columns.
- Intro, second sentence. All Attempts unchanged. Fresh: "Only Fresh Runs count: raids started at the first encounter,
  finished or not." Full Clears: "Only Full Clears count: raids started at the first encounter that someone finished."

1. URL module, red then green
   - [ ] `src/app/activity/activity-scope.test.ts`, `src/app/activity/activity-range.test.ts`
   - [ ] `src/app/activity/activity-scope.ts`, `src/app/activity/activity-range.ts`
2. Query, red then green
   - [ ] `tests/db/raids-in-progress.test.ts`, `tests/db/completeness-curve.test.ts`
   - [ ] `src/lib/db/queries.ts`
3. Browser suite and page, red then green
   - [ ] `e2e/support/seed-world.ts` — Fresh Runs and Full Clears re-flagged into the Activity world
   - [ ] `e2e/activity-scope.spec.ts`
   - [ ] `src/app/activity/ActivityScopeControl.tsx`
   - [ ] `src/app/activity/ActivityRangeControl.tsx`, `ActivityRaidPicker.tsx`, `ActivityChart.tsx`
   - [ ] `src/app/activity/page.tsx`
   - [ ] `e2e/visual.spec.ts` — `/activity?scope=full`
4. Bookkeeping
   - [ ] `tests/db/raids-in-progress-index.test.ts` — docblock: #204 now reads the flags
   - [ ] `docs/e2e-coverage.md` — flow entry and journal
   - [ ] this file
   - [ ] `docs/handoffs/261107-204-scope-grill.md` (gitignored, local only) — order, Q6, rejected widening, "Not done"
5. Bite proofs and suite
   - [ ] plan check (both passes) on the 2026-11-05 backup copy
   - [ ] 30d cold miss, before and after
   - [ ] `npm run mutate:diff -- fd26b2c...HEAD --typecheck`
   - [ ] `npm run visual:check`
   - [ ] lint, build, test, e2e at HEAD

## Real data (2026-11-05 backup)

Scratch copy of `data/raid-tracker.backup-2026-11-05.db` (it already has `idx_pgcrs_ended_period_raid_clear`, and prod's
`sqlite_stat1`). The live `data/raid-tracker.db` was never opened. The harness is scratch, not committed: it calls the
real `getRaidsInProgress` from a source tree, as the page does (every raid key, the default minimum), with `Date.now`
pinned to the newest `ended_at` (1793931697). "Before" is `git archive fd26b2c src`. Cold means `sync`, then
`posix_fadvise(DONTNEED)` on the copy (fincore 0 B) and `shrink_memory` before the call. x86, better-sqlite3 (SQLite 3.51.2).

Raid runs on the copy by flag: fresh-start 0 / completed 0: 850,139; 0 / 1: 304,316; 1 / 0: 548,569; 1 / 1: 165,717. No NULLs.

**Plan, before** (`fd26b2c`, 30d): both passes `SEARCH p USING COVERING INDEX idx_pgcrs_ended_period_raid_clear (ended_at>? AND ended_at<?)`.

**30d cold miss, before** (`fd26b2c`), two processes of three cold and two warm calls each, ms:

| run | cold | cold | cold | warm | warm |
|---|---|---|---|---|---|
| 1 | 1,777 | 1,723 | 1,653 | 1,491 | 1,473 |
| 2 | 1,729 | 1,656 | 1,620 | 1,467 | 1,468 |
