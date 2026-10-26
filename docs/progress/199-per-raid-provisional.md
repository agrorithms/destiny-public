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
   - [x] `e2e/activity.spec.ts` — new and rewritten specs (red run: 10 of 46 failed against the #198 chart, the 36 others passed; green 46/46)
   - [x] `src/app/activity/ActivityChart.tsx`, `ActivityLocal.tsx` — dashed paths, shared shade, note
6. Bookkeeping
   - [x] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — dated #199 amendment
   - [x] `CONTEXT.md` — Provisional entry
   - [x] `docs/e2e-coverage.md` — flow entry and journal
   - [x] this file
7. Bite proofs
   - [x] `npm run mutate:diff -- 7070e76...HEAD --typecheck` — full run at `ec36c09`: 100.0% overall (92/92), 100.0% covered, 47 compile errors discarded, PASS; first run (at `999686f`) 97.8% (91/93) with two survivors, killed in loop 1 (`activity-geometry.ts:489` `every`→`some`, test: a raid whose estimate ends early still counts as estimated; `queries.ts:1940` the `raidKeys = []` default, an equivalent mutant, removed by deriving a `Set` instead); 1 loop, no `Stryker disable` comments
   - [x] `npm run visual:check` — 68/68, overflow gate passed
   - [x] lint, build, test, e2e at `ec36c09`: lint 0 errors (29 warnings), tsc app and scripts, build (inside `npm run e2e` and `visual:check`), vitest 885/885, e2e 212/212
8. /simplify pass
   - [x] /simplify pass (4 cleanup agents) — `d44e206` source: `raidPanel` draws each raid through `linePaths` (which now takes `linePath`'s `valueOf`) instead of its own solid/dashed join; `getRaidsInProgress` keeps one `estimating` Map of curves; `raidLine` takes the provisional flag. `f5d7be4` tests: `tooltipLines`, `expectMarkerThroughBothPanels`, `raidSolid` via `raidLines`, `fractions()` for the dashed path in `e2e/activity.spec.ts`; `seedTwoCurves` in `tests/db/raids-in-progress.test.ts` (assertions unchanged). Bite proof for the changed spec assertions: one build with three deliberate breaks (raid dashed path one vertex short; counted raid tooltip line `Name:: n`; a five-raid tooltip one line short), 5 of 5 targeted tests red, reverted. Suite at `f5d7be4`: lint 0 errors (29 warnings), tsc app and scripts, build, vitest 885/885, e2e 212/212, visual:check 68/68

## Review fixes (loop 1)

- [x] P1 — `ActivityChart.tsx`: "Each raid below is scaled by the share its own runs usually report." only when a picked raid has an estimate (`noEstimate.length < pickedRaids.length`) — `07799e7`; e2e spec "the legend says each raid is scaled by its own share only when a raid picked has an estimate" (`?range=7d&raids=kings_fall` and with Salvation's Edge), seen red before the fix — `eb2c1e3`
- [x] P3 — ADR 0009's #199 amendment and "Choosing the threshold" above: tuned on the 1-hour step, it gates all three ranges, each counting runs over its own training window — `7553262`
- [x] S1 — "over the newest hours…": `expect.poll(() => totalLine(page)).not.toMatch(ESTIMATE)` in place of the whole box's `not.toHaveText(ESTIMATE)`; deliberate break (`estimate: true` in `activitySlots`) red, reverted; recorded in `docs/e2e-coverage.md` — `eb2c1e3`
- [x] S2 — CLAUDE.md, by the orchestrator — `05bbbb0`
- [x] S3 — `DASHED_STROKE` beside `LINE_STROKE`, used by the total's and each raid's dashed path — `07799e7`
- [x] S4 — `hasEstimate(point, key)` in `activity-geometry.ts`, used by `raidPanel`, `raidsWithoutEstimate` and the tooltip's `raidLine` (which now takes the point and key); tested directly — `418bb07`
- [x] S5 — the page no longer names `MIN_RAID_CURVE_RUNS`: it passes `envCount('ACTIVITY_MIN_RAID_RUNS', undefined)` and `getCompletenessCurves`'s default is the one owner; `envCount` takes an `undefined` fallback, tested — `a54414c`
- [x] O1 — CONTEXT.md's Provisional entry: "a minimum number of runs in the past week", no figure — `7553262`
- [x] Suite at `7553262`: lint 0 errors (29 warnings), tsc app and scripts, build (inside `npm run e2e`), vitest 888/888, e2e 213/213, visual:check 68/68 (`--nobuild` on that build); `npm run mutate:diff -- 7070e76...HEAD --typecheck`, full run: 100.0% overall (91/91), 100.0% covered, PASS, no survivors, no new loop spent

## Backtest

Prod copy `data/raid-tracker.backup-2026-10-26.db` (1,884,407 raid runs, newest `ended_at` 2026-10-26 20:29 UTC), read through
a scratch copy so the backup itself was opened by nothing but a read-only `sqlite3` dump. Scripts are scratch, not committed
(`backtest.ts`, an independent mirror built on the real `tallyRun` / `curveFromTally` / `shareAt`; `replay.ts`, the shipped
`getRaidsInProgress` called at each pretend-now).

**Method.** Hourly steps (the 7-day range). Curves are relearned for each pretend-now from the training week of whole steps ending
8 days to 24 hours before it, by `ended_at`, per raid and per hour of the day, as shipped. Test steps: every step ending between
2026-10-21 00:00 and 2026-10-25 14:00 UTC (110 steps). For each, four pretend-nows put its end at exactly **15 min, 30 min, 1 h**
and **1 h 45 min** old (the Provisional window is 15 min to under 2 h, so 1 h 45 min stands for "2 h"). The estimate is compared with
the step's final value, read at the end of the data (30 or more hours later). Steps whose final value is under 1 raid in progress are
left out, because a relative error against 0.3 raids is Poisson noise, not curve error (n = 110 at every cell: no raid has fewer).
The ticket asks for "curves learned from one week, tested on later moments"; relearning each pretend-now is what ships and what
#196 did, and each curve still comes from the one week before its own moment.

**Shipped code, replayed** (`getRaidsInProgress` at each pretend-now, reading only runs already ended). Median |error| % (p90), step's
estimate against its final value. It agrees with the mirror to the digit shown for every cell compared (Last Wish 2.9 (6.3), Vow
17.4 (39.5), Insurrection 19.6 (48.2) at 15 min). 440 replays, no step missing an estimate.

| Raid | Runs in the training week | 15 min | 30 min | 1 h | 1 h 45 min |
| --- | --- | --- | --- | --- | --- |
| Last Wish | 293,328 | 2.9 (6.3) | 2.3 (5.3) | 1.4 (3.3) | 0.8 (1.7) |
| Vow of the Disciple | 41,153 | 17.4 (39.5) | 13.8 (27.5) | 8.1 (17.6) | 4.5 (8.6) |
| Vault of Glass | 40,378 | 5.2 (11.3) | 3.6 (8.8) | 2.0 (5.7) | 1.0 (2.5) |
| Root of Nightmares | 19,558 | 6.4 (16.3) | 6.2 (13.8) | 3.2 (9.1) | 2.0 (5.2) |
| Pantheon: Morgeth | 19,244 | 17.5 (34.4) | 14.7 (26.7) | 11.1 (23.2) | 8.1 (16.9) |
| King's Fall | 18,778 | 7.2 (18.8) | 6.9 (16.1) | 5.7 (15.3) | 5.5 (14.6) |
| Crota's End | 14,801 | 9.7 (23.7) | 8.1 (19.0) | 5.1 (14.2) | 3.3 (8.5) |
| Salvation's Edge | 13,120 | 10.0 (26.6) | 9.0 (23.4) | 9.4 (19.9) | 6.1 (13.7) |
| Garden of Salvation | 11,755 | 6.1 (15.6) | 4.7 (11.4) | 2.8 (8.4) | 2.1 (5.6) |
| The Desert Perpetual | 10,363 | 13.9 (31.9) | 11.5 (29.4) | 10.3 (22.3) | 6.0 (13.0) |
| Deep Stone Crypt | 9,524 | 8.2 (21.6) | 7.2 (16.2) | 4.8 (11.6) | 2.6 (5.9) |
| Pantheon: Calus | 6,828 | 17.8 (43.8) | 15.1 (38.0) | 10.2 (28.4) | 8.7 (21.7) |
| Pantheon: Insurrection Prime | 5,936 | 19.6 (48.2) | 16.1 (49.5) | 15.5 (33.3) | 12.0 (29.7) |

The same replay over the last two days only (24–25 Oct, 39 steps), when the training week has settled after the weekly reset:

| Raid | Runs in the training week | 15 min | 30 min | 1 h | 1 h 45 min |
| --- | --- | --- | --- | --- | --- |
| Last Wish | 293,328 | 2.5 (6.4) | 1.3 (3.9) | 0.9 (2.6) | 0.6 (1.7) |
| Vow of the Disciple | 41,153 | 10.8 (19.8) | 7.2 (15.6) | 4.7 (8.7) | 2.7 (6.7) |
| Vault of Glass | 40,378 | 4.5 (9.9) | 3.7 (8.8) | 2.0 (6.9) | 1.0 (3.1) |
| Root of Nightmares | 19,558 | 5.7 (17.4) | 7.4 (13.8) | 2.9 (7.3) | 1.3 (4.4) |
| Pantheon: Morgeth | 19,244 | 13.8 (22.2) | 10.9 (21.6) | 8.9 (14.7) | 5.7 (9.1) |
| King's Fall | 18,778 | 3.6 (10.7) | 3.2 (8.4) | 2.3 (5.9) | 2.0 (5.7) |
| Crota's End | 14,801 | 9.1 (22.4) | 7.5 (15.6) | 4.9 (11.4) | 2.8 (10.5) |
| Salvation's Edge | 13,120 | 12.7 (30.5) | 9.2 (28.3) | 9.7 (24.6) | 7.0 (19.6) |
| Garden of Salvation | 11,755 | 6.2 (14.1) | 4.7 (10.8) | 3.4 (7.5) | 1.4 (4.6) |
| The Desert Perpetual | 10,363 | 13.9 (26.0) | 10.6 (23.1) | 9.3 (16.0) | 6.8 (13.0) |
| Deep Stone Crypt | 9,524 | 7.8 (23.8) | 7.3 (16.3) | 4.8 (9.6) | 2.7 (6.6) |
| Pantheon: Calus | 6,828 | 10.8 (43.3) | 11.9 (34.4) | 8.2 (24.7) | 7.2 (16.4) |
| Pantheon: Insurrection Prime | 5,936 | 14.9 (41.2) | 12.7 (32.7) | 13.7 (28.0) | 9.4 (28.9) |

**Against the total's curve** (mirror, 24–25 Oct, median at 15 min / 1 h, the total's curve applied to each raid): Last Wish 17.9 / 8.6
(own: 2.5 / 0.9), King's Fall 22.7 / 11.0 (3.6 / 2.3), Salvation's Edge 23.5 / 18.8 (12.7 / 9.7), Pantheon Calus 9.7 / 5.9 (10.8 / 8.2),
Vow of the Disciple 9.2 / 4.6 (10.8 / 4.7). Median signed error of the total's curve at 15 min over 21–25 Oct: Last Wish +19%, King's Fall
-20%, Insurrection Prime -33%, Desert Perpetual -20%, Salvation's Edge -16% — short raids too high and long ones too low, as the ticket
predicts. The total itself is 3.4 (8.4) at 15 min over the same steps.

**Variants tried and dropped** (mirror): the raid's all-hours curve only, and three blends of its hour-of-day and all-hours curves
(weights 1e5, 1e6, 1e7 raid-seconds). None beat the plain per-raid, per-hour curve with the raid's own all-hours curve for an hour it
has no data in, which is what the total's curve already does and so what ships.

**Choosing the threshold.** I thinned every raid's runs at random to a fraction of prod (0.3, 0.1, 0.03, 0.01), which simulates a raid
with that many runs in every respect — training and test — and reran the mirror on 24–25 Oct. Median (p90) % error at 15 min, by the
training week's runs after thinning:

| Training-week runs | 10,000–35,000 | 5,000–6,000 | 2,800–4,000 | 900–1,900 | 300–1,200 | under 400 |
| --- | --- | --- | --- | --- | --- | --- |
| Median (p90), 15 min | 3–10 (6–22) | 7–10 (18–28) | 10–18 (39–51) | 15–44 (29–76) | 32–71 (53–207) | 31–94 (81–279) |

Examples: Vault of Glass at 11,319 runs 8.3 (17.8), Root of Nightmares at 5,728 runs 9.6 (27.7), Garden of Salvation at 5,398 runs 6.9
(17.8), Salvation's Edge at 3,857 runs 17.9 (49.9), Deep Stone Crypt at 2,768 runs 10.1 (40.6), Vault at 3,896 runs 12.4 (38.6).
At 1 h the figures are about half those at 15 min, and at 1 h 45 min a third.

**5,000 runs.** It is where the median at 15 minutes is still at or under about 10% and the p90 under about 28%, against 3.4% / 8.4% for
the total: two to three times the total's error, which is what a single raid's thinner week costs. Below it the p90 passes 40% and a
dashed line would look like a measurement it is not. 10,000 was rejected because it would drop both Pantheon raids and Deep Stone
Crypt, whose own curves are no worse than the total's applied to them; 2,500 because the p90 at 15 minutes passes 40%. Counted in
runs, not raid-seconds, because runs are what the thinning varied and what the ticket calls history. Tuned on the 1-hour step (7d) only: the same 5,000 also gates the
10-minute (24h) and 3-hour (30d) ranges, whose run counts come from their own training windows (edges rounded to each range's step),
so a raid near 5,000 runs can be estimated on one range and not on another.

**What 5,000 does not catch (the weekly-reset bias).** On this backup every raid has at least 5,936 runs in its training week, so all 13
raids have an estimate and the threshold removes none. The table's worst rows are not the thinnest raids: they are the ones the weekly
rotation moves. After the reset on 20 October, Vow of the Disciple fell from 5–8k runs a day with a median of 11–13 minutes to about 2k
a day at 7 minutes, and the Pantheon raids' lengths and volumes moved with the rotating boss. A curve learned from the week before
describes the old regime, so for a few days after a reset those raids' estimates are off: Vow of the Disciple is 17.4 (39.5) at 15 min
over 21–25 Oct and 10.8 (19.8) over 24–25 Oct, with 41,153 and 30,898 training runs, so the run count did not change but the regime
the curve described did. The all-hours-only variant, which shows the sign, over-estimated Vow by a median 21% and Pantheon Calus by
16% at 15 min, over 21–25 Oct: the new regime reports faster than the week that taught the curve. A volume threshold cannot see it; only recency weighting or a shorter training window could, and that is not
in this ticket. The dashed line is labelled an estimate, and the rotation is the weekly reset's, so the exposure is Tuesday to about
Thursday.

**Cost** (uncached `getRaidsInProgress` with all 13 raid keys, scratch copy, median of 3 warm runs, x86 WSL2, same session):

| range | `7070e76` (before) | this branch |
| --- | --- | --- |
| 24h (10 min steps) | 276 and 292 ms | 309 and 338 ms |
| 7d (1 h steps) | 479 and 489 ms | 488 and 559 ms |
| 30d (3 h steps) | 1,306 and 1,441 ms | 1,487 and 1,510 ms |

Two interleaved sessions each. The extra is the per-raid estimate arithmetic on the Provisional steps and one tally per raid in the
training pass instead of one in total (the total's tally is their sum, so each run is still tallied once): +30–50 ms, +10–70 ms and
+70–180 ms. Behind the 300 s cache, one entry per range.

## Surviving mutants

none. (Loop 1's two are above; the `queries.ts:1940` one was equivalent, so the code was simplified rather than disabled.)

## Notes

- Red runs: Vitest commits `0c34c30` and `905e72f` (red-first); Playwright 10 of 46 failed against the #198 chart, then four deliberate breaks, all recorded in `docs/e2e-coverage.md`, "#199".
- `getCompletenessCurve` is kept as a one-line wrapper over `getCompletenessCurves(...).total`; `envSeconds` and `envMs` now call the new `envCount`.
- Local only: `docs/handoffs/` was left alone. The backtest scripts and the 1.9 GB `bench.db` copy are in the session scratchpad, not the repo.
