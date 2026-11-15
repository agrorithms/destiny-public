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
  its own state, and the crawler does the looking. Today that is the history-crawl request
  (`POST /api/players/queue-crawl`); a request for the crawler to poll a player is to follow.
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

The two routes that accepted posted profiles and posted identities are deleted, not fenced.

## Considered and rejected

- **Quarantine.** Store what a browser sends, tagged as unconfirmed; show it only on the profile
  page, and list it publicly once the crawler confirms it. The table would still hold rows nobody
  vouched for, and every reader of `active_sessions` and `players` would need a rule for which rows
  count. ADR 0001's cap and ADR 0002's count both assume every row came from the poller.
- **Server re-fetch.** The browser sends an id; the server calls Bungie itself before storing.
  Rows would be trustworthy at once, but any caller could make the server spend its Bungie budget,
  synchronously, on ids of the caller's choosing.

## Consequences

- A profile view has no effect on the public active-sessions list, the player search or the
  `players` table. A Fireteam a viewer sees on a profile is listed when the crawler's poll finds
  it, and removed by the crawler's re-verify; until then the profile and the list can disagree for
  a few minutes. That is the accepted cost.
- Untracked Roster members' names exist only in the viewer's browser. The crawler's own member
  resolution names them in the Tracker on a later cycle.
- The client-write surface is the routes that take ids only. They keep the same-origin and page
  token guard (`src/lib/http/request-auth.ts`) and their own rate limits.
- A name from a Bungie response is drawn as text wherever the page shows it; the browser specs
  pin that with names containing markup (`e2e/profile-roster-names.spec.ts`).
- The player read route accepts a membership id of 1 to 20 digits only.
