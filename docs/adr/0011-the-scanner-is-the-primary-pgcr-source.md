---
status: proposed
---

# The scanner is the primary PGCR source; the History Crawl is a backstop switched on by Scanner Lag

The Tracker finds raids two ways. The scanner walks instance ids and fetches every PGCR, one call
each; it is thorough but costs one call per PGCR. The History Crawl reads one Tracked Player's
activity history and finds several raids per call, but only for players already known. The
History Crawl came first, when the scanner could not keep up with the Leading Edge under rate
limits, and its hot/warm/cold tiers (75/15/10% of 50 players every 90s) were built for that era.

The scanner now keeps up. In the week to 2026-11-21 it stored 300,677 PGCRs, 296,415 of them within
15 minutes of the raid ending; the History Crawl stored 3,385 (1.1%), and the 1,023 of those that
arrived first would have been stored by the scanner minutes later. The History Crawl still earned
its place once: when the scanner stopped from 2026-11-03 18:31 to 2026-11-05 22:20 (about 52 hours,
reported by no heartbeat), it stored 134,764 PGCRs against the scanner's 12,125, almost all
through the hot tier.

So we decided:

- **The scanner is the primary source.** The History Crawl runs at full rate
  (`CRAWLER_MAX_PLAYERS_PER_CYCLE`) only while **Scanner Lag** (how long ago the newest raid the
  scanner stored ended) is above `SCANNER_LAG_THRESHOLD_SEC` (900). One threshold, decided each
  cycle, with no hysteresis: a cycle carries nothing over, so flapping costs nothing.
- **Its pick is recent raiders, round-robin.** Players whose `last_seen_at` falls within 48 hours of
  the newest scanner-stored raid (not of now, so an outage doesn't drain the pool), ordered by
  `last_attempt_at`, with one page count (15). The tiers, their percentages, spillover and the
  cold pick are deleted. A cold pass took about 300 days against 30-day retention, so it filled
  nothing.
- **In steady state** the History Crawl runs only for a viewed profile (ADR 0010) and a trickle of
  `CRAWLER_HISTORY_TRICKLE_PER_CYCLE` (3) players from the same pick. The trickle keeps the path
  working and its watermarks fresh for the next outage. `session_end` crawls are queued only while
  Scanner Lag is high.
- **Scanner Lag is reported**, on the admin stats page and in `/api/status`'s health verdict, so a
  stopped scanner no longer looks healthy.
- The API budget this frees is meant for session polling, but is raised separately, after a
  per-endpoint request count has measured it (see ADR 0005's note on slow polls).

## Considered options

- **Keep the tiers, gated on Scanner Lag.** Rejected: "most likely to have raided since we last
  looked" is the whole heuristic, and the tiers only approximated it.
- **Measure lag in ids, or by the scanner's own fetch delay.** Rejected: the Leading Edge isn't
  stored and "not found" can't prove it was reached; a fetch delay has no data points when the
  scanner is down, which is the case that mattered.
- **An id-directed backstop that re-walks skipped ranges.** Rejected for now: small gaps (Missed Ids
  lost on restart, ids an Id Hole crossing skips) were measured as tiny next to the outage, and
  would add new scanner state. Only the trickle catches them, more or less at random.

## Consequences

- **Bungie maintenance looks like a stopped scanner**: no raids end, so Scanner Lag grows. Maintenance
  detection has never fired in prod, so for now the History Crawl goes to full rate during
  maintenance. That is no worse than before this decision, when it always ran at full rate. The
  exemption waits on a separate fix to detection.
- `players.priority` (never written by any commit, always 0) and `idx_players_priority` lose their
  last reader and can be dropped.
