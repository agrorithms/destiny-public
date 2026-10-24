# #195 — Raid Activity: 24h / 7d / 30d range presets in `?range=`

Spec: `gh issue view 195` (parent #51). Branch `feat/195-range-presets`, base `main` @ `c9ef7f2`.
Seams approved 2026-10-23 (seven, as proposed in the seam report), with: the data start read from
the oldest stored PGCR plus a 6-hour margin inside the query (not the env var), the 30-day uncached
cost accepted behind per-range cache keys, the dated data-start legend, `/activity?range=24h|30d`
added to visual:check, and a dated ADR 0009 Consequences line.

1. The covering index, red then green
   - [x] `tests/db/raids-in-progress-index.test.ts` (new) — the opened Tracker has `idx_pgcrs_ended_period_raid (ended_at, period, raid_key)`
   - [x] `src/lib/db/schema.ts` — `CREATE INDEX IF NOT EXISTS idx_pgcrs_ended_period_raid`
2. The query's ranges and data start, red then green
   - [x] `tests/db/raids-in-progress.test.ts` — per-range step size and point count, boundary splits at 10 min and 3 h, real cleanup then the 30-day first step, no clamp when the data reaches back
   - [x] `src/lib/db/queries.ts` — `countedFrom`, `DATA_START_MARGIN_SECONDS`, `countedUntil` independent of the clamp
3. The range module, red then green
   - [x] `src/app/activity/activity-range.test.ts` (new)
   - [x] `src/app/activity/activity-range.ts` (new) — `ACTIVITY_RANGES`, `parseActivityRange`, `activityRangeHref`
4. Geometry, red then green
   - [x] `src/app/activity/activity-geometry.test.ts` — hour/day ticks per range, `beforeData`, `describePeak`, `notYetCountedLegend`, `describeBeforeData`
   - [x] `src/app/activity/activity-geometry.ts`
5. The page
   - [x] `src/app/activity/ActivityRangeControl.tsx` (new) — Link-based, `aria-current`
   - [x] `src/app/activity/ActivityChart.tsx` — the range's ticks, wording and the data-start shade
   - [x] `src/app/activity/page.tsx` — `?range=`, per-range cache key, intro per range
   - [x] `src/app/activity/layout.tsx` — a description that names no single range
6. The browser suite, red then green
   - [x] `e2e/support/seed-world.ts` — B1 (the oldest PGCR, 20 days back) and B2 (two 20-minute runs 6 h back)
   - [x] `e2e/activity.spec.ts` — presets set `?range=` and redraw, reload, nonsense, JS off, 360px
   - [x] `e2e/visual.spec.ts` — `/activity?range=24h` and `/activity?range=30d`
7. Bookkeeping
   - [x] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated Consequences line
   - [x] `docs/e2e-coverage.md` — flow list, seed count, journal entry with every deliberate break
   - [x] `docs/progress/195-range-presets.md` (this file)
8. Simplify
   - [x] /simplify pass

## Review fixes

Loop 1 (the user picked O1, S2, S3, S4; S1 is a follow-up issue, O3 declined).

- [x] S3 — `activity-range.ts` exports `MINUTE`/`HOUR`/`DAY`; `activity-geometry.ts` counts in them (no `SECONDS_PER_DAY`, no bare `3600`). `NOT_YET_COUNTED_AGE_SECONDS` stays its own value, held equal to the query's by its test
- [x] S2 — `rangeOfSeries` (`activity-range.ts`) reads the preset off a series' window and step and throws for a series no preset makes; `ActivityChart` takes `series` only, so its ticks, caption and shades all come from one step
- [x] O1 — the intro reads "averaged over every 10 minutes / hour / 3 hours of the last …"
- [x] S4 — `e2e/activity.spec.ts`'s `rangeLink` finds a preset's link by its label from `ACTIVITY_RANGES`

## Surviving mutants

None. Loop 1 (`b1c2855`) killed or removed all six from the first run: two hour-tick boundaries
got tests, an unreachable singular in `formatDuration` and the empty-table branch in the query
were removed, and `DATA_START_MARGIN_SECONDS` became a literal (`6 * 3600` sat in a top-level
initialiser no test could switch). No `Stryker disable` comments.

## Bite proofs

- Review fixes: `npm run mutate:diff -- 071f9d0...HEAD --typecheck` — 100% (28/28), one survivor
  (the refusal's message emptied) killed by a test that the refusal names the span and step.
  S4: one deliberate break, the control rendering `label.toUpperCase()`, turned 8 of the spec's
  11 tests red on `rangeLink`; reverted.

- Vitest: `npm run mutate:diff -- c9ef7f2...HEAD`, see the report.
- Playwright: the red run at `2be05d1` and one deliberate break (one cache key for every range);
  both recorded in `docs/e2e-coverage.md`'s #195 entry.
- /simplify pass: `e2e/activity.spec.ts`'s #194 helper `expectChartDrawn` now runs
  `expectRangeDrawn(page, '7d')`, which took over its `M`-start and right-edge checks. Bite
  proof: one deliberate break, `notYetCounted`'s `endPercent` set to 99, turned 8 of the
  spec's 9 tests red on `x + width ≈ 100` (the nav-link test draws no chart); reverted.
