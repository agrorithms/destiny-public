# The active-session count reports the true total, not the number of cards shown

`countActiveRaidSessions` feeds the nav StatsBar and the OG share cards, while
`/api/active-sessions` feeds the page. These deliberately no longer agree: the count reports every
live fireteam, whereas the list is capped at `ACTIVE_SESSION_DISPLAY_LIMIT`. The headline number
answers "how busy is Destiny right now", which is the question a share card and a stats bar are
actually asking; capping it to whatever happened to fit on screen would understate real activity
and undersell the site.

This is a deliberate exception to the invariant that `dedupe.ts` was written to protect — that the
count and the list collapse duplicate rows identically. That invariant still holds: both go through
`getDedupedActiveSessions`, so they can never disagree about *what a fireteam is*. Only the cap
differs.

## Consequences

- `/api/active-sessions` returns `total` (all live fireteams) alongside `shown` (those under the
  cap), so the page can disclose the difference rather than hiding sessions silently.
- A discrepancy between the StatsBar number and the visible card count is expected when the cap
  bites, and is not a bug to be "fixed" by capping the count.
- The server logs a warning whenever the cap bites, since the default (600) sits close to observed
  prod volume and the gap would otherwise be invisible.
- The StatsBar counts link to `/leaderboard` and `/active-sessions` without carrying a time range or
  clearing raid filters. The destination honours whatever view the user saved, so the same expected
  discrepancy extends to navigation: clicking "full clears · last 24h" can land a reader on their
  own saved 7-day board, and that is not a broken link.

## Amendment (2026-10-23): the count does not measure how busy Destiny is

The decision stands: the count reports every live fireteam the crawler has found, and is not capped
to the cards shown.

The premise above, that the headline number "answers how busy Destiny is right now", is withdrawn.
It is false on prod. The count is only as wide as the crawler's active-session poll, which covers
the players it polls and not every fireteam raiding. On prod the StatsBar reads ~25–35 fireteams.
Session Snapshots, which count the same poll's fireteams, sat at ~25–35 over 7 days on a prod
backup while Raids in Progress, counted from PGCRs, swung from 324 to 1,844 (r = 0.17). The count
follows the poll budget, not raiding.

Raid activity is measured from PGCRs instead; see
[ADR 0009](0009-raid-activity-is-reconstructed-from-pgcrs.md). What the StatsBar's "fireteams
raiding now" should say in light of this is its own issue and is not decided here.
