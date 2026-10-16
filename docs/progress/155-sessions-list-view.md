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
   - [x] `e2e/active-sessions-expand.spec.ts` (new, prefix `88`)
   - [x] `e2e/player-names.spec.ts` — expand the row, check a non-titled member's `Name#Code`
   - [x] `e2e/support/fireteam-rows.ts` (new) — a section's own `ul > li`, so an open row's member items aren't rows
   - [x] `e2e/support/seed-world.ts` — `EXPAND_RAID` (Last Wish), a raid only the expand spec seeds
   - [x] `e2e/active-sessions-cap.spec.ts`, `e2e/active-sessions-list.spec.ts` — row locators narrowed past nested member items
4. Expandable rows (green)
   - [x] `src/components/FireteamRow.tsx` — whole-row toggle, chevron, the expanded member list
   - [x] `src/app/active-sessions/page.tsx` — open state keyed by session identity; `fireteamKey` from it
5. Bookkeeping
   - [x] `docs/e2e-coverage.md` — flow list, prefix `88`, journal entry
   - [x] `docs/progress/155-sessions-list-view.md` (this file)
   - [x] `CLAUDE.md` — e2e flow list (`83c3267`, by the orchestrating session at the user's request; the implementing session proposed the text)
6. Review fixes (the user's picks from the code review)
   - [x] `src/components/FireteamRow.tsx` — one-player rows offer nothing to open (A); the click exclusion scoped to the row (P2)
   - [x] `src/app/active-sessions/page.tsx` — open rows kept across a maintenance response (S3); the `fireteamKey` comment names the remount limitation, #168 (P1)
   - [x] `src/lib/active-session/roster.ts` — `isSameSession`'s doc: dedupe uses it, so it moves ADR 0001's cap and ADR 0002's count (P3)
   - [x] `src/lib/active-session/roster.test.ts` — the "forgets" test's comment: the raid filter doesn't drop an open row (S2)
   - [x] `e2e/active-sessions-expand.spec.ts` — the maintenance spec and the fireteam-of-one spec (`884`)
   - [x] `docs/e2e-coverage.md` — `884`, the two specs, 117 tests
7. Styling (the user's requests, a commit of its own)
   - [x] `src/components/FireteamRow.tsx` — warm row hover on clickable rows (B); warm hovers on the title link, member links and chevron (B2); a normal-weight title name (C)
   - [x] `src/app/active-sessions/page.tsx` — `overflow-hidden` on the list card (B); the View toggle on the right (D)
8. Bookkeeping after the review
   - [x] `CLAUDE.md` — e2e flow list: the maintenance response and the fireteam of one (`545537c`, by the orchestrating session at the user's request; the review session proposed the text)

## #159 — collapsible raid sections, Collapse all / Expand all

Branch `feat/159-raid-collapse` (from `c88ef31`, so all of #156–#158 is in it). Seam: the page,
through Playwright only. Collapse state isn't a Roster rule, so `roster.ts` is untouched.

1. Specs, red against today's page
   - [x] `e2e/support/seed-world.ts` — `COLLAPSE_RAID` (Root of Nightmares), `COLLAPSE_OTHER_RAID` (King's Fall), `UNSEEDED_RAID` (Vow of the Disciple, never seeded)
   - [x] `e2e/active-sessions-collapse.spec.ts` (new, prefix `89`: `891`, `892`)
2. Collapsible sections (green)
   - [x] `src/app/active-sessions/page.tsx` — collapse state by `raidKey`, the header button, the content wrapper, Collapse all / Expand all
   - [x] `e2e/support/fireteam-rows.ts` — rows sit one level deeper, under the content wrapper (same commit as the wrapper)
3. A spec fix found by the bite checks
   - [x] `e2e/active-sessions-collapse.spec.ts` — a collapsed section's check counts rows on screen by role, not by the CSS row locator
4. Bookkeeping
   - [x] `docs/e2e-coverage.md` — namespace `89`, journal entry (twenty-four flows, 130 tests)
   - [x] `docs/progress/155-sessions-list-view.md` (this file)
   - [x] `CLAUDE.md` — e2e flow list (`be65941`, by the orchestrating session at the user's request; proposed by the implementing session, refined by the review session after S1/S6)
5. Review fixes (the user's picks from the code review)
   - [x] `e2e/support/seed-world.ts` — `REAPPEAR_RAID` (The Desert Perpetual) and `endFireteams`, which ends a prefix's fireteams through `deleteActiveSessionForPlayer` (S1)
   - [x] `e2e/active-sessions-collapse.spec.ts` — spec 14, a raid that leaves the response and comes back starts expanded (`893`) (S1); the tile spec checks the collapsed name on screen and collapse across a List↔Tiles switch (S6)
   - [x] `docs/adr/0004-mock-only-at-the-network-boundary.md` — 2026-10-15 amendment: the maintenance stub is the one own-API exception (P1)
   - [x] `e2e/support/active-sessions-page.ts` — the stub's docblock cites the amendment (P1); one path predicate for the stub and the response wait (P4)
   - [x] `src/app/active-sessions/page.tsx` — the filter reads `raidSectionKey(s)`, like grouping and forgetting (S4)
   - [x] `e2e/active-sessions-expand.spec.ts` — the maintenance spec's two Refresh clicks use `refreshSessions` (P3)
   - [x] `docs/e2e-coverage.md` — the not-covered note corrected, `893`, review-fixes entry (131 tests)
6. Styling (the user's request, a commit of its own)
   - [x] `src/app/active-sessions/page.tsx` — the whole section header strip gets the warm row hover (`ui-list-item-hover`), with rounded corners and `-mx-3 px-3 py-2`, so the name stays in line with the rows; the content gap `mt-3` → `mt-1` keeps the text-to-rows spacing at 12px; the text's accent hover kept

## #160 — copy join code button on list rows

Branch `feat/160-copy-jc-button` (from `6e4f1f1`, so all of #156–#159 is in it). Seams: the
Join Command target through Vitest (`roster.ts`), the button through Playwright.

1. Join Command target, red then green (Vitest)
   - [x] `src/lib/active-session/roster.test.ts` — leader first, fallback to the first full name, no target, bare names and raw IDs never used
   - [x] `src/lib/active-session/roster.ts` — `joinCommand`
2. Specs, red against today's page
   - [x] `e2e/support/seed-world.ts` — `COPY_RAID`, and seats seeded with a name but no code, or never seen
   - [x] `e2e/active-sessions-copy.spec.ts` (new, prefix `90`)
3. The button (green)
   - [x] `src/components/CopyJoinCommandButton.tsx` (new) — the button, its ~2s success state and its failure tooltip
   - [x] `src/components/FireteamRow.tsx` — the button beside the chevron, disabled at 6/6, absent with no target
4. Bookkeeping
   - [x] `docs/e2e-coverage.md` — flows, namespace `90`, journal entry
   - [x] `docs/progress/155-sessions-list-view.md` (this file)
   - [x] `CLAUDE.md` — e2e flow list (`c32f60f`, by the orchestrating session at the user's request; proposed by the implementing session, the two-second clause narrowed by the review session)
5. Review fixes (the user's picks from the code review)
   - [x] `e2e/active-sessions-copy.spec.ts` — the phone spec measures the row's flex line, not the `truncate` title cell, against padding plus one line-height (S2)
   - [x] `src/components/CopyJoinCodeButton.tsx` → `src/components/CopyJoinCommandButton.tsx`, and `FireteamRow.tsx`'s comments say Join Command; user-facing text unchanged (T1)
   - [x] `docs/e2e-coverage.md` — not covered: a click on the disabled 6/6 button (S5); dismissing the failure tooltip by touch, scrolling included, and selecting the command by keyboard (S6)
   - [x] `docs/progress/155-sessions-list-view.md` — re-stamped at the final code commit (S3)
6. Styling (the user's pick from the code review, a commit of its own)
   - [x] `src/app/active-sessions/page.tsx` — the list `ul` loses #158's `overflow-hidden` (S1)
   - [x] `src/components/FireteamRow.tsx` — the first and last rows round their own hover at the card's inner radius, the last only while closed (S1)
   - [x] `src/components/CopyJoinCommandButton.tsx` — the comment no longer claims two lines; cap, `break-all` and body font kept (S1)
   - [x] `e2e/support/seed-world.ts` — `COPY_EDGE_RAID`; `e2e/active-sessions-copy.spec.ts` — spec 11, the widest names on the first and last rows (`906`, `907`), and the feedback checks measure clipping rather than the list's bounds (S1)
   - [x] `docs/e2e-coverage.md` — `906`/`907`, spec 11, review-fixes entry (142 tests) (S1)

## #161 — fireteam-size filter chips

Branch `feat/161-ft-size-filter` (from `7bddb71`, so all of #156–#160 is in it). Seams, agreed with
`orchestrate-161-ft-size-filter`: the Roster size rules through Vitest (`roster.ts`), the chips
through Playwright.

1. Roster size, red then green (Vitest), and the literal 6 replaced
   - [x] `src/lib/active-session/roster.test.ts` — `ROSTER_SIZE`, `isFullRoster`, `rosterSizeChip` (7+ under chip 6, 0 or less under chip 1)
   - [x] `src/lib/active-session/roster.ts` — the three exports
   - [x] `src/components/FireteamRow.tsx` — "N/6", its title and the disabled 6/6 button read `ROSTER_SIZE` / `isFullRoster`
   - [x] `src/components/ActiveSessionCard.tsx` — the constant only, no tile markup change (#153)
2. Specs, red against today's page
   - [x] `e2e/support/seed-world.ts` — `SIZE_RAID` (Pantheon: Morgeth Surpassing)
   - [x] `e2e/active-sessions-size.spec.ts` (new, prefix `91`)
3. The chips (green)
   - [x] `src/hooks/useSessionSizes.ts` (new) — the stored selection, `useSyncExternalStore`, failed-save fallback
   - [x] `src/components/SessionSizeChips.tsx` (new) — six toggle chips
   - [x] `src/app/active-sessions/page.tsx` — the size filter inside `filteredSessions`, `changeSizes`, the refresh path's live raids, the empty state
4. Bookkeeping
   - [x] `docs/e2e-coverage.md` — flows, namespace `91`, journal entry
   - [x] `docs/progress/155-sessions-list-view.md` (this file)
   - [ ] `CLAUDE.md` — e2e flow list: to be applied by the orchestrating session at the user's request (proposed by the implementing session, narrowed by the review session to what the specs cover)
5. Full-suite fix
   - [x] `e2e/active-sessions-size.spec.ts` — its own `x-forwarded-for`, so its page loads don't share the middleware's 60-a-minute bucket with every other active-sessions spec
6. Review fixes (the user's picks from the code review; `b5eaf19`)
   - [x] `src/app/active-sessions/page.tsx` — `changeSizes` forgets no collapsed section while the maintenance banner shows: `sessions` is then the response's empty list, so any chip click forgot every collapse (#159's rule); the next real response forgets what the chips emptied (P1). `isSessionShown`'s comment names its real readers (S2)
   - [x] `e2e/active-sessions-size.spec.ts` — spec 15, collapsed sections kept across a maintenance response the chips change under, via `serveMaintenance` (P1); the refresh-gap spec, still last, ends fireteam `918` before seeding it rather than keying ids on the retry number, since an attempt that failed before the grow left it at 5 and failed every retry (S1); the phone spec says why it taps chip 1 (S3)
   - [x] `e2e/support/seed-world.ts` — `SIZE_RAID`'s docblock holds before and after `fix/manifest-dupe-2530656885` drops the hash's second listing (P4)
   - [x] `docs/e2e-coverage.md` — the seed-world text the same way (P4); specs 15–16, the changed specs, review-fixes entry (158 tests)
7. Styling (the user's pick from the code review, a commit of its own; `c57523a`)
   - [x] `src/components/SessionSizeChips.tsx` — chips `w-8` → `w-7` (28×36) (ST1)
   - [x] `src/app/active-sessions/page.tsx` — the chips and View are one `flex-auto flex-wrap gap-x-2 gap-y-4` item, View still `ml-auto`, so they wrap together and share a line from 360px up (ST1)
   - [x] `e2e/active-sessions-size.spec.ts` — the 360px spec asserts the one line, and spec 16 asserts it at 375px (ST1)
8. Follow-ups on GitHub
   - [#171](https://github.com/agrorithms/destiny-public/issues/171) — a client address per spec, so the active-sessions specs stop sharing the middleware's `'unknown'` rate-limit bucket
   - [#164 comment](https://github.com/agrorithms/destiny-public/issues/164#issuecomment-6204283803) — `useSessionSizes` copies `useSessionsView`'s localStorage store; one shared store

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
- #158: session identity is `sessionIdentity` (raid + unique sorted member IDs) and `isSameSession`
  (same raid, and equal or nested member sets: the comparison dedupe uses). The page keeps open rows
  as identities and, on every successful fetch, replaces them with this poll's matching identities
  (`followOpenSessions`), so a Roster that gains a member and later loses another stays open, and a
  fireteam that leaves the page is forgotten. `fireteamKey` is the identity as a string for rows and
  tiles: unique on the page because dedupe already merged equal or nested Rosters in one raid.
- #158: the expanded list is `otherRosterMembers`: everyone but `fireteamTitle(...).membershipId`,
  each once, in Roster order (the user's 2026-10-14 decision). A member's name renders as the API
  sends it, or the ID when it sends none, like the tiles; it does not become "Unknown player".
- #158: the row's click handler ignores clicks inside any `a` or `button`, so #160's copy button
  needs no extra wiring. The chevron is the keyboard path (`aria-expanded`, `aria-controls` from
  `useId`); the member list renders only while open.
- #158: there were no dedupe unit tests to keep passing (the brief expected some). Dedupe's only
  coverage is the cap spec, whose rosters are disjoint, so the subset rule isn't exercised there;
  `isSameSession`'s Vitest tests now run the same three helpers.
- #158 proof that tests bite: all 12 new Vitest tests were shown red by a targeted break each (exact
  member order, no shrink, ignore raid, any overlap, no re-anchoring, identity = tracked player,
  exclude leader only, exclude by shown name, no de-dupe, exclude nobody). Playwright: 8 red against
  `d70253c`, then nine breaks of the finished code, each failing its own spec(s). One break (members
  in one line) passed the first phone spec, which then gained the whole-name check.
- #158 verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0), tsc,
  `npm test` 559/559, `npm run e2e` 115/115.
- #158: `CLAUDE.md`'s e2e flow list (twenty-three flows, plus the expandable rows) was applied in
  `83c3267` by the orchestrating session, at the user's request, from the implementing session's
  proposed text.
- #158 orchestrator review, user decisions (2026-10-15): a one-player row shows a chevron and opens
  onto an empty list; that goes to the code-review pass to fix. A dedupe unit-test seam goes to
  #166, not this ticket. A raw-ID member name in the expanded list is left for #165.
  Drag-selecting row text toggling the row is left as is. `followOpenSessions` and the Roster-growth
  and keyboard specs stay.
- #158 simplify pass (separate commit). Dedupe now calls `isSameSession` instead of spelling out
  the same raid and equal-or-nested rule by hand, so "same fireteam" is written once. The page and
  the server can't drift apart on it, and `haveSameMembers`/`isSubset` are private to `roster.ts`
  (bodies unchanged). The open-set rules moved from the page to `roster.ts`:
  - `isOpenSession` (also used by `followOpenSessions`);
  - `toggleOpenSession`, with one new Vitest test, shown red by three breaks (never closes, closes
    every row, opening replaces the others).

  The page's `toggleSession` is a plain function: the `useCallback` bought nothing, because each
  row gets a new arrow anyway. `otherRosterMembers` takes `RosterSession` instead of an inline
  copy of it, and reads the excluded member from a private `titleSubject`, which `fireteamTitle`
  also uses, rather than building a whole title. Specs:
  - `fireteamRow` and `memberList` in `e2e/support/fireteam-rows.ts`, used by the expand and
    player-names specs;
  - a local `chevronOf` in the expand spec;
  - `listRows` in the list spec.

  The helpers find the member list by its name everywhere; before, most call sites used a bare
  `getByRole('list')`. No behaviour change. Dedupe was checked by a throwaway script, not
  committed: the old function from `9fff24e` and the new one on 20,000 random inputs gave 0
  mismatches. With the superset branch of `isSameSession` removed, the same script found 5,413.
  The spec helpers were shown red by four breaks of the app, one build each, never committed:
  - the member list unnamed: 6 failed;
  - the fetch forgetting open rows: the 2 refresh specs failed;
  - `aria-expanded` pinned false: 5 failed;
  - the section's rows in an `<ol>`: the cap, list and player-names row specs, 9 failed.

  Deferred:
  - one shared `playerHref` for `/player/{type}/{id}`, which five files build (`FireteamRow`,
    `ActiveSessionCard` (#153's), `LeaderboardTable`, `PlayerSearch`, `PlayerProfileClient`): a
    new issue;
  - an `expectOneLineTall` in `e2e/support/viewport.ts` for the one-line-title check that the
    list and expand phone specs both carry: outside the diff;
  - the member-name fallback (`displayName || membershipId`), which copies `ActiveSessionCard`'s
    `getDisplayName`: #165.

  Rejected:
  - `React.memo` on rows and one identity per session per poll: under 1ms at 600 rows;
  - a shared `PlayerName` link-or-span component for the title and the members: two uses;
  - moving `fireteamKey` into `roster.ts`: it is a React key, so it belongs with the rendering;
  - dropping player-names' now-tautological `toContainText`: it states the test's intent.

  Re-verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0), tsc,
  `npm test` 560/560, `npm run e2e` 115/115.
- #159 review fixes (the user's picks, 2026-10-15). S2, S3, S5 and P5 were no action.
  - S1: spec 14 ends the `893` fireteam in the e2e Tracker and reseeds it, with no stub. Red with
    the fetch path's forgetting deleted ("Expected: \"true\", Received: \"false\"").
  - S6: the tile spec checks the raid name as text on screen while collapsed, and that collapse
    survives a switch to List and back. Red with the name hidden behind an `aria-label` (the old
    spec passed that), and red with a view switch clearing collapse state.
  - S4: the filter, grouping and forgetting all read `raidSectionKey`. That makes "can't
    disagree" true by construction. The only change in behaviour is that a stored `""` in the
    raid filter now shows null-key raids. `raidKey: string` is unchanged.
  - P1: ADR 0004's 2026-10-15 amendment names the maintenance stub as the one exception: a
    response the e2e server can't be put into.
  - P3, P4: no behaviour change. The expand maintenance spec now waits for each response.
- #158 review fixes (the user's picks, 2026-10-15):
  - A: a row whose `otherRosterMembers` is empty (about 40% of rows, a Roster of one) has no
    chevron, no row click and no pointer cursor. An `aria-hidden` 24px placeholder takes the
    chevron's place, so the count and elapsed time line up with the other rows. The member list
    renders only when the row is open **and** has someone to list: a row opened as {A,B} that
    shrinks to {A} stays open in the page's state (`{A}` is inside `{A,B}`) and would otherwise
    open onto an empty list. New spec, red then green: with the chevron still there, "Expected: 0,
    Received: 1"; with the placeholder's width removed, the alignment check failed (1219 against
    1195).
  - P2: the row ignores a click only when the `a, button` that `closest()` finds is inside the row
    (`event.currentTarget.contains`), so an ancestor link or button can't swallow every row's
    click. No spec: nothing renders the rows inside one today.
  - S3: the page doesn't run `followOpenSessions` on a maintenance response. Its empty list means
    nothing could be read, so open rows survive it the way they survive a failed fetch. New spec,
    red then green: the row came back closed ("Expected: \"true\", Received: \"false\"").
  - P1 (comment only): `fireteamKey`'s comment says a Roster change remounts the row, dropping
    keyboard focus and regenerating `useId`. A stable key is #168.
  - P3 (comment only): `isSameSession` moves ADR 0001's cap and ADR 0002's count, because dedupe
    calls it. Open-row changes belong in `followOpenSessions`.
  - S2 (comment only): the raid filter hides rows after `followOpenSessions` runs, so it never
    drops an open row; only the display cap or the raid ending does.
  - S1, known and left as is: `followOpenSessions` is many-to-one. One open identity opens every
    current session nested inside it, so a fireteam that splits shows two open rows, and a member
    who leaves and starts the same raid solo gets an open solo row they never opened. It is rare
    (same raid, same `activityHash`) and harmless. If it is ever changed, change
    `followOpenSessions`, never `isSameSession` (see P3).
- #158 styling (the user's requests, 2026-10-15):
  - B: the one-line row of a clickable row (not a fireteam of one, not the `li`, not the member
    list) takes the existing `ui-list-item-hover`, the warm `--ui-surface-card-muted` that
    RaidMultiSelect and PlayerSearch use. The list's `ul` gains `overflow-hidden`, so a hovered
    first or last row keeps the card's rounded corners.
  - B2: the title link, the member links and the chevron hover to `hover:text-[var(--ui-accent)]`
    instead of Tailwind blue, the same arbitrary value the nav's site title uses. No new colours
    or tokens. Focus is unchanged: the browser's own ring, still visible on the chevron. Tiles keep
    their blue until #153.
  - C: the title name is normal weight, on the link and on the fallback `<span>`.
  - D: the View toggle's wrapper has `ml-auto`, so it sits at the right of the control bar. Raid
    and Refresh stay on the left, where #159's Collapse all will join Refresh. At 360px the bar
    wraps and the toggle sits at the right of the second line, beside Refresh.
  - Checked with a throwaway Playwright script (deleted, never committed) at 1280px and 360px in
    light and dark:
    - the computed colours equal the tokens: the hovered row is `--ui-surface-card-muted`
      (#f7f6f1 light, #2a2a28 dark), and the three hovers are `--ui-accent` (#9a6324, #c18a3b);
    - a fireteam of one has a transparent background and an `auto` cursor on hover;
    - the title is font-weight 400;
    - `:focus-visible` on the chevron shows the focus ring;
    - the toggle sits at x 1149 of 1280 and 229 of 360, `scrollWidth` equals the viewport, and
      Tile/List still switch at 360px.
- #159: collapse state is `collapsedRaids: ReadonlySet<string>` in `page.tsx`, by `raidKey` (null
  keys share `''` and collapse together). It is forgotten for a raid that leaves the page: on each
  non-maintenance fetch, raids with no sessions in the response (`keepCollapsed` in the fetch), and
  on a raid-filter change, raids the filter hides (`changeRaidFilter`, which wraps the hook's
  setter). A maintenance response and a failed fetch keep it, as they keep open rows (#158's S3).
  `isRaidShown` is the filter's own predicate, used by both the session filter and the forgetting,
  so the two can't disagree.
- #159: the header is `h2 > button` (the accordion pattern), with the chevron an `aria-hidden` SVG
  and the count outside the `h2`, so the `h2`'s text is still the bare raid name and the #156 order
  spec passes unmodified. The header row also toggles on a click anywhere on it, ignoring clicks on
  its own button, like `FireteamRow`. The content wrapper `raid-section-<raidKey>-content` stays in
  the page with `hidden`; its rows or tiles are unmounted while collapsed.
- #159: Collapse all is `ui-toggle-idle` with a `--ui-border-input` border (the raid filter's input
  border), `h-9` so it matches Refresh's height. It shares one flex item with Refresh so the two
  wrap together. With no visible section it reads Collapse all and is **disabled** (not hidden), so
  the control bar doesn't change shape when a filter empties the page.
- #159 proof that tests bite: all thirteen specs red against `c88ef31`; then 14 targeted breaks in
  three batches, each failing exactly its predicted spec(s); the row locator shown caught both too
  narrow (`:scope > ul > li`, cap spec 8 vs 0) and too loose (`:scope ul li`, collapse spec 12, 2 vs
  7). The details are in `docs/e2e-coverage.md`'s #159 entry. One break (tiles kept mounted inside
  the hidden wrapper) stayed green, correctly, and led to the role-based collapsed check.
- #159 verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0), tsc,
  `npm test` 560/560, `npm run e2e` 130/130.
- #159 simplify pass (separate commit). No behaviour change.
  - `raidSectionKey` in `page.tsx` is the one place for the null-key `?? ''` fallback. The
    grouping and the fetch's forgetting both call it, so they can't disagree about which section
    a null-key session belongs to. The null-key note moved there from the grouping comment.
  - The content wrapper's ternary is `{!collapsed && (...)}`. It still unmounts the rows or tiles,
    and `hidden` stays on the kept wrapper.
  - Comments: `keepCollapsed`'s reads as a predicate, not a set. The filter's comment that
    repeated `isRaidShown`'s was dropped. `fireteamRows`' docblock says the header is a `<div>`
    child too (it matches `:scope > div` but holds no list). It no longer says a collapsed section
    renders no list, because the spec leaves that choice to the page.

  Left as they are:
  - The header's own-button guard, with the toggle wired on the button and the div. Wiring it on
    the div alone would behave the same today, but the brief lists the guard as deliberate.
  - `toggleAllSections` as plain `new Set()` / `new Set(visibleRaidKeys)`. That works only while
    `collapsedRaids` stays within the visible raids, an invariant two separate prune sites keep.
  - Rows kept mounted under `hidden` alone. That is a DOM change (#168's remount note).
  - Dropping `filteredSessions`' no-filter shortcut: microseconds at 600 rows.
  - An unchanged Set returned from `keepCollapsed`: React batches it with `setSessions` anyway.
  - A spec-local `collapse()` and raid-filter-trigger helper: inline reads fine.

  Deferred, all outside the diff:
  - a shared chevron icon, which `FireteamRow` also draws (two uses);
  - a `RaidSection` component;
  - an `expectInsideViewport` in `e2e/support/viewport.ts`, now hand-written in the collapse,
    list, expand and timeline specs;
  - a shared Refresh-and-wait and maintenance stub for the expand and collapse specs.

  Re-verified: lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0),
  `npm test` 560/560, `npm run e2e` 130/130.

- #159 e2e helpers (the user's request, past #159's diff for these two items only):
  - `expectInsideViewport` in `e2e/support/viewport.ts` replaces the five hand-written
    viewport-edge checks in the collapse, list, expand and timeline specs. The timeline change is
    only that swap. It checks both edges against the page's viewport, never weaker than before.
    Shown red through the helper by widening Collapse all and pushing the View toggle off the
    right edge, then green.
  - `e2e/support/active-sessions-page.ts` (new): `refreshSessions`, `serveMaintenance` /
    `endMaintenance` and `MAINTENANCE_MESSAGE`. They replace the Refresh-and-wait and
    maintenance-stub copies in the expand and collapse specs. The stub is still `page.route`. Shown
    red by a fetch that clears open rows and collapse state (five specs), and by removing only
    the maintenance guard (the two maintenance specs), then green. The expand spec's plain Refresh
    clicks stay plain.

- #160: the Join Command target is `joinCommand` in `roster.ts`: the Fireteam Leader if
  `hasFullBungieName`, else the first Roster member who passes it, else null. "Full" is
  `/^.+#\d{4}$/` on the display name, the shape the server writes when the players row has both
  parts. A bare name has no `#code` and a raw membership ID is all digits, so neither can pass.
  An `isLikelyMembershipId` check on top would be unreachable, so there isn't one; the Vitest
  raw-ID case still covers it. The tracked player outside the Roster is never a target: the rule
  is the Roster's.
- #160: the button is `src/components/CopyJoinCommandButton.tsx`, between the elapsed time and the
  chevron. It is the chevron's width (`-my-1 p-1`, a 16px icon) at every size. Its state (idle,
  copied, failed) lives in the component, so it is in the row and lost when a section collapses
  (#168).
  - Copied: a check mark and a `role="status"` tooltip, "Copied /join …", for `COPIED_MS` (2000).
    Each copy sets a new state object, so a second click restarts the timer.
  - Failed: "Copy failed: /join …", the command `select-all`. It stays until Escape or a
    `pointerdown` outside the button and tooltip. The tooltip stops its own click, so selecting
    the command doesn't toggle the row. That is the one bit of click wiring added; the button
    itself relies on #158's guard.
  - Full (`playerCount >= 6`, the number the row shows): `disabled`, title "Fireteam full",
    aria-label still "Copy join code".
  - No target: no button, and an `aria-hidden` `w-6` placeholder keeps the count and time
    aligned (like #158's fix A).
  - The fireteam of one keeps #158's chevron placeholder to the button's right, so every row's
    button is in one column. The rejected alternative, the button taking the chevron's slot,
    put it 36px right of the others and moved the count and time with it.
- #160: the tooltip sits to the button's left, centred on the row's own line. It was first held
  to two lines of `text-xs`, because the list's `overflow-hidden` (for the rounded hover corners)
  clipped anything above its first row or below its last. The review (S1) found that 26 `M`s, `W`s
  or CJK characters take three lines (54px against a 40px row) and lost 6px at the list's edge.
  So the list no longer clips: the first and last rows round their own hover instead (see
  Styling). At 360px the card has 32px gutters, so the cap is `calc(100vw - 10rem)`. The command
  is in the body font and `break-all`, because monospace wrapping at its space only makes it
  taller. The phone specs measure the tooltip inside the viewport and not clipped or drawn over.
- #160: the row divider borders are `currentColor`, which is pre-existing. `divide-y` borders the
  `li`s, but `ui-divider` sets `border-color` on the `ul`. Seen in the #160 screenshots and left
  for #169.
- #160 review, issues and decisions:
  - #165: comment https://github.com/agrorithms/destiny-public/issues/165#issuecomment-6201049149 (Name#NNNN-shaped fallback names pass `hasFullBungieName`).
  - #169: comment https://github.com/agrorithms/destiny-public/issues/169#issuecomment-6201080815 (list dividers draw in `currentColor`).
  - S4 accepted, with no issue: "Fireteam full" is only the disabled button's `title`, but the visible 6/6 carries the fact.
  - T2 (duplicated spec helpers), T3 (`hasFullBungieName` vs `hasCompleteBungieDisplayName`), T4 (`joinCommand`'s inline parameter type): no action.
- #160 review bite proofs:
  - S2: with the row broken to wrap (`flex-wrap` on the line, `basis-full` on the button), the new check failed "the row is one line tall … Expected: 40, Received: 80". The old check's title assertion passed under the same break.
  - S1: spec 11 was red against the list's `overflow-hidden` (clipped "by 6.0px" on the first row), then green after the styling fix.
- #160 proof that tests bite: Vitest, 6 breaks of `joinCommand`, each failing its tests (leader
  never preferred; no fallback; any member as a last resort; bare names accepted; raw IDs
  accepted; a code-less leader taken). Playwright, 17 breaks in 7 batches (one build each),
  every failing set as predicted; the list is in `docs/e2e-coverage.md`'s #160 entry.
- #160 verified (at `3bf58bf`, the last code commit; the re-stamp after it is this file only):
  tsc exit 0, lint 0 errors (29 warnings, `gos10k/`), build (`○ /active-sessions`, exit 0),
  `npm test` 565/565 (46 files), `npm run e2e` 142/142.

- #161: which chip a fireteam falls under is `rosterSizeChip` in `roster.ts`, the player count
  its row shows clamped to 1–`ROSTER_SIZE`, so a count past 6 is under chip 6 (and full by
  `isFullRoster`, so its copy button is disabled) and a count below 1 under chip 1. With every chip
  on, nothing is ever hidden, which is the property #163 lacks for the raid filter's Select All.
  `FireteamRow`'s "N/6", its title and `full`, and the tile's count read the same two exports.
- #161: the chips are `SessionSizeChips` (a `role="group"` "Fireteam size" of six
  `aria-pressed` buttons, "Fireteams of N"), between [Refresh + Collapse all] and View. Joined like
  the View toggle, `h-9 w-8`, `ui-toggle-active` / `ui-toggle-idle`, border and dividers in
  `--ui-border-input`. The selection is `useSessionSizes` (key
  `destiny-farm-finder-sessions-sizes`, a JSON array): a `useSyncExternalStore` whose snapshot is
  the canonical string "1,2,5", stable by value, parsed in a `useMemo`. Anything but an array of
  whole numbers 1–6 reads as all six; `[]` is all off. No cross-tab sync (the user's call).
  Every chip off shows nothing (the user's call), with "Select at least one fireteam size", and a
  page the chips empty inside the raid filter reads "Try selecting more fireteam sizes".
- #161: `isSessionShown` (raid filter AND sizes) is the one predicate for `filteredSessions` and
  for forgetting collapsed sections. `changeSizes` wraps the hook's setter like
  `changeRaidFilter`. The fetch forgets raids with nothing *shown* (`shownRaidKeys` over this
  poll's sessions with the current filters, read through `filtersRef`, written in an effect),
  not raids missing from the response: a fireteam that grows to a size the chips hide can empty
  a section the API still sends. Open rows still follow the unfiltered sessions, so a row a chip
  hides comes back open.
- #161 proof that tests bite: Vitest, 4 breaks of the clamp and `isFullRoster`; Playwright, all 14
  red against `ec8e74f`, then 12 breaks in 5 builds, each failing its predicted specs (listed in
  `docs/e2e-coverage.md`'s #161 entry).
- #161: the first full `npm run e2e` failed 6 of this file's specs on a 429 from `middleware.ts`'s
  per-IP limit on `/api/active-sessions` (60 a minute, one shared `'unknown'` bucket for every
  spec). The file now sends its own `x-forwarded-for`. The other active-sessions files still share
  the bucket: a follow-up.
