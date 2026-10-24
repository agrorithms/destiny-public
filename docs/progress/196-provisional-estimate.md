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
   - [x] `e2e/visual.spec.ts` — no change expected; checked
6. Bookkeeping
   - [x] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated in-place amendment
   - [x] `docs/e2e-coverage.md` — flow entry and journal with the red run
   - [x] `docs/progress/196-provisional-estimate.md` (this file)
7. Bite proofs and the backtest
   - [x] `npm run mutate:diff -- c1a18a0...HEAD --typecheck` (full runs only)
   - [x] Parity run of the real functions against the mirror script on a scratch copy of the backup
   - [x] `npm run visual:check`

## Surviving mutants

None. No `Stryker disable` comments.

- Run 1 (`08307e2`): 88.1% overall (140+1 of 197 scored), 18 survivors. All killed or removed in loop 1
  (`3485fdc`): the tally's loop is bounded by the run itself (`ceil(endedAt)`), which dropped two
  redundant guards; the curve's constants became literals (a top-level calculation is out of the
  mutation run's reach, as in #195); the singular "1 minute" was unreachable and removed; tests for
  the interpolation weights, a run starting before the training window, the dashed line starting
  on the *last* of several counted points, and the legends at step sizes the three ranges don't
  use. The `cutoff > countedUntil` guard around `getCompletenessCurve` was output-equivalent (it
  only saved ~230 ms when no step is estimated, about half the time at 30 days) and was removed
  rather than disabled: see the report.
- Run 2 (`3485fdc`): 98.6% (140 of 142), 2 survivors: a run reported past the curve's longest age
  could add a point to the curve. Killed in loop 2 (`b85d9e5`).
- Run 3 (`b85d9e5`, full, `--typecheck`): **100.0% overall (142/142), 100.0% covered**, PASS.
  140 killed, 2 timed out, 0 survived, 36 compile errors discarded.

## Bite proofs

- Vitest: the red commits (`f130afc`, `dcb8b62`, `4d1367c`, `4ef40bb`) each fail before their code;
  the mutation run above is the proof for every changed line of `.ts` under `src/`.
- Playwright: red at `aa699fa` (10 of 13 failed, 3 passed: the canaries and the nav spec), green
  at `8bc7ed2` (13 of 13). Recorded in `docs/e2e-coverage.md`. No separate deliberate break.
- Backtest and parity (scripts in the session scratchpad, not committed): the shipped functions
  agree with an independent mirror to 1e-15 on the points and exactly on the curve's shares (4200
  shares, 55 points, three pretend-nows, three ranges); the replay of the shipped code gives the
  figures in ADR 0009's amendment.
