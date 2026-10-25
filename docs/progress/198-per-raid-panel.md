# #198 — Raid Activity: per-raid panel with the raid picker

Spec: `gh issue view 198` (parent #51). Branch `feat/198-per-raid-panel`, base `main` @ `f33d26c`.
Seams S1–S6 and decisions D1–D7 approved 2026-10-25:

- D1 cache per range only: the page asks the query for every known raid key and slices with `pickRaids`.
- D2 top 3 = counted raid-seconds over the counted window; zero-activity raids excluded; ties in `RAID_DEFINITIONS` order.
- D3 part-aware `locate`; no tooltip over the bottom panel's shade; one box (total line, then a named line per picked raid); the marker spans both panels.
- D4 `--ui-series-1..5` tokens in `globals.css`, both themes; colour by position in the picked list; legend of swatch + name.
- D5 `router.replace`; full list spelled out; range links carry `raids` only if the URL had it; unpicking the last drops `raids`.
- D6 all 12 `RAID_DEFINITIONS` in definition order. D7 JS off: URL's or default raids drawn, dropdown inert.
- The cap on `RaidMultiSelect` is opt-in props only; the three existing uses pass none.

1. Query, red then green (S1)
   - [x] `tests/db/raids-in-progress.test.ts` — per-raid split, sums, top 3, requested keys
   - [x] `src/lib/db/queries.ts` — `raidKeys`, `point.raids`, `series.topRaids`
2. Raid selection, red then green (S2)
   - [x] `src/app/activity/activity-raids.test.ts` (new)
   - [x] `src/app/activity/activity-raids.ts` (new)
   - [x] `src/app/activity/activity-range.ts` / `.test.ts` — `activityRangeHref` carries raids
3. Geometry and tooltip copy, red then green (S3)
   - [x] `src/app/activity/activity-geometry.test.ts`, `activity-tooltips.test.ts`
   - [x] `src/app/activity/activity-geometry.ts`, `activity-tooltips.ts`
4. The browser suite, red (S4, S5)
   - [x] `e2e/support/seed-world.ts` — six raids with a known ranking
   - [x] `e2e/activity.spec.ts` — per-raid specs
5. UI, green (S4, S5, S6)
   - [x] `src/components/RaidMultiSelect.tsx` — opt-in cap
   - [x] `src/components/chart/ChartHover.tsx` — part-aware locate, spanning marker, multi-line
   - [x] `src/app/globals.css` — `--ui-series-1..5`
   - [x] `src/app/activity/ActivityRaidPicker.tsx` (new), `ActivityLocal.tsx`, `ActivityChart.tsx`, `ActivityRangeControl.tsx`, `page.tsx`
6. Bookkeeping
   - [x] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated line
   - [x] `docs/e2e-coverage.md` — flow entry and journal
   - [x] this file
7. Bite proofs
   - [x] `npm run mutate:diff -- f33d26c...HEAD --typecheck` at `315f28c` — 100.0% overall (131/131 scored), 100.0% covered, 54 compile errors discarded, 1 kill-and-rerun loop (one survivor at the first run, `raidPanelAriaLabel`'s `join('')`, simplified away), no `Stryker disable` comments
   - [x] `npm run visual:check`
   - [x] lint, build, test, e2e at HEAD
8. Simplify
   - [x] /simplify pass — `48a1e54` (raid picker: `useOptimistic`, one refusal path, no `emptyLabel`), `0e5c937` (shared `Gridlines` and `shadeToNow`, raid keys derived once, doc comments rewrapped); no test files changed; suite green at `0e5c937` (vitest 839/839, e2e 204/204, visual:check 68/68)

9. Review fixes — fix loop 1 (P1 declined)
   - [x] S1 `e2e/activity.spec.ts` — the bottom panel's tooltip seen on a counted step before the count of 0 over the estimate (deliberate break: `countedOnly` forced off in `ActivityLocal.tsx`, red at the new `toHaveCount(0)`)
   - [x] S2 `tests/db/raids-in-progress.test.ts` — the zero-activity test also seeds a raid wholly in the uncounted steps, so it reaches `topRaids`' `time > 0` filter (hand mutation `.filter(() => true)`: the test fails, receiving `crotas_end`; reverted)
   - [x] S3 `RaidOption` exported from `RaidMultiSelect.tsx` and used for every `{ key, name }` raid list (`ActivityChart.tsx`, `ActivityRaidPicker.tsx`, `page.tsx`, and `activity-tooltips.ts` by `import type`)
   - [x] S4 `ACTIVITY_RAIDS_PARAM` defined in `activity-raids.ts`, imported by `activity-range.ts` (`activity-raids.ts` now imports nothing, so no cycle)
   - [ ] S5 `ActivityChart.tsx` — one `Panel` wrapper for both `<svg>`s
   - [x] S6 `RaidMultiSelect.tsx` — the capped picker's `role="status"` region mounted empty with the open list (spec red before the fix: `toBeAttached()` not found)

## Sweep timing

`getRaidsInProgress` on a copy of `data/raid-tracker.backup-2026-10-25.db` (the backup itself opened by nothing; copied
into the scratchpad and `RAID_TRACKER_DB_PATH` pointed at the copy), x86 WSL2, uncached, median of 3 warm runs,
with 13 raid keys requested. Before = `f33d26c`, after = this branch at the S1 commit:

| range | before | after |
|---|---|---|
| 24h (10 min steps) | 267 ms | 300 ms |
| 7d (1 h steps) | 412 ms | 515 ms |
| 30d (3 h steps) | 1050 ms | 1340 ms |

Asking for no raid keys costs the same: the per-raid arrays are filled either way, because the top 3 needs them.
The extra is the third column and a map lookup per row. Behind the 300 s cache and, with D1, one entry per range,
so a visitor never pays it once warm.

## Surviving mutants

none. (The first run had one, `activity-geometry.ts:480`, an equivalent `join('')` on a one-element list; the code was simplified and the full rerun has none.)

## Notes

- A second `mutate:diff --incremental` run reported 24 survivors and 12 no-coverage mutants in `src/lib/active-session/`
  (`dedupe.ts`, `roster.ts`), files this branch did not touch: `reports/stryker-incremental.json` still held another
  ticket's results. The full run without `--incremental` has none; the reported score comes from it.
- Red runs and deliberate breaks for the 14 new specs: `docs/e2e-coverage.md`, "#198".
- Suite at the last code commit (`8949474`, `.md` only since): lint 0 errors (29 warnings), tsc app and scripts, build, vitest 839/839, e2e 204/204, visual:check 68/68.
