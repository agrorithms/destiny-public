# #196 — Raid Activity: Provisional estimate on the total line

Spec: `gh issue view 196 --comments` (parent #51). Branch `feat/196-provisional-estimate`, base `main` @ `c1a18a0`.
Seams approved 2026-10-24 (S1–S6, decisions D1–D10 in the seam report). The settled ones that shape every file:
the curve is learned from whole steps of the range's own size, age measured to the step's end (end ages
15 min–2 h), from `ended_at` and never `fetched_at`; each point carries `provisional`; `provisionalUntil` is
the grid floor of now − 15 min (`countedUntil` when no step is Provisional); the estimate targets the step's
final value; the sweep and the training read both stop at `ended_at <= now`.

1. The pure curve, red then green (S1)
   - [x] `src/lib/db/completeness-curve.test.ts` (new) — tally, curve per hour, fallback, `shareAt`, `estimate`
   - [x] `src/lib/db/completeness-curve.ts` (new)
2. Learning the curve from the Tracker, red then green (S2)
   - [x] `tests/db/completeness-curve.test.ts` (new) — a week of fixed-length runs, hour-of-day curves, the 24 h bound, `ended_at` only, three step sizes
   - [x] `src/lib/db/queries.ts` — `getCompletenessCurve`
3. Provisional points in the series, red then green (S3)
   - [x] `tests/db/raids-in-progress.test.ts` — `provisional` flag, partial ÷ share, the 15-minute cutoff, counted at 2 h, three step sizes, `ended_at <= now`
   - [x] `src/lib/db/queries.ts` — `provisional`, `provisionalUntil`, `PROVISIONAL_MIN_AGE_SECONDS`, the extended sweep
4. Geometry, red then green (S4)
   - [x] `src/app/activity/activity-geometry.test.ts` — dashed path, too-recent span, legends, axis fits estimates, counted-only peak, the 15-minute mirror
   - [x] `src/app/activity/activity-geometry.ts`
5. The page and the browser suite, red then green (S5)
   - [x] `e2e/support/seed-world.ts` — one 20-minute run that ended 40 minutes before the seed ran (from the clock, not the clock hour, so it stays estimated for 80 minutes)
   - [x] `e2e/activity.spec.ts` — dashed segment, joins, cutoff, legends; the red run is the bite proof
   - [x] `src/app/activity/ActivityChart.tsx` — dashed path, too-recent shade, both legends
   - [x] `src/app/activity/page.tsx` — header comment only (cache key per range unchanged)
   - [ ] `e2e/visual.spec.ts` — no change expected; checked
6. Bookkeeping
   - [ ] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated in-place amendment
   - [ ] `docs/e2e-coverage.md` — flow entry and journal with the red run
   - [ ] `docs/progress/196-provisional-estimate.md` (this file)
7. Bite proofs and the backtest
   - [ ] `npm run mutate:diff -- c1a18a0...HEAD --typecheck` (full runs only)
   - [ ] Parity run of the real functions against the mirror script on a scratch copy of the backup
   - [ ] `npm run visual:check`

## Surviving mutants

(filled in after the mutation runs)

## Bite proofs

(filled in as they are run)
