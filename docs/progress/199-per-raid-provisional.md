# #199 — Raid Activity: per-raid Provisional estimates

Spec: `gh issue view 199 --repo agrorithms/destiny-public` (parent #51). Branch `feat/199-per-raid-provisional`, base `main` @ `7070e76`.
Seams and decisions approved 2026-10-26:

- Each raid's tally is kept by `raid_key` in the one training pass; the total's tally is the sum of them. No `raidKeys` filter on the SQL (the total needs every raid); per-raid curves are picked in JS.
- Threshold: 5,000 runs in the raid's training week (the total's window), `MIN_RAID_CURVE_RUNS`. Env knob `ACTIVITY_MIN_RAID_RUNS`, default 5000, set low for the e2e server.
- A raid's estimate stops at its first step with no share. A raid under the threshold has no key on any Provisional point.
- Bottom panel: dashed per-raid segments joining at the last counted point, y-axis includes estimates, shade and legend shared with the top panel (`tooRecent`), conditional "no estimate" note. `notCounted` and `countedOnly` removed.
- Tooltip lines: `Name: n · estimate, still arriving`, and `Name: no estimate`.
- Deviation noted: `CompletenessCurve` itself gains no `runs` field (only `CurveTally` does); the threshold is applied to the tally, so a curve needs nothing more.

1. Pure module, red then green
   - [x] `src/lib/db/completeness-curve.test.ts` — run counts, `sumTallies`, `raidCurveFromTally`, the 5,000
   - [x] `src/lib/db/completeness-curve.ts` — `CurveTally.runs`, `sumTallies`, `raidCurveFromTally`, `MIN_RAID_CURVE_RUNS`
2. Query, red then green
   - [x] `tests/db/completeness-curve.test.ts`, `tests/db/raids-in-progress.test.ts` — per-raid curves and estimates
   - [x] `src/lib/db/queries.ts` — `getCompletenessCurves`, per-raid estimates on Provisional points, `minRaidRuns`
3. Geometry and tooltips, red then green
   - [x] `src/app/activity/activity-geometry.test.ts`, `activity-tooltips.test.ts`
   - [x] `src/app/activity/activity-geometry.ts`, `activity-tooltips.ts`
4. Env knob
   - [x] `src/lib/env.ts` (+ `env.test.ts`) — `envCount`; `envSeconds` and `envMs` now call it
   - [x] `src/app/activity/page.tsx` — reads `ACTIVITY_MIN_RAID_RUNS`
   - [x] `playwright.config.ts` — sets it to 6 for the e2e server. Margin: RAID_A has 9 or 10 training-week runs in the seed (3 peak + 1 at 100 h + 6 daily), King's Fall 4, Vault of Glass 3, Last Wish 2, Crota's End 1; 6 clears the highest below it by 2 and the lowest above it by 3
5. Browser suite, red then green
   - [ ] `e2e/activity.spec.ts` — new and rewritten specs
   - [ ] `src/app/activity/ActivityChart.tsx`, `ActivityLocal.tsx` — dashed paths, shared shade, note
6. Bookkeeping
   - [ ] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated #199 amendment
   - [ ] `CONTEXT.md` — Provisional entry
   - [ ] `docs/e2e-coverage.md` — flow entry and journal
   - [ ] this file
7. Bite proofs
   - [ ] `npm run mutate:diff -- 7070e76...HEAD --typecheck`
   - [ ] `npm run visual:check`
   - [ ] lint, build, test, e2e at HEAD

## Backtest

(filled in below once the shipped functions are replayed)

## Surviving mutants

(none yet)
