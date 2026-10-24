# Raid activity is reconstructed from PGCRs, not Session Snapshots

The Raid Activity page (#51) charts how busy raiding was over time. It counts **Raids in
Progress**: how many raid instances were under way at each moment, reconstructed from their PGCRs
once those raids have ended. For the most recent moments, whose raids have not all ended, it shows a
**Provisional** estimate. It does not read **Session Snapshots**, although they have been recorded
since #32 so that this history could build up, and are the obvious source.

Measured on a prod backup on 2026-10-23, Session Snapshots say almost nothing about how busy
raiding is. A chart built on them would be wrong and would look right, so this records the
measurements before any code depends on them.

## Why not Session Snapshots

A Session Snapshot is recorded each time the crawler polls for Active Sessions, and counts the
fireteams that poll found. It is only as wide as that poll: it counts the fireteams of the players
polled that cycle (`CRAWLER_SESSION_POLLING_LIMIT`), not every fireteam raiding. Its level follows
the poll budget, not activity.

On prod, over 7 days at hourly resolution:

- A Session Snapshot's raid fireteam count sat flat at **~25–35** around the clock, while Raids in
  Progress swung from **324 to 1,844**, with clear daily and weekend cycles.
- The Pearson correlation between the two is **r = 0.17**.
- The only event that shows in both is the weekly-reset maintenance window (2026-10-20, 16–17
  UTC).

The poller can't be widened enough to fix this. It covers about **150 players a minute**. Even
polling the whole candidate pool (**12,062 players**) at one sample moment would have found only
**68%** of the **942** raid instances running then, and doing that every cycle would take about
**40 requests/s** against a key budgeted at 25 rps.

PGCRs don't depend on who was polled. On prod they are **70% scanner-sourced**, and the scanner
walks instance ids in order rather than following players, so they cover close to every raid
instance on Bungie. They are fetched soon after the instance ends: **p50 0 min, p99 15 min**.

- *2026-10-24 (#196):* that fetch delay held for **16–23 October** (daily median of `fetched_at -
  ended_at` about 28 s, 1% over an hour). It did not before: the scanner was hours behind through
  15 October (daily median 8 min on the 8th, 47 min on the 10th, 92 min on the 11th, 162 min on the
  13th, 14 min on the 15th). The delay is operational, not a property of raids, which is why the
  completeness curve below is learned from `ended_at`.

## Decision

- Raid activity over time is **Raids in Progress, counted from PGCRs**. Every raid instance counts
  (All Attempts): Fresh Runs and Checkpoint Runs, finished or not.
- A moment's count is complete only once every raid running at that moment has ended. On prod a
  moment 1 hour old is ~79% complete and one 2 hours old is ~93%. A step is drawn as counted once
  its end is 2 hours old: ~93% of its raids have ended by then, and the rest are added as their
  PGCRs arrive. Counted data therefore ends at a step boundary, between 2 hours and 2 hours plus
  one step back. Everything from that boundary down to **15 minutes** old is **Provisional**: the
  count from raids that have already ended, divided by the share of raids that have usually ended
  by that age. That share is a completeness curve learned from the last 7 days of moments old
  enough to be complete, separately for each hour of the day. Nothing is reported for moments
  under 15 minutes old.
- **Session Snapshots keep being recorded.** They are cheap, and they are the only record of what
  `/active-sessions` listed at a given moment. Nothing should read them as a measure of activity.

### The Provisional backtest

Curves learned from Oct 15–20 and tested on 125 half-hourly moments from Oct 21–23. Median error
for the total:

| Age of the moment | 15 min | 30 min | 1 h  | 2 h  |
| ----------------- | ------ | ------ | ---- | ---- |
| Hour-of-day curve | 5.2%   | 3.4%   | 1.6% | 0.8% |

For comparison: the uncorrected partial count is 20–57% low, a scaled Session Snapshot is 30% off,
and "same time last week" is 13.6% off. A single curve for every hour of the day has about twice the
error of the hour-of-day curves.

#### As built (#196), 2026-10-24

The shipped curve is learned from **whole steps of the range's own size** (10 minutes, 1 hour,
3 hours), not from instants, with a step's age measured to its end. That is what makes "age to the
step's end" correct: a curve of instants read at a coarse step's end age is 35% off at 1 hour and
57% at 3 hours, because most of a long step is older than its end. Averaging an instant curve over
each step's instants agrees with the step-size curve to within 0.1 points at 10 minutes and 1 hour
(1 hour, 15–30 minutes: 1.9% against 1.8%; the 3-hour rows have too few steps to separate), so the
step-size curve was chosen for being the simpler to state and test.

- **Training:** steps whose end is between 8 days and 24 hours old, per hour of the day (the step's
  midpoint hour), shares every 5 minutes up to 2 hours (a Provisional step's end is always under
  2 hours old), interpolated linearly. An hour with no data uses the all-hours curve; no data at all
  means no estimate; a share of 0 ends the estimate at that step, so it and every younger step are
  left out and the dashed line is never drawn across a gap. 24 hours is the bound for "complete":
  6, 12, 24 and 48 hours gave the same error to within 0.2 points.
- **From `ended_at`, never `fetched_at`.** A curve that learned fetch delay over a week containing the
  scanner's backlog (8–15 October) over-estimated a normal day by 20–65% (median error 20–52%). A
  curve from `ended_at` is unaffected by the scanner, at the price of ignoring the delay that
  remains: against what had actually been fetched at each pretend-now, estimates run 2–4% low at
  15–30 minutes.
- **Estimates target the step's final value.** A step read exactly 2 hours after its end is 7.5%
  (10-minute steps), 5.7% (1 hour) and 3.9% (3 hours) below its final value, so the dashed line
  sits 4–8% above the last counted steps, which are still being filled in. The chart's legend says so.

Median |error| % (p90) of a Provisional step against its final value, by how old the step's end is.
Curves relearned for each pretend-now from the 2026-10-23 backup, tested at pretend-nows between
19 and 22 October (final values read 26+ hours later). **Shipped code** replays the query at each
pretend-now, which reads only runs already ended; **fetched** uses a mirror script that reads only
what had been fetched by then, the production condition:

| Step | Age of the step's end | Shipped code, replay | n | Fetched by then | n |
| --- | --- | --- | --- | --- | --- |
| 10 min | 15–30 min | 3.2 (8.5) | 87 | 4.5 (10.6) | 346 |
| 10 min | 30–60 min | 1.5 (4.3) | 174 | 2.3 (6.6) | 693 |
| 10 min | 1–2 h | 1.1 (2.7) | 350 | 1.0 (2.6) | 1386 |
| 1 h | 15–30 min | 1.8 (4.2) | 17 | 1.8 (5.5) | 58 |
| 1 h | 30–60 min | 1.0 (2.1) | 27 | 1.3 (3.5) | 115 |
| 1 h | 1–2 h | 1.0 (2.2) | 58 | 0.8 (1.9) | 231 |
| 3 h | 15–30 min | 1.3 (1.3) | 2 | 0.4 (2.2) | 20 |
| 3 h | 30–60 min | 1.7 (1.7) | 2 | 0.8 (2.0) | 37 |
| 3 h | 1–2 h | 0.5 (0.9) | 7 | 0.6 (1.8) | 79 |

A single week of one prod backup. The mirror script and the real functions agree to 1e-15 on the
points they share and exactly on the curve's shares.

**Why this table isn't in the form of #51's.** #51 measured instants, at four ages, against one curve
of instants. The shipped curve is one per step size, with age measured to the step's end, so a
Provisional step's end is always under 2 hours old: there is no 2-hour figure, and each row is a band
of ages rather than one age. The pretend-nows differ too (19–22 October here, 21–23 October in #51).
The 10-minute rows are the nearest to #51's instants, and each band's median is below #51's figure at
the band's younger end: 3.2% at 15–30 minutes against 5.2% at 15 and 3.4% at 30; 1.5% at 30–60
minutes against 3.4% and 1.6%; 1.1% at 1–2 hours against 1.6% and 0.8%. The 3-hour rows of the
shipped-code replay rest on 2, 2 and 7 steps (20, 37 and 79 in the fetched run): too few to compare.

## Alternatives rejected

- **Session Snapshots alone.** r = 0.17. The line would sit flat while raiding varied more than
  fivefold.
- **Session Snapshots scaled** by a ratio to Raids in Progress. The ratio isn't stable: it ran from
  10× to 60× over the week on prod, and a scaled snapshot is 30% off at the median.
- **Session Snapshots joined onto PGCRs at the trailing edge**, using the snapshot for the last two
  hours where PGCRs are incomplete. The snapshot sees only the poll's slice of the raids still
  running, at a level set by the poll budget, so it would have to be scaled to meet a series at
  300–1,800. That is the scaled option again, at the seam, with its 30% error. The completeness
  curve does the same job with a median error of 5.2% at 15 minutes.
- **More poller budget.** Polling every candidate still misses a third of the instances running
  (68% ceiling), costs ~40 rps against a 25 rps key, and the candidate pool only contains players
  already tracked. PGCRs reach the instances the poller never could, at no extra request cost,
  because the scanner already fetches them.

## Consequences

- **The trailing two hours or more (up to one step beyond) are an estimate, and the chart has to
  say so.** The Provisional segment
  is drawn dashed on the chart and its tooltip calls it an estimate. *2026-10-24 (#196):* the dashed
  line runs from the last counted point to the last step 15 minutes old; the 15 minutes after it
  (plus up to one step) are shaded "too recent to estimate". Launch weekends and other
  sudden shifts in run length aren't special-cased.
- **The chart moves only when raiding does.** Retuning the crawler's poll budget changes Session
  Snapshots and leaves Raids in Progress alone.
- **The range is bounded by PGCR retention** (`CRAWLER_CLEANUP_MAX_AGE_HOURS`, 720 h on prod). The
  window can't start earlier than the data.
  - *2026-10-23 (#195):* the bound is read from the data, not from that setting: counting starts
    at the first step **6 hours after the oldest stored PGCR began** (`DATA_START_MARGIN_SECONDS`),
    and the chart shades the span before it as "no data". The web process doesn't see the
    crawler's env (whose two defaults disagree, 48 h and 720 h), and on the 2026-10-23 backup the
    data reached 8.3 h past the 30-day bound. The margin is there because cleanup deletes by
    *start*: a moment just after the oldest kept PGCR is missing every run that started before it
    and was still going. Measured on that backup over 80 moments, runs that had started more than
    X hours earlier were this share of a moment's Raids in Progress:

    | X                | 2 h   | 3 h  | 4 h  | 6 h  | 12 h | 24 h  |
    | ---------------- | ----- | ---- | ---- | ---- | ---- | ----- |
    | mean             | 7.7%  | 3.5% | 2.2% | 1.5% | 1.1% | 0.75% |
    | worst moment     | 12.9% | 7.1% | 5.4% | 4.0% | 3.6% | 2.7%  |

    The tail is runs lasting days (138 over 24 h, the longest 310 h), so no margin makes the first
    step exact; past 6 hours each extra hour buys little. Reading the bound from the setting
    instead would cut data that is there, and break whenever the web and crawler disagree on it.
- **A scanner hole looks like a quiet period.** Ids skipped when Discovery moves the Scanner
  Position ahead leave a gap that PGCRs alone can't tell apart from low activity. A scanner outage
  is filled in when the scanner catches up; a maintenance window is a true zero.
- **ADR 0002's premise is withdrawn.** The active-session count does not answer "how busy is
  Destiny right now" on prod. Its decision, not capping the count to the cards shown, stands. See
  the amendment there.
- **The session-history endpoint** (`src/app/api/analytics/sessions/route.ts`) keeps serving
  Session Snapshots unchanged, with a comment pointing here.
- **Measure coverage on a prod backup, never the local dev DB.** The dev DB's scanner barely ran:
  its PGCRs are 95% crawler-sourced and arrive about 12 hours after the instance ends, and Raids in
  Progress there is only 5–9× the snapshot count instead of 10–60×. The coverage and delay figures
  above would come out wrong against it.
