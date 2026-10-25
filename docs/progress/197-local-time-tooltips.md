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
   - [x] lint, build, test, e2e at HEAD (6a88dff): lint 0 errors, tsc, 791 vitest, build, 189 e2e
8. Simplify
   - [x] /simplify pass — tooltip steps placed from the slots and `xPercent` (the locator record and the second `SlotLocator` gone), `describePeak` split into `peakCaption` / `peakAriaLabel`, tick-helper tidy; boundary test kills the two survivors (`mutate:diff --incremental`: activity files 132/132); suite at 0b8ccdb: lint 0 errors, tsc, build, 791 vitest, 189 e2e, visual:check 68

9. Fix loop 1 (review findings P1–P4, S2–S8)
   - [x] P1 `src/app/activity/activity-time.test.ts` — a real half-hour case (India, +5:30); the Kathmandu case named a quarter-hour one; `e2e/activity.spec.ts` header
   - [x] P2 `docs/e2e-coverage.md` — a deliberate break the counted-step hover spec catches, in the break table
   - [x] P3 + S8 `src/app/activity/activity-geometry.ts` — a midnight the clock reads twice (the Azores fall-back) is ticked once, at the first; tests for 7d and 24h, red first (two `Sun 25` ticks)
   - [x] P4 + S2 `src/app/activity/ActivityLocal.tsx`, `activity-time.ts` (`readerOffsetOf`) — no zone name, no offset: UTC everywhere; spec red first at `0b32180`
   - [x] S3 `src/app/activity/activity-geometry.test.ts` — the busiest-step comment's stale clause
   - [x] S4 `src/app/activity/activity-time.ts` — `dateLabel` private, tested through `formatInstant`
   - [x] S5 `src/app/activity/activity-geometry.ts` — one `stepCentrePercent` for the line and the tooltips
   - [x] S6 `GRIDLINE_STROKE` shared by the x and y gridlines
   - [x] S7 `src/app/activity/activity-tooltips.test.ts` — a JSON round trip leaves the tooltip's text unchanged
   - [x] `npm run mutate:diff -- 8f892c9...HEAD --typecheck` at `abf90be` — 100.0% overall (18/18 scored), 100.0% covered, 2 compile errors discarded, loops 0, no survivors; suite at `abf90be`: lint 0 errors (29 warnings), tsc, build, 797 vitest, 190 e2e, visual:check 68

## Notes

- Red run: `db312cd`, 18 of 21 activity specs failed (the two canaries passed with 3 others). Deliberate breaks in one build, plus the dismissal break alone: `docs/e2e-coverage.md`.
- Chromium names the zone `Asia/Katmandu`; the spec accepts both spellings.
