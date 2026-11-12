# Population KDA is a nearest-rank quartile triple plus an aggregate, reported under two scopes

`getRaidStats` originally reported one `avgKda` per raid — the mean of every player's
kills+assists over deaths, scoped to full clears — while `classDistribution` in the same row
counted players from *every* instance, DNFs included. The two metrics silently disagreed about
which instances contributed (issue #56).

Rather than pick a winner, scope becomes part of the response. Every scope-sensitive metric is
reported twice, under **Full Clear** and **All Attempts**, and the analytics UI toggles between
them client-side with no refetch. Scope is a dimension of the data, not a query parameter, because
this is an exploratory control on an endpoint behind a 5-minute SWR cache: making the toggle a
round-trip would thrash the cache and multiply cache keys for a payload difference of a few
numbers per raid. *(Superseded for raid stats: see the amendment of 2026-11-12, #200, under which
each scope is its own cache key and a scope switch can be a cold miss. The toggle had already
become a link in the first amendment of 2026-11-07, #204.)*

Two metrics stay outside the toggle because it is meaningless for them. `fastestClearSeconds` is
full-clear-only by definition, and `dnfRate` is degenerate under a full-clear scope — filtering to
full clears forces it to 0. A card-wide toggle would have been lying about half the card.

`avgKda` is replaced, not renamed in place, by two statistics that answer different questions:

- **KDA Quartiles** — p25/p50/p75 of the per-Player-Run KDA, by nearest rank.
- **Aggregate KDA** — `(SUM(kills) + SUM(assists)) / SUM(deaths)` over the same population.

Both are needed because they disagree, and the disagreement is the signal. Measured over the last
168h, Crota's End under All Attempts has a p50 of 24.00 against an aggregate of 45.39: the middle
player-run looks ordinary while the raid's overall economy is dominated by a minority of very
high-activity runs. A single number cannot say that.

Quartiles use **nearest rank** (`ROW_NUMBER()` picking rank `ceil(p·n)`), not linear
interpolation. Every published percentile is therefore a KDA some player actually achieved, and
the method degrades gracefully at tiny samples with no special-casing: at n=1 all three percentiles
are the single observation; at n=2 `p25 = p50 = x1` and `p75 = x2`, from which a client can
reconstruct both raw values exactly. This is why there is no minimum-sample threshold — an
interpolating method would have needed one.

## Consequences

- The response nests scope-sensitive metrics under `fullClear` and `allAttempts`; the nesting *is*
  the documentation of which metrics respond to the toggle, and the client selector is `row[scope]`.
- `kda` is `null` if and only if `sampleSize` is 0 — a raid with instances in-window but no
  Player-Runs in that scope. Every other case returns three real numbers.
- Two counts ship, in two different units, and must not be collapsed: `sampleSize` per scope
  (Player-Runs — 1,084,154 over the last 168h) and `instanceCount` per row (raid instances —
  372,810 over the same window, the denominator of `dnfRate`). This is the same units discipline as
  [ADR 0001](0001-fireteam-denominated-display-cap.md).
- **The `fullClear` scope's population is instance-level, and deliberately admits players who
  did not personally finish.** It is `p.completed = 1 AND p.activity_was_started_from_beginning
  = 1` with no per-player conjunct, so a player present for a clear they did not finish is one of
  its Player-Runs — ~16% of them. That is what separates it from the player-level predicate the
  leaderboard and player pages use, and collapsing the two onto one definition would move the
  published quartiles and class distribution. The pair is `FULL_CLEAR` / `COMPLETION` in
  `src/lib/db/queries.ts`, pinned by `tests/db/full-clear-predicates.test.ts`.
- **Two different zero-death guards coexist in one query, deliberately.** The quartiles use
  per-row `MAX(deaths, 1)`, since a single flawless Player-Run would otherwise divide by zero. The
  aggregate uses `MAX(SUM(deaths), 1)`, which fires only if *every* Player-Run in a raid and scope
  had zero deaths — effectively never. Collapsing them into one guard changes both statistics.
  Under a median the per-row fudge is harmless in a way it was not under the old mean: a flawless
  40-kill run scores 40 and skewed the mean, but moves a rank statistic by one rank.
- Every scope-sensitive statistic is intended to be displayed with its sample size adjacent and
  muted; below three Player-Runs the count is expected to replace the chart. The API supplies the
  numbers unconditionally — the display treatment is #51's to implement.
- The datum is the **Player-Run**, currently approximated by the player's *first-observed
  character*: `pgcr_players` has PK `(instance_id, membership_id)` and inserts with
  `INSERT OR IGNORE`, so for the ~0.5% of PGCRs with multiple character entries per player, the
  later characters' kills/deaths/assists are dropped. This is inherited from the old `avgKda`, not
  introduced here, and a rank statistic absorbs it better than a mean did. Issue #43 makes the
  datum exact; it is a refinement, not a prerequisite.

## Cost, measured

Against the live database (2.5 GB) over a 168h window — 1,084,154 Player-Runs across 372,810 raid
instances. Three runs each, interleaved so no query gets an unfair page-cache advantage:

| query | runs (ms) |
|---|---|
| old `avgKda` (mean of ratios), full-clear | 404 / 364 / 383 |
| old `classDistribution`, all rows | 1511 / 1374 / 1401 |
| new CTE — quartiles + aggregate, Full Clear scope | 972 / 898 / 883 |
| new CTE — quartiles + aggregate, All Attempts scope | 3692 / 3412 / 3438 |

So roughly **1.8 s today against 4.3 s after** — about 2.4x, per cache key, for four statistics
instead of two. Note the Full Clear CTE is *faster* than the `classDistribution` query it partly
replaces: the cost tracks population size, not the window function. All Attempts is expensive
because it ranks all 1.08M Player-Runs; Full Clear ranks a small fraction of them.

**Amendment (2026-08-29), after the follow-up cleanup.** The table above measured only the two new
CTEs against the two queries they replaced; the shipped endpoint also ran a scalar query and *two*
`classDistribution` queries (one per scope), so the real cold-miss cost was higher than the 4.3 s
row-sum suggests. The cleanup folded the class counts into each scope's CTE via `json_group_object`
over the same `runs` population, marked `runs` as `MATERIALIZED` (SQLite was re-evaluating the
`pgcrs` join once per CTE reference), precomputed the three nearest-rank positions in `totals`, and
filtered the rank join to `r.rn IN (t.r25, t.r50, t.r75)`. Four statements became two, and the base
join now runs once per scope instead of three times. Verified byte-identical output across all 25
raid/scope pairs; measured on the 2026-08-23 backup (818 MB, 89,502 Player-Runs over 168h): Full
Clear 91 ms → 61 ms, All Attempts 397 ms → 305 ms, both including the class counts. That database is
~12x smaller than the one the table above was measured against, so read the ratio, not the absolute
numbers — and the live figures in the table have not been re-measured since.

The aggregate contributes almost none of this — it is three `SUM()`s over a CTE already being
materialised. The sort is the cost: `ORDER BY kda` ranks a computed ratio, so SQLite cannot use the
covering index `sqlite_autoindex_pgcr_players_1` that serves the current queries, and falls back to
row lookups plus a sort of the whole scope.

This is accepted. better-sqlite3 is synchronous, so the compute blocks its PM2 worker's event loop
for its duration, but `swr-cache` runs stale and warmed revalidations in the background — only a
cold miss awaits it, and at this site's traffic (~5 visitors/day, 2 workers) a ~4 s stall on a
worker restart or a first-time filter combination is a non-event. It is also only ~2.4x a stall the
endpoint already had.

**The cheap next move, if it stops being one.** *(Shown not to work as written: see the second amendment of 2026-11-07, #227.)* If #51's charts make this endpoint hot, or the
filter matrix multiplies cache keys enough that cold misses stop being rare, add a stored generated
column for the per-row KDA on `pgcr_players` and index it, so the rank can be served from an index
instead of a sort. That is a schema migration plus a backfill, and it leaves every query shape and
all four statistics unchanged — which is why it is the first thing to reach for, ahead of a
precomputed rollup table (which adds a writer, a staleness window, and a new crawler
responsibility) or splitting the scopes into separate cache keys (which would undo the no-refetch
toggle this ADR is built around; *since done for raid stats: see the amendment of 2026-11-12, #200*). The trigger to watch is cold-miss frequency, not absolute query
time: the gap is only visible on `X-Cache: MISS`, and it is concentrated entirely in the All
Attempts scope.

These timings scale with retained data. `CRAWLER_CLEANUP_BATCH_SIZE` and the PGCR retention window
set how many Player-Runs a 168h query ranks; a retention increase moves the All Attempts number
first.

## Amendment (2026-11-01): the board that reads this endpoint (#200)

The first reader of `getRaidStats` is the Raid Stats tab on the Raid Activity page (#200), and
building it changes three things this ADR said.

- **There will be three scopes, not two.** #204 puts one choice on the Raid Activity page: All
  Attempts, Fresh Runs, Full Clears, each a subset of the one before. `getRaidStats` gains a Fresh
  Runs scope between the existing two. The nesting rule above still holds: the response nests the
  scope-sensitive metrics, and the nesting is the documentation. Fresh Runs is a statement about
  how a run *began*, so a Fresh Run nobody finished is in it.
- **Clear Time Quartiles join `fastestClearSeconds` outside the toggle**, for the reason that
  put it there: a duration means something only for a Full Clear. Narrowing them to Fresh Runs or
  All Attempts would publish a typical clear time that includes runs nobody cleared. The datum is
  the instance, not the Player-Run, and the method is the same nearest rank.
- **`dnfRate` is not displayed.** On this site most instances are Checkpoint Runs, so it reads
  as "this raid is hard" and means something else. The API keeps it. A rate over Fresh Runs only,
  which is the Reset share, is a separate ticket.

**The "non-event" reasoning above no longer holds at 30 days.** The board offers 24h, 7d and 30d.
Measured 2026-11-01 on a copy of that day's backup (2.09 GB, 13 raids), x86, `getRaidStats` end to
end, three runs each:

| window | Player-Runs (All Attempts) | ms |
|---|---|---|
| 24h | 175k | 1386 / 717 / 613 |
| 7d | 1.08M | 5133 / 4760 / 4667 |
| 30d | 5.20M | 27726 / 24700 / 25876 |

Cost tracks Player-Runs, so 30d is about 5x 7d. On the ARM box the earlier ~2x factor puts a 30d
cold miss near 50 s of blocked event loop; that is an estimate, not a measurement. It stays well
under the 10-minute active-session watchdog (ADR 0005), but a worker that cannot answer for 50 s
looks hung. The "cheap next move" above is therefore taken before the board ships: a separate
ticket adds the stored generated KDA column and index, and #200 is blocked on it.
Success is a 30d All Attempts miss near the 7d figure above; if the index does not get there, the
fallback is to drop 30d on this tab.

## Amendment (2026-11-07): the toggle is a link, the dimension stays (#204)

This ADR put scope in the response so "the analytics UI toggles between them client-side with no
refetch". The Raid Activity page, and #200's Raid Stats tab on it, are server-rendered and hold the
scope in the URL (`?scope=all|fresh|full`) so it works with JavaScript off and survives a shared link,
so choosing a scope is a navigation, not a client-side swap. The reason behind the original wording still
holds and is the part that matters: **scope is a dimension of the cached value, not a cache key.** A
scope switch re-renders from the entry already cached for that range and adds no key or cold miss.
Raid Activity's own series follows the same rule (ADR 0009, amendment 2026-11-07).

## Amendment (2026-11-07): the cheap next move doesn't work (#227)

Grilling #227 found that the stored generated KDA column can't do what "the cheap next move" above
promised, so the 2026-11-01 amendment's plan to take it before #200 ships is withdrawn. In its
place, **30d on the Raid Stats tab shows Full Clears only**, served through a widened `pgcrs` index
(the decision is at the end of this amendment). Keeping All Attempts and Fresh Runs at 30d is
#238's question.

Measured on `data/raid-tracker.backup-2026-11-05.db` (2.07 GB, 1.87M PGCRs, 5.20M `pgcr_players`
rows), x86, read-only through better-sqlite3 (SQLite 3.51.2). Each window ends at the backup's
newest `ended_at`, not at the time of the run. Two runs each. These time the scope statement
(`queryScope`'s SQL) and the scalar query on their own, not `getRaidStats` end to end.

All Attempts at 720h (5,124,713 Player-Runs), broken into pieces:

| piece | ms |
|---|---|
| the join alone (window filter, per-row KDA) | 13,628 cold / 3,941 warm |
| join + `ROW_NUMBER() OVER (PARTITION BY raidKey ORDER BY kda)` | 9,506 / 9,974 |
| the whole scope statement as shipped | 17,959 / 19,697 |
| a one-pass reshape (rank and count in one window pass, quartiles only) | 12,597 / 11,542 |

The plan shows where the sort happens:

```
MATERIALIZE runs
  SEARCH p USING INDEX idx_pgcrs_raid_ended (ANY(raid_key) AND ended_at>?)
  SEARCH pp USING INDEX idx_pgcr_players_instance_completed_member (instance_id=?)
MATERIALIZE ranked
  SCAN runs
  USE TEMP B-TREE FOR ORDER BY
SEARCH r USING AUTOMATIC COVERING INDEX (raidKey=?)
```

Three things follow, and each one alone is enough to sink the column:

- **No index on `pgcr_players` can serve this sort.** The `ORDER BY kda` runs over `runs`, a
  materialised temporary table, and is partitioned by `raid_key`, which lives on `pgcrs`. An index
  on a KDA column of `pgcr_players` isn't visible at the point where the sort happens.
- **The sort is about a third of the cost.** The join alone is ~4 s warm and ~14 s cold. Taking
  the sort away entirely would still leave a 30d All Attempts miss well above the 7d figure.
- **SQLite can't add a `STORED` generated column with `ALTER TABLE ADD COLUMN`**, only a `VIRTUAL`
  one. Taken literally, the column means rebuilding `pgcr_players`, which can't be done in batches
  with the crawlers up.

Reshaping the query without a schema change (the last table row) saves less than half.

**Cost by scope.** Cost still tracks Player-Runs in scope, so narrowing the scope is the lever that
works. Same backup, the scope statement with the given predicate, warm:

| scope | window | Player-Runs | scope statement (ms) |
|---|---|---|---|
| Full Clears | 168h | 222,836 | 756 / 733 |
| Fresh Runs | 168h | 437,929 | 1,452 / 1,394 |
| Full Clears | 720h | 968,587 | 3,703 / 3,804 |
| Fresh Runs | 720h | 2,152,720 | 8,621 / 7,863 |
| All Attempts | 720h | 5,124,713 | 17,959 / 19,697 |

The scalar query (instance count, fastest clear, DNF rate) is ~0.9 s warm at 720h and ~0.17 s at
168h. A 30d Full Clears statement plus the scalar query is ~4.7 s warm, close to the 7d
`getRaidStats` figure in the 2026-11-01 amendment (4.7–5.1 s). That was a different backup and
both scopes end to end, so it is a rough comparison only. Cold, they are not close: the first 720h Full Clears
join took 13,910 ms, because the scope predicate reads `completed` and
`activity_was_started_from_beginning` from the `pgcrs` table, which `idx_pgcrs_raid_ended` doesn't
cover. That is the same index gap #204 opened on the Raid Activity sweep (amendment 2026-11-07
above).

**The widened index, measured cold.** Same backup, on a scratch copy, x86. "Cold" means the copy's
pages were evicted from the OS page cache (`posix_fadvise(DONTNEED)`) before each run; the ARM box's
block volume will differ. 720h, Full Clears scope statement and the scalar query, three cold runs
and two warm:

| `pgcrs` index | scalar, cold | Full Clears, cold | Full Clears, warm |
|---|---|---|---|
| as today | 1,988 / 1,537 / 1,549 | 17,363 / 17,101 / 16,523 | 4,465 / 3,796 |
| V1: `(ended_at, period, raid_key, completed, activity_was_started_from_beginning)`, forced | 1,048 / 921 / 926 | 9,123 / 9,281 / 9,155 | 3,135 / 3,136 |
| V2: V1 + `instance_id`, forced | 908 / 878 / 930 | 8,495 / 8,376 / 8,301 | 2,986 / 2,923 |

Output was identical in every variant (same row hashes). V1 replaced `idx_pgcrs_ended_period_raid`
in 1.4 s for +3 MB; V2 cost +22 MB more for ~0.8 s. The ~8–9 s left cold is the `pgcr_players` side
(random lookups for kills, deaths, assists and class), which no `pgcrs` index reaches. **Unforced,
the planner ignored both**: it kept `idx_pgcrs_raid_ended (ANY(raid_key) AND ended_at>?)`, steered by
`sqlite_stat1`, which the backup copies from prod and which counts 2.66M `pgcrs` rows against 1.87M
held and has no row for a new index.

**Decided (2026-11-07, #227):**

- **30d is Full Clears only** on the Raid Stats tab. Narrowing the population is the one lever
  that works without a schema change: 969k Player-Runs instead of 5.1M. The rule lives in the
  query module, not the UI or the route, because the route accepts any `hours` from 1 to 720:
  above 168h `getRaidStats` computes only `fullClear`, and the other scopes come back `null`,
  meaning "not computed for this window". That is a different thing from an empty scope, so the
  invariant above still holds as written: `kda` is `null` if and only if `sampleSize` is 0, inside
  a scope that was computed.
- **V1 replaces `idx_pgcrs_ended_period_raid`**, built at open in `schema.ts` as that index already
  is, with no maintenance script. It is the same widening #204 needs to keep its sweep covered once it
  reads the two flags, so one index serves both. V2's gain doesn't pay for its size.
- **The scalar query and the narrowed scopes name it with `INDEXED BY`**, because prod's statistics
  steer the planner away from it. All Attempts keeps the planner's choice: it filters on neither
  flag, and forcing V1 measured slightly slower (168h cold, two runs each: 5,288 / 4,989 ms
  unforced, 5,823 / 6,364 ms forced; warm 3,291 against 3,346). At 168h V1 took Full Clears from
  3,954 / 3,924 to 2,060 / 2,091 ms cold (warm 765 against 667) and the scalar query from ~440 to
  ~190 ms. Fresh Runs filters on one flag; whether it is forced is #200's to measure. Not `ANALYZE`, which would re-plan every query on the site from statistics nothing
  tests; not a unary `+` on `raid_key`, which says the same thing less plainly.
- **No warmer.** A 30d miss is ~9 s cold on x86 and, by the ~2x estimate, ~18 s on ARM. At this
  traffic most 30d visits will be cold misses (the entry lives 30 minutes, per worker), and that is
  accepted for now. A warmer like the leaderboard's would make every visit warm at the cost of a
  ~4 s block per worker per refresh, whoever is visiting; it is the next step if the wait proves
  to matter.

## Amendment (2026-11-12): raid stats are cached per scope, and a miss pauses (#200)

The Raid Stats tab (#200) is the first reader of `getRaidStats`, and it changes two things the
amendments above said. **For raid stats only**: Raid Activity's chart still computes all three
scopes in one sweep and caches them as one value per range (ADR 0009), and nothing here touches it.

- **Scope is a cache key for raid stats.** The 2026-11-07 (#204) amendment kept scope a dimension
  of one cached value. With Fresh Runs added, that value means three scope statements back to back
  on every cold miss, and better-sqlite3 runs them on the request's thread: about double the wait
  of the one scope the tab shows. So the work is cut into a **frame** (the scalar query and the Clear
  Time Quartiles, everything the toggle doesn't move: `getRaidStatsFrame`) and one entry per scope
  (`getRaidScopeStats`), each cached on its own on the analytics lifetime
  (src/lib/cache/raid-stats-cache.ts, keys `raid-stats:frame:{hours}` and
  `raid-stats:{scope}:{hours}`, plus the route's filters). The tab computes the frame and its
  scope only; `/api/analytics/raid-stats` composes all four pieces and shares the entries. The cost
  is the one the original decision named: a scope switch on the stats tab can now be a cold miss.
  It is accepted because the tab shows one scope at a time, and a switch costs that scope alone.
- **A miss pauses 100 ms before its query** (`RAID_STATS_MISS_PAUSE_MS`). The tab streams (two
  `Suspense` boundaries in the page), and a blocking query that starts at once leaves Next no free
  turn of the event loop to flush what is already rendered. In the 2026-11-12 prototype (#200's
  comment), nothing reached the reader until every query was done with no pause or one of 5 ms or
  less; 10 ms was borderline and 20 ms worked on every run. 100 ms is headroom, and costs nothing
  beside queries of seconds. The pause is inside the compute function, so a cache hit never
  pauses, which is also what puts a warm board in the first HTML. A stale entry's background
  refresh pauses too, harmlessly.

Three smaller results, measured on a scratch copy of `data/raid-tracker.backup-2026-11-05.db`, x86,
cold meaning the file evicted from the page cache (`posix_fadvise(DONTNEED)`, checked with
`fincore`). The tables are in docs/progress/200-raid-stats-tab.md.

- **Fresh Runs keeps the planner's choice**, the question the second 2026-11-07 amendment left to
  #200. Forced onto `idx_pgcrs_ended_period_raid_clear`, its 168h scope statement was about 0.6 s
  faster cold on the means (unforced 7,828 / 7,236 / 4,325 ms, forced 6,879 / 4,720 / 5,969 ms),
  inside run-to-run spread of 2–3.5 s, so it is not forced.
- **7d All Attempts, the default view, frame plus scope cold:** 10,487 / 8,500 / 10,572 ms in a
  first set, on a day the machine ran 1.2–2x slower than the 2026-11-07 figures above for the same
  statements on the same backup, and 5,345 / 5,290 / 8,682 ms in a second set 40 minutes later.
  Accepted (user, 2026-11-12). Defaulting the tab to Full Clears, or prefetching All Attempts, is
  #245's question.
- **Streaming at 30d, on a running server:** the header reached the client at 30–46 ms, Clear Time
  at 1.7–3.7 s and KDA at 11.6–20.6 s, in that order every run. On a freshly started server's first
  request, loading the route's code outlasted the pause in two of three runs and the header arrived
  with Clear Time.
