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
   - [ ] `e2e/support/seed-world.ts` — six raids with a known ranking
   - [ ] `e2e/activity.spec.ts` — per-raid specs
5. UI, green (S4, S5, S6)
   - [ ] `src/components/RaidMultiSelect.tsx` — opt-in cap
   - [ ] `src/components/chart/ChartHover.tsx` — part-aware locate, spanning marker, multi-line
   - [ ] `src/app/globals.css` — `--ui-series-1..5`
   - [ ] `src/app/activity/ActivityRaidPicker.tsx` (new), `ActivityLocal.tsx`, `ActivityChart.tsx`, `ActivityRangeControl.tsx`, `page.tsx`
6. Bookkeeping
   - [ ] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated line
   - [ ] `docs/e2e-coverage.md` — flow entry and journal
   - [ ] this file
7. Bite proofs
   - [ ] `npm run mutate:diff`
   - [ ] `npm run visual:check`
   - [ ] lint, build, test, e2e at HEAD

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

(none yet)

## Notes
