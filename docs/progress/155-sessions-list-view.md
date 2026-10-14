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

Not started.

## Notes

- #156: sections group by `raidKey` and sort by their index in `AVAILABLE_RAIDS`
  (`RAID_SECTION_ORDER` / `raidSectionRank` in `page.tsx`); unknown keys share one rank and fall back
  to key order, so they don't move between polls either. The heading still comes from the API's
  `raidName` (unchanged text), taken from the section's first session. A `null` key from the API
  groups under `''`.
- #156 verified: lint 0 errors (29 pre-existing warnings, all in `gos10k/`), build, tsc, `npm test`
  539/539, `npm run e2e` 98/98.
