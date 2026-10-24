# #197 — Raid Activity: hover and tap tooltips in local time

Spec: `gh issue view 197 --comments` (parent #51). Branch `feat/197-local-time-tooltips`, base `main` @ `9307ce8`.
Seams S1–S7 approved 2026-10-24 with every recommended option. Settled decisions that shape every file:

- Gridlines and tick labels move to local midnights / local 3-hour marks, re-rendered on the client; the line,
  dashed path and shades stay server-rendered and do not change.
- The peak caption, the before-data legend and the intro line are localised by the same client step; the
  intro becomes "Times are in your time zone (<IANA name>)" once hydrated. The SVG aria-label stays UTC.
- Tooltip: `1,828 average raids in progress, Tue 20 Oct, 20:00–21:00`; a Provisional step appends
  ` · estimate, still arriving`; a window crossing local midnight reads `22:45–Wed 01:45`; an end exactly at
  local midnight reads `…–00:00`. No zone suffix with JS on; ` UTC` with JS off / a null offset.
- `ChartHover`: a `locate` mapping, an `isPart()` guard, the dragging class as a prop, chart-neutral comments;
  `data-timeline-part` keeps its name. The /gos10k timeline specs stay green.
- `timezoneId: 'UTC'` goes in `activity.spec.ts` and `visual.spec.ts` only; `playwright.config.ts` is unchanged.
- No tooltip over a shaded span.

1. Local-time formatting, red then green (S1)
   - [x] `src/app/activity/activity-time.test.ts` (new)
   - [x] `src/app/activity/activity-time.ts` (new) — the formatters move out of the geometry module
   - [x] `src/app/activity/activity-geometry.ts` / `.test.ts` — take the formatters from it; `describePeak`, `describeBeforeData` take an offset
2. Tick sets in local time, red then green (S2)
   - [x] `src/app/activity/activity-geometry.test.ts` — `axisTicks` with an offset
   - [x] `src/app/activity/activity-geometry.ts` — `ticksEvery` scans local wall time
3. Tooltip copy and slot mapping, red then green (S3)
   - [x] `src/app/activity/activity-tooltips.test.ts` (new)
   - [x] `src/app/activity/activity-tooltips.ts` (new)
4. The browser suite, red (S6)
   - [x] `e2e/activity.spec.ts` — hover, tap, swipe, local time, JS off, 360px overflow
   - [x] `e2e/visual.spec.ts` — `timezoneId: 'UTC'`
5. The client step and the wrapper, green (S4, S5)
   - [x] `src/components/chart/ChartHover.tsx` — `locate`, `isPart()`, the dragging class as a prop, comments
   - [x] `src/app/gos10k/ArchiveTimeline.tsx` — the dragging prop
   - [x] `src/app/activity/ActivityLocal.tsx` (new) — offset hook, hover wrapper, local ticks, localised sentences
   - [x] `src/app/activity/ActivityChart.tsx`, `src/app/activity/page.tsx` — wired
6. Bookkeeping (S7)
   - [x] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated line
   - [x] `docs/e2e-coverage.md` — flow entry and journal
   - [x] `docs/progress/197-local-time-tooltips.md` (this file)
7. Bite proofs
   - [x] `npm run mutate:diff -- 9307ce8...HEAD --typecheck` — 100.0% overall (93/93 scored), loops 0, no survivors
   - [x] `npm run visual:check` — 68 passed
   - [ ] lint, build, test, e2e at HEAD

## Notes

- Red run: `db312cd`, 18 of 23 activity specs failed. Deliberate breaks in one build, plus the dismissal break alone: `docs/e2e-coverage.md`.
- Chromium names the zone `Asia/Katmandu`; the spec accepts both spellings.
