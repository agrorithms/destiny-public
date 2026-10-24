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
  is drawn dashed on the chart and its tooltip calls it an estimate. Launch weekends and other
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
