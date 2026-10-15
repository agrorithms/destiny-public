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
   - [x] `CLAUDE.md` — e2e flow list (`993246d`, by the orchestrating session; see notes)
   - [x] `docs/progress/155-sessions-list-view.md` (this file)
5. Review fixes (findings S1, S2, S3, S6, P2, and the user's P3 decision)
   - [x] `docs/progress/155-sessions-list-view.md` — the CLAUDE.md item and note agree with `993246d`
   - [x] `src/lib/active-session/roster.test.ts` — a why-comment on the three tests that lacked one
   - [x] `src/app/active-sessions/page.tsx` — the section comment leads with the landmark
   - [x] `src/hooks/useSessionsView.ts` — no cross-tab sync; `unstoredView` only when a write throws
   - [x] `e2e/active-sessions-list.spec.ts` — the phone spec measures a 26-character name
   - [x] `docs/e2e-coverage.md` — spec 7, the `872` fixture, and the wrap gap it still misses
6. Second review pass (user-approved)
   - [x] `src/hooks/useSessionsView.ts` — a write that succeeds clears `unstoredView`
   - [x] `e2e/active-sessions-list.spec.ts` — the phone spec checks the title is one line tall
   - [x] `docs/e2e-coverage.md` — spec 7 covers the wrapped title; the gap bullet narrowed
7. The failed-save toggle check, made permanent (user-approved)
   - [x] `e2e/active-sessions-list.spec.ts` — the first view save throws; Tiles still switches, the next save wins
   - [x] `docs/e2e-coverage.md` — spec 8, eight specs, 106 tests, the private-mode gap narrowed

## #158 — expandable list rows that stay open across refreshes

Branch `feat/158-expandable-list-rows` (from `9fff24e`, so all of #156 and #157 is in it).

1. Roster rules, red then green (Vitest)
   - [x] `src/lib/active-session/roster.test.ts` — session identity (growth, shrinkage, tracked player changes, other raid, unrelated Rosters), following open fireteams across polls, the one excluded member
   - [x] `src/lib/active-session/roster.ts` — `sessionIdentity`, `isSameSession`, `followOpenSessions`, `otherRosterMembers`; the member-set helpers and `isLikelyMembershipId`, exported
2. One copy of each shared rule (behaviour unchanged)
   - [x] `src/lib/active-session/dedupe.ts` — imports the member-set helpers from `roster.ts`
   - [x] `src/lib/active-session/format.ts` — imports `isLikelyMembershipId` from `roster.ts`
   - [x] `src/app/api/active-sessions/route.ts` — imports `isLikelyMembershipId` from `roster.ts`
3. Specs, red against the collapsed-only rows
   - [ ] `e2e/active-sessions-expand.spec.ts` (new, prefix `88`)
   - [ ] `e2e/player-names.spec.ts` — expand the row, check a non-titled member's `Name#Code`
   - [ ] `e2e/active-sessions-cap.spec.ts`, `e2e/active-sessions-list.spec.ts` — row locators narrowed past nested member items
4. Expandable rows (green)
   - [ ] `src/components/FireteamRow.tsx` — whole-row toggle, chevron, the expanded member list
   - [ ] `src/app/active-sessions/page.tsx` — open state keyed by session identity; `fireteamKey` from it
5. Bookkeeping
   - [ ] `docs/e2e-coverage.md` — flow list, prefix `88`, journal entry
   - [ ] `docs/progress/155-sessions-list-view.md` (this file)

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
- #157: `CLAUDE.md`'s e2e flow list was edited in `993246d` by the orchestrating session, at the
  user's request. The implementing session doesn't edit CLAUDE.md on a peer's request, so it
  handed the proposed text over rather than applying it.
- #157 verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0), tsc,
  `npm test` 547/547, `npm run e2e` 105/105.
- #157 simplify pass (separate commit): `fireteamTitle` returns the row's `tooltip` (name, or the
  ID for "Unknown player") in place of an `unknown` flag, so that rule lives in `roster.ts`; the
  session shape is one exported `RosterSession` that `FireteamRow` extends; `useSessionsView`'s
  setter is a module-level `writeView` instead of a `useCallback`; one `fireteamKey` for rows and
  tiles. No behaviour change, `ActiveSessionCard` untouched. Deferred, both outside the diff:
  moving `getElapsedTime` out of `ActiveSessionCard` into a lib module (#153 owns that file), and
  making the route's and `format.ts`'s `isLikelyMembershipId` import one regex from `roster.ts`.
  Re-verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0), tsc,
  `npm test` 547/547, `npm run e2e` 105/105.
- #157 review pass (two commits). The view no longer follows other tabs (the `storage` listener
  is gone; the user's call on finding P3). `unstoredView` is set only when `setItem` throws, and
  `readView` checks it before localStorage, so a write that fails while an old value is still
  stored doesn't leave the toggle stuck. Checked with a throwaway Playwright spec, not committed:
  every storage call throwing, and only writes throwing with "tiles" stored; the toggle switched
  both ways in both. The phone spec now measures the solo row, renamed
  `Roster872SoloWithALongName`. With `min-w-0` and `truncate` both removed from the title, the old
  `.first()` spec passed and the new one failed: the row scrolled sideways by 78px. Removing
  either class alone passes both versions: `truncate`'s `overflow: hidden` already gives the flex
  item a zero minimum width, and without `truncate` the title wraps instead. That gap is recorded
  in `docs/e2e-coverage.md`. Re-verified: lint 0 errors (29 warnings, `gos10k/`), build
  (`○ /active-sessions`, exit 0), `npm test` 547/547, `npm run e2e` 105/105.
- #157 second review pass (one commit, user-approved). `writeView` clears `unstoredView` when
  `setItem` succeeds: without that, one failed write followed by successful ones left the view
  stuck on the failed pick, because `readView` checks `unstoredView` first. Proved with a
  throwaway Playwright spec, not committed: only the first view write throws, then Tiles, then
  List. List stayed unpressed before the fix ("Expected: true, Received: false") and was pressed
  after it. The phone spec also checks that the long-named row's title cell is one line tall
  (`clientHeight` against its computed `line-height`). With only `truncate` removed it fails
  ("Expected: 20, Received: 40"). With only `min-w-0` removed it passes, and restored it passes.
  The one-line check was chosen over "the link ends before the count": the `<a>`'s box isn't
  clipped by `truncate`'s `overflow: hidden`, so that check would fail on the working row too.
- #157: the failed-save check is now a committed spec (list spec 8, user-approved). `addInitScript`
  makes only the first `setItem` on the view key throw `QuotaExceededError`. It asserts Tiles is
  pressed after the failed save and List wins after the next one. Red with `unstoredView = null;`
  removed from `writeView` ("Expected: \"true\", Received: \"false\"" on List), green restored.
  No new seed data. The CLAUDE.md flow list is unchanged; its list-view wording still fits.
