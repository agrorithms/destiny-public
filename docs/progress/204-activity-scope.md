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
   - [x] `src/app/activity/activity-scope.test.ts`, `src/app/activity/activity-range.test.ts`
   - [x] `src/app/activity/activity-scope.ts`, `src/app/activity/activity-range.ts`
2. Query, red then green
   - [x] `tests/db/raids-in-progress.test.ts`, `tests/db/completeness-curve.test.ts`
   - [x] `src/lib/db/queries.ts`
3. Browser suite and page, red then green
   - [x] `e2e/support/seed-world.ts` — Fresh Runs and Full Clears re-flagged into the Activity world
   - [x] `e2e/activity-scope.spec.ts`
   - [x] `src/app/activity/ActivityScopeControl.tsx`
   - [x] `src/app/activity/ActivityRangeControl.tsx`, `ActivityRaidPicker.tsx`, `ActivityChart.tsx`
   - [x] `src/app/activity/page.tsx`
   - [x] `e2e/visual.spec.ts` — `/activity?scope=full`
4. Bookkeeping
   - [x] `tests/db/raids-in-progress-index.test.ts` — docblock: #204 now reads the flags
   - [x] `docs/e2e-coverage.md` — flow entry and journal
   - [x] this file
   - [x] `docs/handoffs/261107-204-scope-grill.md` (gitignored, local only) — order, Q6, rejected widening, "Not done"
5. Bite proofs and suite
   - [x] plan check (both passes) on the 2026-11-05 backup copy — covering at every range, no `INDEXED BY` (below)
   - [x] 30d cold miss, before and after — measured; **not** within the before spread (below), a decision for the user
   - [x] `npm run mutate:diff -- fd26b2c...HEAD --typecheck` — full run at `b5b3d56`: 100.0% overall (39/39), 100.0% covered, 23 compile errors discarded, PASS; no survivors, no loops, no `Stryker disable`
   - [x] `npm run visual:check` — 74/74 at `b5b3d56` (68 before plus `activity-full` at six sizes), overflow gate passed
   - [x] lint, build, test, e2e at HEAD — lint 0 errors (29 warnings), tsc app and scripts, build, vitest 942/942, e2e 221/221 (run at `4c25eae`, and again at the commit that ticks this box)

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

**Plan, after** (the shipped `endedRaidRuns`, which also reads `p.activity_was_started_from_beginning = 1` and
`(FULL_CLEAR)`): at 24h, 7d and 30d, both passes (the curve pass's training week and the sweep) are
`SEARCH p USING COVERING INDEX idx_pgcrs_ended_period_raid_clear (ended_at>? AND ended_at<?)`. No `INDEXED BY`
added.

**Same answer for All Attempts.** The 30d and 7d All Attempts series hash the same before and after (`42d6708403f1`,
`f5de32bfcdf3`: every point, estimate and top raid). The other scopes' default raids on the copy: 7d Fresh Runs and
Full Clears both VoG · RoN · DSC (the grill's figures); 30d Fresh Runs VoG · LW · RoN, Full Clears VoG · KF · RoN.

**30d cold miss, after**, interleaved with before in the same session (three rounds of before, after and a
raw-flags variant, then the earlier two), cold ms:

| | runs | min | median | max |
|---|---|---|---|---|
| before (`fd26b2c`) | 21 cold | 1,518 | 1,636 | 1,836 |
| after (`endedRaidRuns` with the two flag expressions) | 15 cold | 1,714 | 1,748 | 2,240 |
| variant: raw flag columns, classified in JS (not shipped) | 9 cold | 1,767 | 1,807 | 1,836 |

Warm: before 1,322–1,498, after 1,561–1,846. Split warm, the curve pass went ~230 → ~300 ms and the sweep
~1,060 → ~1,330 ms. Reading the rows alone (no JS work) is ~890 ms before and ~1,190 ms with the two flag
expressions, ~970 ms with the two raw columns; the raw-flags variant was no faster end to end.

**Verdict: not within the before spread.** 9 of 15 after runs fall inside the before range (1,518–1,836), but the
median is ~110 ms (~7%) higher cold and ~250 ms (~18%) higher warm, and 6 runs land above every before run. The
extra cost is the work the scopes add: two more columns per row, and each Fresh Run and Full Clear added to a
second and third set of arrays (~47% more overlap writes at 30d). Put to the user as a decision.

## Browser suite

Red run at `1b655c0` (seed and spec committed, page unchanged): `npm run e2e`, **9 failed, 212 passed** — the nine
new specs, and nothing else, so the re-flagged seed moved no existing spec. Green at `b5b3d56`: 221/221. Deliberate
breaks in three builds of `e2e/activity-scope.spec.ts` (three because the intro is checked before the peak, so an
intro break hides a data break); the table is in `docs/e2e-coverage.md`'s #204 entry. Every one of the nine specs
failed on a break of its own, and all were reverted.
