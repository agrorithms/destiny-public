# Browsers never write to the Tracker; they can only ask the crawler to look

The player profile page shows a player's live raid as soon as it has checked Bungie. It does that
check in the viewer's browser, with the public API key, so the server's Bungie budget stays with
the crawler and the scanner. Until #9001 the page then posted what it fetched to the server: the
raw profile response, which the server parsed and stored as an Active Session, and the names of
Roster members it had looked up, which the server stored as player identities.

Everything the Tracker serves is meant to be something the crawler observed. Data that arrives
from a browser is the browser's account of what it saw, not an observation, so the Tracker does not
store it. The rule is:

- **A browser never writes session or identity data to the Tracker.** Only the crawler writes
  Active Sessions and player identities, and only from its own Bungie calls.
- **A browser may only ask the crawler to look.** A request from a browser carries player ids and
  nothing else: no profile, no name, no claim about what it saw. The server decides what to do from
  its own state, and the crawler does the looking. One route takes such requests,
  `POST /api/players/profile-viewed`: ids and two flags (`poll`, `history`, each defaulting to true),
  nothing else.
- **Only the crawler removes an Active Session**, under ADR 0005's positive-confirmation rule. No
  request from a browser deletes a row.

## What the profile page does instead

It renders the live card from the Bungie response it already holds, for that viewer only
(`src/lib/active-session/live-profile.ts`). Roster members the Tracker knows are named by a
read-only lookup, `GET /api/players/names?ids=`, which takes at most 12 ids and writes nothing.
Members it doesn't know are looked up by the browser and named on that screen only. A private
player's raid is found by reading a stored session that contains them, then by probing up to three
public teammates from the browser. When the browser's answer and a stored row disagree, the
profile shows the browser's answer.

The routes that accepted posted profiles and posted identities are deleted, not fenced, and so is
the separate history-crawl route (#9004): a profile view sends one request.

After its live check settles, the page sends that one request, once per visit: the viewed player's
id and type and, for a private player found through a teammate, that one teammate's. It asks for
two things. The **poll** (`poll`, left out when true) is asked for when the page's own Bungie check
found a raid, or the stored baseline had a session for the viewed player; the page sends
`poll: false` when it has neither. The **history crawl** (`history`, left out when true) refreshes
the viewed player's raid history in the background, and is never queued for the teammate; the page
sends `history: false` for an account-wide-private player, whose crawl is guaranteed to fail, and
sends no request when that leaves nothing to ask. A body with both flags false, or a flag that is
not a boolean, is a 400. The server enqueues the poll with
`requestSessionPoll` (ADR 0005's crawler then re-verifies a listed row, or checks an unlisted
player, on its next cycle). The route writes no session row and no `players` row. Its limits, each
an environment knob and none keyed on the caller's address: one global limiter
(`ACTIVE_SESSION_POLL_REQUEST_GLOBAL_PER_MIN`, 60), a per-player cooldown started only by an
accepted request and keyed on the membership id alone, as the queue is
(`ACTIVE_SESSION_POLL_REQUEST_COOLDOWN_SEC`, 300), and the queue-length cap
(`ACTIVE_SESSION_POLL_REQUEST_QUEUE_MAX`, 200). A request over the global limiter or the queue cap
gets 429; a player inside the cooldown gets 200 with `recently_refreshed` and nothing enqueued, and
a player in privacy backoff is declined the same way. The page ignores every answer. The cooldown also bounds an id with no
`players` row that Bungie reports private or rejects, which the crawler can write no backoff for.
The limiter and cooldown live in each web process's memory, so under PM2 cluster x2 the effective
ceilings are up to twice the knobs (120 a minute, and a player may be accepted once per process
inside the cooldown); the queue cap is enforced in SQLite and holds across processes.

The history crawl goes into the crawler's `crawl_queue`, a separate queue drained by a different
loop at a different cost, with limits of its own, so a refusal of one kind leaves the other as it
was. A request over its global limiter (`HISTORY_CRAWL_REQUEST_GLOBAL_PER_MIN`, 60 a minute across
all callers) or its queue cap (`HISTORY_CRAWL_REQUEST_QUEUE_MAX`, 200) gets 429; a player inside the
120-second cooldown, started only by an accepted request and keyed on the membership id, or in
crawl backoff, gets 200 with `recently_refreshed` or `backing_off`. The cap counts rows a profile
view queued (`source = 'profile-view'`), not every row: the crawler's own enqueues when a session
ends are uncapped, at priority 100, and must not crowd profile views out. A player already queued
is accepted and left where they are in line. As for the poll's limits, neither is keyed on the
caller's address, and both live in each web process's memory (the 2x ceiling above). The route
answers 202 when either kind was accepted.

## Considered and rejected

- **Quarantine.** Store what a browser sends, tagged as unconfirmed; show it only on the profile
  page, and list it publicly once the crawler confirms it. The table would still hold rows nobody
  vouched for, and every reader of `active_sessions` and `players` would need a rule for which rows
  count. ADR 0001's cap and ADR 0002's count both assume every row came from the poller.
- **Server re-fetch.** The browser sends an id; the server calls Bungie itself before storing.
  Rows would be trustworthy at once, but any caller could make the server spend its Bungie budget,
  synchronously, on ids of the caller's choosing.

## Consequences

- A profile view never writes to the public active-sessions list, the player search or the
  `players` table itself. It can ask the crawler to look, and the crawler may then list a Fireteam
  or add a player it has confirmed raiding (a Tracked Player, `CONTEXT.md`) from its own Bungie
  call. A Fireteam a viewer sees on a profile is listed when the crawler's poll finds it, and
  removed by the crawler's re-verify; until then the profile and the list can disagree for a few
  minutes. That is the accepted cost.
- Untracked Roster members' names exist only in the viewer's browser. The crawler's own member
  resolution names them in the Tracker on a later cycle.
- The client-write surface is the routes that take ids only. They keep the same-origin and page
  token guard (`src/lib/http/request-auth.ts`) and their own rate limits.
- A name from a Bungie response is drawn as text wherever the page shows it; the browser specs
  pin that with names containing markup (`e2e/profile-roster-names.spec.ts`).
- The player read route accepts a membership id of 1 to 20 digits only.
