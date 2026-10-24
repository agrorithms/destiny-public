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

## Surviving mutants

None. Loop 1 (`b1c2855`) killed or removed all six from the first run: two hour-tick boundaries
got tests, an unreachable singular in `formatDuration` and the empty-table branch in the query
were removed, and `DATA_START_MARGIN_SECONDS` became a literal (`6 * 3600` sat in a top-level
initialiser no test could switch). No `Stryker disable` comments.

## Bite proofs

- Vitest: `npm run mutate:diff -- c9ef7f2...HEAD`, see the report.
- Playwright: the red run at `2be05d1` and one deliberate break (one cache key for every range);
  both recorded in `docs/e2e-coverage.md`'s #195 entry.
