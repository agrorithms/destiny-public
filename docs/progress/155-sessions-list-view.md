# #155 — Active sessions: list view, Fireteam Leader rows, join code, collapsible raids, size filter

Spec: `gh issue view 155` (its Implementation Decisions, Testing Decisions and Out of Scope are
authoritative). Tickets #156–#161 are its sub-issues and land in that order. Design reasoning and
rejected alternatives: `docs/handoffs/261012-active-sessions-list-view.md` (untracked — never
commit it). Briefing from the peer session `orchestrate-sessions-ui-261012`.

Seams, agreed in the design session (recorded in the handoff's "Test seams"):
1. the page, through Playwright — the main seam;
2. one pure, browser-safe Roster-rules module through colocated Vitest tests (from #157 on);
3. a test-helper-only change to `seedFireteams` (leader seat, from #157 on).

Out of this effort: #153 (tile-view leader marker, status-dot bug, tile-view copy button),
#154 (fetch race), anything from the `active-sessions-transitions` branch.

## #156 — group raid sections by `raidKey`, fixed order

Branch `feat/156-sessions-fixed-order`.

1. Fixed order, red then green
   - [x] `e2e/support/seed-world.ts` — two raids no other spec seeds, plus two unlisted raid keys sharing the name "Raid"
   - [x] `e2e/active-sessions-order.spec.ts` (new) — fixed order beats fireteam count; unlisted key last; namesakes stay apart
   - [x] `src/app/active-sessions/page.tsx` — group by `raidKey`, order by `AVAILABLE_RAIDS`
2. Bookkeeping
   - [x] `CLAUDE.md` — e2e flow list
   - [x] `docs/e2e-coverage.md` — flow list, fixture prefix `86`, journal entry
   - [x] `docs/progress/155-sessions-list-view.md` (this file)

## #157 — list view default, List | Tiles toggle, Fireteam Leader rows

Branch `feat/157-sessions-list-view` (from `352d9dd`, so all of #156 is in it).

1. Roster rules, red then green (Vitest)
   - [x] `src/lib/active-session/roster.test.ts` (new) — leader by bit 8, no leader → tracked player, raw ID → "Unknown player"
   - [x] `src/lib/active-session/roster.ts` (new) — pure, browser-safe; imports nothing from the database
2. Seed helper and specs, red against the tile-only page
   - [x] `e2e/support/seed-world.ts` — `leaderSeat` option on `seedFireteams` (status 9), a raid of the list spec's own
   - [x] `e2e/active-sessions-list.spec.ts` (new, prefix `87`) — list default, toggle + reload, tooltips/aria, row content, row order, phone width
   - [x] `e2e/active-sessions-cap.spec.ts` — count list rows inside the Salvation's Edge section
   - [x] `e2e/player-names.spec.ts` — the seeded leader's `Name#Code` in the row title
3. List view and the toggle (green)
   - [x] `src/hooks/useSessionsView.ts` (new) — List | Tiles preference in localStorage, List by default
   - [x] `src/components/SessionsViewToggle.tsx` (new) — one rounded control, two inline-SVG halves
   - [x] `src/components/FireteamRow.tsx` (new) — "`Name#Code`'s fireteam", player count, elapsed time
   - [x] `src/components/ActiveSessionCard.tsx` — export `getElapsedTime` (tile rendering unchanged)
   - [x] `src/app/active-sessions/page.tsx` — toggle, list by default, sections as labelled regions
4. Bookkeeping
   - [x] `docs/e2e-coverage.md` — flow list, prefix `87`, tile view's lost coverage (#153), journal entry
   - [ ] `CLAUDE.md` — e2e flow list (see notes: proposed text, not edited from a peer request)
   - [x] `docs/progress/155-sessions-list-view.md` (this file)

## Notes

- #156: sections group by `raidKey` and sort by their index in `AVAILABLE_RAIDS`
  (`RAID_SECTION_ORDER` / `raidSectionRank` in `page.tsx`); unknown keys share one rank and fall back
  to key order, so they don't move between polls either. The heading still comes from the API's
  `raidName` (unchanged text), taken from the section's first session. A `null` key from the API
  groups under `''`.
- #156 verified: lint 0 errors (29 pre-existing warnings, all in `gos10k/`), build, tsc, `npm test`
  539/539, `npm run e2e` 98/98.
- #156 simplify pass (separate commit): `ORDER_*_RAID` typed `FixtureRaid` like the unlisted ones,
  the group-by loop does one `Map.get` instead of `has`/`set`/`get!`, spec docblock says four
  rosters. No behaviour change. Re-verified: lint 0 errors (29 warnings, `gos10k/`), build,
  `npm test` 539/539, `npm run e2e` 98/98.
- #156 review pass (separate commit, review findings S2 and S3): the unlisted-raid-last spec now
  checks that the *first* "Raid" heading comes after every other heading, since both unlisted
  raids share that name and `at(-1)` alone missed one of them sorting high. Proved red by
  temporarily ranking only `e2e_unlisted_namesake_raid` first: the old assertion passed, the new
  one failed. `seedPlayerWithSession`'s `raid` option takes `FixtureRaid`; RAID_A/RAID_B keep
  `as const` for FASTEST_CLEARS's literal keys. No app code changed. Re-verified: lint 0 errors
  (29 warnings, `gos10k/`), build, tsc, `npm test` 539/539, `npm run e2e` 98/98.
- #157: `roster.ts` is the browser-safe Roster-rules module (`findFireteamLeader`, `fireteamTitle`);
  it imports nothing. Raw-ID test mirrors the route's `isLikelyMembershipId` (16+ digits), plus an
  empty name or one equal to the member's own ID. #158 adds the member-set helpers to it.
- #157: the view preference is `useSessionsView` (key `destiny-farm-finder-sessions-view`), a
  `useSyncExternalStore` with List as the server snapshot. The `useState`-initializer pattern the
  other prefs hooks use was tried and left "Tile view" at the prerendered `aria-pressed="false"`
  after a reload. The leaderboard's View toggle likely has the same latent highlight bug; not touched.
- #157: raid sections are `<section aria-labelledby>` regions named by their h2 (text unchanged).
  Row keys are still `${membershipId}-${index}`; stable identity is #158's.
- #157: `CLAUDE.md`'s e2e flow list is **not** edited: the request came from a peer session, and
  this session doesn't edit CLAUDE.md on a peer's request. The proposed text is in the handoff
  message to the orchestrator, for the user to apply.
- #157 verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0), tsc,
  `npm test` 547/547, `npm run e2e` 105/105.
