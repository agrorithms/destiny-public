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
3. Bookkeeping
   - [ ] `docs/e2e-coverage.md` — flow list, prefix `89`, journal entry
   - [ ] `docs/progress/155-sessions-list-view.md` (this file)
   - [ ] `CLAUDE.md` — e2e flow list (proposed in the report; the orchestrating session applies it)

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
