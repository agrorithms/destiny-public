# GoS 10k Phase 1 — progress

Tracks issue **#81** (the Phase 1 spec) as a whole, not any single ticket. Required by
`CLAUDE.md`: Phase 1 is twelve tickets and well past the ~8-file threshold, so it gets a
checkbox file and one WIP commit per logical chunk. **The chunk boundary is the ticket.**

- Spec: **#81**. Tickets: **#84–#95**, plus **#96** (Playwright harness) and **#80** (browser
  coverage decision, closed at the end).
- Reasoning behind every decision: `docs/handoffs/260907-gos10k-ui-grill-and-three-specs.md`.
  Ordering and the three mid-session corrections:
  `docs/handoffs/260907-phase1-tickets-published.md`. Both are gitignored.
- ADRs in force: **0007** (the Archive is a second read-only database) and **0008** (derived
  analytics are computed at Archive build time). Nothing below contradicts either; #84 is
  ADR 0008's first implementation.

## Order

```
84 → 96 → 86 → 95 → 85 → 87 → 91 → 92 → 88 → 90 → 89 → 93 → 94 → 80
```

Wave 0 is `84`, `96`, `86`, `95` (nothing blocks them); `85` needs `84`; `87` needs `84`,
`85`, `86`; everything else follows `87`.

## Tickets

- [x] **#84** Materialise Clear Number at Archive build time — the prefactor. Not demoable.
- [x] **#96** Playwright harness for the Archive — must land before #88 and #90.
- [x] **#86** Page shell
- [x] **#95** Cache lifetime + share-card fallback
- [x] **#85** Widen the Archive fixture
- [x] **#87** The range filter (largest ticket; gates Wave 3)
- [x] **#91** Fastest-clears list (owns the shared duration formatter)
- [x] **#92** Median speed board (imports #91's formatter)
- [x] **#88** Timeline
- [x] **#90** Helper board
- [ ] **#89** Presence strip
- [ ] **#93** Resets panel
- [ ] **#94** Participants panel + class split
- [ ] **#80** Close: record the two browser-coverage decisions, update ADR 0007's consequence
  - [ ] Restore the Archive's browser cache lifetime to 86400 (#95 dropped it to 60 for UI
        iteration; collapse `ARCHIVE_BROWSER_MAX_AGE_SECONDS` back into
        `ARCHIVE_SHARED_MAX_AGE_SECONDS` in `src/lib/http/cache.ts`)

## Files

Per ticket, so a reviewer can see which diff belongs to which chunk.

### #84 — Clear Number

- [x] `src/lib/db/archive/predicates.ts` — **new.** The three full-clear predicate constants,
      moved out of `queries.ts` so the build script can import the pinned rule without
      dragging in `getArchiveDb()` and the Tracker's query module. `queries.ts` re-exports
      them, so every existing import site is unchanged.
- [x] `src/lib/db/archive/derive-clear-number.ts` — **new.** The single derivation, called by
      both the build script and the fixture extractor.
- [x] `src/lib/db/archive/queries.ts` — predicates re-exported rather than defined.
- [x] `src/lib/db/archive/index.ts` — `verifyArchiveInvariants()`, checked at open next to the
      row counts, skipped for the fixture the same way.
- [x] `src/lib/db/archive/gos-10k-manifest.json` — regenerated; gains `invariants`.
- [x] `scripts/build-gos10k-serving-db.ts` — derives, indexes, and writes the invariants.
- [x] `scripts/extract-archive-fixture.ts` — runs the same derivation over the sampled rows.
- [x] `tests/fixtures/archive-seed.json` — regenerated; carries `clear_number`.
- [x] `tests/db/archive-clear-number.test.ts` — **new.** The derivation's own tests.
- [x] `tests/db/archive-connection.test.ts` — extended with the invariant assertions.
- [x] `CONTEXT.md` — `Clear Number` added; `Checkpoint Run` gains the "there are 8" note.
      `Reset` is #93's, deliberately not added here.

### #96 — Playwright harness for the Archive

- [x] `e2e/support/fixture-db.ts` — mints the fixture Archive path as a sibling of the
      Tracker's in the same `mkdtemp` dir; `GOS10K_ARCHIVE_DB_PATH` and
      `DFF_TEST_GOS10K_DB_SENTINEL` added to `FIXTURE_DB_ENV_KEYS`; `fixtureArchiveDbPath()`.
- [x] `e2e/support/archive-world.ts` — **new.** Builds the fixture Archive through the
      *unmodified* shared loader, then adds the per-run canary helper. Holds the reasoning
      for why the read-only file can still carry a nonce.
- [x] `e2e/support/archive-canary.setup.ts` — **new.** Proves the binding through the running
      server before any spec runs. Joins the existing `canary` project by filename.
- [x] `e2e/support/global-setup.ts` — mints the canaried Archive alongside the Tracker seed.
- [x] `playwright.config.ts` — the Archive's two env vars on `webServer`.
- [x] `e2e/gos10k-smoke.spec.ts` — **new.** One smoke spec: renders, canary present, no
      console errors. Deliberately asserts no counts — #85 widens the fixture next.
- [x] `docs/handoffs/260803-playwright-e2e.md` — coverage statement updated to include the
      Archive.
- [x] `CLAUDE.md` — the `npm run e2e` entry now says the suite mints two fixture databases.

### #86 — Page shell

- [x] `src/app/gos10k/page.tsx` — the header becomes the real shell: the Pinned Full Clear
      headline with the population it counts, the dated "complete through <last Run>" band,
      the Archive's first/last Run dates, and the full-clear methodology moved into a
      `<details>` that is closed by default. The pinned-clear tile was dropped from the
      stat grid (it is the headline now) and the grid is `sm:grid-cols-3`; every other
      panel below is untouched and still unfiltered.
- [x] `e2e/gos10k-shell.spec.ts` — **new.** Three specs, covering only the two acceptance
      criteria with no other seam: the disclosure is closed until clicked, and the shell
      renders at 360 px with no horizontal page scroll and no clipped headline. Verified
      red against the pre-#86 page. Asserts no counts and no dates — #85 widens the fixture
      next.
- [x] `docs/handoffs/260803-playwright-e2e.md` — coverage statement updated; the "nothing
      about /gos10k's behaviour" line is now marked partly superseded.
- [x] `CLAUDE.md` — the browser-suite flow count and list.

- [x] `docs/adr/0007-…md` — its "No browser coverage" consequence marked superseded, with a
      pointer to #80 for the proper rewrite. #96 was the change that actually falsified it;
      it went unamended then, and a normative paragraph should not stay wrong for ten more
      tickets.

**No query-module change and no Vitest change.** `getArchiveOverview()` already returns
`pinnedFullClears`, `firstRunAt` and `lastRunAt`, and `tests/db/archive-predicates.test.ts`
already asserts them. Nothing on this page is numerically new, which is why the only new
tests are the browser ones.

**Verified:** `npm run lint` 0 errors / 29 pre-existing warnings · `npm run build` OK (both
tsconfigs) · `npm test` 287 tests, 25 files · `npm run e2e` 32 specs. The three new specs
were confirmed red against the pre-#86 page first (stash the page, rebuild, run the file).
Note `npm run e2e` is **not** in `npm test` and runs on `pull_request` only, so a push to
this branch does not exercise them.

### #95 — Cache lifetime + share-card fallback

- [x] `src/lib/http/cache.ts` — `ARCHIVE_MAX_AGE_SECONDS` 86400 → **60**, at the single
      constant. `immutable` retained; the emitted header's shape, the one call site
      (`middleware.ts`) and everything the 2026-09-04 decisions entry verified on the wire are
      untouched, and no Cloudflare rule was added. `s-maxage` **stays at 86400** — the two
      lifetimes are now two constants, because one constant feeding both would have moved the
      shared-cache value that #81 does not ask about and #95 forbids changing (found by the
      Spec review axis, not on the way in). The browser constant carries a **RESTORE to 86400**
      comment naming #80's closing action, which is now also a checkbox above.
- [x] `src/app/gos10k/opengraph-image.tsx` — the `10000` / `5455` fallbacks are gone. The stat
      array is built only inside the `try`; on a throw it stays `undefined` and
      `brandedCard()` omits the stat block, so the card still renders with no figures rather
      than with confident wrong ones. The unfurl never fails outright. `CardStat` is now
      exported from `branded-card.tsx` and imported here rather than re-typed inline.
- [x] `docs/decisions.md` — the 2026-09-08 entry: the temporary lifetime and its expiry, the
      card change, the scope call below, and why there is no test.

**Deliberately not changed:** `src/app/gos10k/layout.tsx`'s OpenGraph `description` and the OG
route's `alt` also spell out "10,000" and "5,455". Decided explicitly, not missed — they are
static strings that never read the Archive, so no read failure can make them lie; making them
dynamic would add a per-request Archive read to a path that currently cannot fail, i.e. add the
failure mode #95 removes. Reasoning in the decisions entry.

**No test, and no seam invented for one.** #95 touches none of Phase 1's three agreed seams.
The cache value is checkable only against a running server; the card's no-figures branch has no
seam, and building one to reach a `catch` is application code changed to be testable. The OG
route stays listed as uncovered in `docs/handoffs/260803-playwright-e2e.md`.

**Verified:** `npm run lint` 0 errors / 29 pre-existing warnings (none in touched files) ·
`npm run build` OK (both tsconfigs) · `npm test` 287 tests, 25 files · `npm run e2e` 32 specs.
Both #95 behaviours were then checked against a real `next start` on port 3200, which is the
only way either is checkable:

- `curl -sSI /gos10k` → `cache-control: public, max-age=60, s-maxage=86400, immutable`, and
  `/gos10k/opengraph-image` the same (the middleware matcher covers it). `/api/leaderboard` still
  `max-age=0, s-maxage=60, stale-while-revalidate=240`, i.e. unaffected.
- `/gos10k/opengraph-image` with the real `data/gos-10k.db` → 200 `image/png`, card shows
  **10,000 full clears** and **5,455 guardians who helped**, read from the database.
- Restarted with `GOS10K_ARCHIVE_DB_PATH=/nonexistent/gos-10k.db`: `/gos10k` → **500** (loud,
  per ADR 0007) while `/gos10k/opengraph-image` → **200 `image/png`** rendering wordmark,
  title and subtitle with **no figures at all**. Both PNGs were opened and read, not just
  size-compared.

### #85 — Widen the Archive fixture

- [x] `scripts/extract-archive-fixture.ts` — rows now get in two ways. `TARGETS` is the
      original nine hazard rows, unchanged and each still carrying its `why`; `COHORTS` is
      nine SQL-defined slices, each stating the population a Phase 1 panel needs from it.
      The cohort SQL imports `PINNED_FULL_CLEAR` and `STARTED_FROM_BEGINNING` from
      `src/lib/db/archive/predicates.ts` rather than re-expressing either. Weapon rows are
      pulled for the nine targets only. The seed is serialised with the envelope indented
      and **every data row on one line** — at four-space indent the player table alone
      would be ~70,000 lines, and a committed fixture nobody can read the diff of is one
      that changes without being reviewed.
- [x] `tests/fixtures/archive-seed.json` — regenerated. **406 Runs, 2,482 player rows, 263
      weapon rows, 346 Clear Numbers**, 26 months spanned. 3,259 lines (was 3,798 for nine
      Runs), 1.8 MB. Gains a `cohorts` array beside `targets`.
- [x] `tests/db/archive-fixture-shape.test.ts` — **new.** Asserts the sample rather than any
      query: the hazard rows all survive, every non-clear population is present, every
      participant bucket from duo to seven-plus is non-empty, Helpers exist on both sides of
      a 15-clear floor, 2022-03 is an empty bucket inside the dense era, and weapon rows are
      targets-only. This is the file that fails if a re-extraction quietly drops a
      population; without it a panel's tests would stay green over data they no longer have.
      It names the populations through `PINNED_FULL_CLEAR` / `STARTED_FROM_BEGINNING` rather
      than spelling either out — the file counts Runs of each kind, and re-expressing a rule
      with a conjunct dropped is the mistake this Archive is careful about.
- [x] `tests/db/archive-predicates.test.ts` — figures updated (AC8). `runs` 9 → **406**,
      `completions` 6 → **369**, `pinnedFullClears` 4 → **346**, `disjunctiveFullClears` 5 →
      **366**, stored `is_full_clear = 1` 5 → **352**, `getRunsByYear()` 2020 `{runs: 2,
      fullClears: 1}` → **`{runs: 20, fullClears: 11}`**. The two rules' gap is now **20**
      rather than 1, and deliberately so: the fixture carries *all* 20 post-pin phase-0
      Runs, so the gap in the fixture is the 10,000-vs-10,020 difference itself.
- [x] `tests/db/archive-clear-number.test.ts` — ordinals `[1,2,3,4]` → **1..346**;
      invariants `{4, 4}` → **`{346, 346}`**. The non-contiguity probe writes **9999**
      rather than 99, which is now a real ordinal.
- [x] `tests/db/archive-connection.test.ts` — manifest figures `9` → **406** and `{4, 4}` →
      **`{346, 346}`**; the wrong-rule probe is `{366, 366}`.
- [x] `tests/helpers/archive-seed.ts` — `ArchiveSeed` gains `cohorts`. Still no `vitest`
      import and no `@/` alias (AC7).
- [x] `e2e/support/archive-world.ts`, `e2e/gos10k-smoke.spec.ts`,
      `src/lib/db/archive/index.ts`, `tests/README.md`, `tests/fixtures/README.md` —
      comments and prose that stated the nine-run size.

**#86's three shell specs and the smoke spec were not touched**, as the ticket predicted:
they assert no counts and no dates, and all 32 browser specs passed unchanged.

**Review fixes (second commit).** `undermanned-clears` took `LIMIT 6` over both the four- and
five-participant clears ordered by participant count, so the five bucket survived only because
the master happens to hold exactly four fours; it now takes up to three of each. The cohort
named `pre-pin-clears` selects *post*-pin Runs — #85's wording, not the data's — and is renamed
`disjunctive-only-clears`. Re-extracting moved two figures: 2,482 player rows (was 2,481) and 26
months (was 27), and the four/five buckets are 3/3 rather than 4/2.

**Verified:** `npm run lint` 0 errors / 29 pre-existing warnings (none in touched files) ·
`npm run build` OK (both tsconfigs) · `npm test` **295 tests, 26 files** · `npm run e2e` 32
specs, all green. The shape test was confirmed red against the nine-run seed first.

### #87 — The global range filter

- [x] `src/lib/db/archive/range.ts` — **new.** The half of the filter that needs no
      database: `RANGE_PARAMS`, `parseArchiveRangeRequest()`, `archiveRangeHref()`, the UTC
      day-boundary helpers, and `MILESTONE_PRESETS` + `resolveMilestonePresets()`. Presets
      are *data* (`{ kind: 'first-clears' | 'final-clears' | 'first-years' | 'final-years' }`)
      resolved by one audited arithmetic path against an `ArchiveSpan`, never against
      `Date.now()` — #71's bug class, and the AC with teeth. Everything degrades; nothing
      throws.
- [x] `src/lib/db/archive/range.test.ts` — **new**, colocated (pure logic, per
      `tests/README.md`). Parsing and degradation case by case, the href round-trip, the
      preset figures against a *synthetic* production-shaped span (clears 9,001–10,000 —
      the fixture's 346 would collapse "first thousand" and "final thousand" into the same
      range and prove nothing), and the anchoring test under `vi.setSystemTime()` at two
      dates five years apart.
- [x] `src/lib/db/archive/queries.ts` — `getArchiveSpan()`, `resolveArchiveRange()`,
      `ResolvedArchiveRange`, `UNFILTERED_ARCHIVE_RANGE`, and a private `rangeClause()` every
      panel query now carries. **Both modes resolve to one pair of `r.period` bounds**, which
      is what makes the equivalence criterion true by construction rather than by two WHERE
      clauses kept in agreement. The four panel functions take the range as an optional
      argument, so the share card and the existing tests still read the whole Archive.
      `getClassDistribution()` and the overview's Helper count now join `gos_10k_runs` so they
      can be scoped; `getTopHelpers()` keeps its `COUNT(DISTINCT r.instance_id)` (hazard 1).
- [x] `tests/db/archive-range.test.ts` — **new.** The arithmetic, against the fixture, with
      specific dates and specific Clear Numbers: clears 103–143 span 2022-02-01 to
      2022-02-21; 2022-02-01 to 2022-02-28 holds clears 103–143; both return the *same* 41
      Pinned Full Clears (the equivalence AC); clamping, the whole-Archive fallbacks, and
      each panel's filtered figures (44 runs / 41 clears / 58 Helpers, `Antarctica#6606` at
      24 runs and 22 clears, the Feb class split).
- [x] `src/app/gos10k/ArchiveRangeFilter.tsx` — **new.** The control: **two GET forms**, which
      is the whole mutual-exclusion mechanism — a browser submits the inputs of the form it
      submitted and nothing else, so there is no state to keep in sync and no way for the
      control to produce both ranges. Both expressions of the active range are read-only
      text, the presets are links into the same parameters, and "Show the whole Archive"
      appears only when there is something to clear. No client JavaScript.
- [x] `src/app/gos10k/range-copy.ts` — **new.** The phrasing shared by the page and the
      control (`clears 103–143`, `1 Feb 2022 – 21 Feb 2022`, `the whole Archive`), so a panel
      that states its window and the control that sets it cannot word it differently.
- [x] `src/app/gos10k/page.tsx` — now `async`, reads `searchParams`, resolves the range once
      and passes it to every panel. Each panel states the window it counts. The header's
      "complete through" band, the first/last Run sentence and its Helper count deliberately
      read `getArchiveSpan()` / the unfiltered overview instead: they are about the dataset,
      not about the selection.
- [x] `e2e/gos10k-range-filter.spec.ts` — **new**, six specs. Only the browser-only half:
      that applying one mode *drops the other mode's parameters* (a form-submission
      behaviour, not the page's code), the URL round-trip, the clear affordance, a
      hand-edited link degrading with its note, a preset link, and the control at 360 px.
      Asserts no fixture counts — the Clear Numbers it uses are typed in by the test.

**Two readings of "out-of-range degrades", and both ship.** A request that merely *overruns*
the Archive is clamped (`clears 340–9999` → 340–346): it has a real answer and discarding the
reader's intent would be worse. A request that selects **no Runs at all** — clears 9,001–10,000
against a 346-clear Archive, dates before it begins — degrades to the whole Archive with
`degraded: true`, because a page filtered to nothing reads as broken rather than as an answer.
A date window holding Runs but no clears is *kept* (November 2020: one Run, no clears); "no
full clears" is a true answer and the control says it in words.

**A URL carrying both modes is malformed, not resolved in either's favour.** The control
cannot produce one, and silently picking a winner would apply a filter nobody asked for.

**Browser coverage here is #80's decision 2, not scope creep past #81.** #81 says "No browser
coverage in this phase" and lists it Out of Scope *because the Archive had no harness*; #96 then
built one, and both this file and `docs/adr/0007` already record that which behaviours earn
assertions is answered "while building #87, #88 and #90". The six specs cover only what no other
seam can see — above all that submitting one mode drops the other mode's parameters, which is a
browser's form-submission behaviour rather than page code.

**Review fixes (second commit).** Both axes found real items.

- **The stat-tile grid stated no window** (Spec axis) — it was the one panel that read identically
  for the whole Archive and for one February, against the AC "every panel … states the population
  it counts". It now carries the same `{scope}` line as its neighbours.
- **The control is now `sticky top-0 z-10`**, which #81's panel order asked for ("2. **Range
  filter**, sticky") and #87's checklist does not mention.
- **A Clear Number range's date expression is the days it *spans*** — its bounds are the two
  Runs' own instants, so retyping those dates into the necessarily day-granular date form can
  select a clear or two either side. Documented at `resolveArchiveRange()` and pinned by a test
  on 2022-02-01, a day carrying thirteen clears: clears 104–105 filter to two, that day holds
  thirteen. The equivalence AC is unaffected — both modes still resolve to one pair of `period`
  bounds — and the equivalence test now says its window is aligned *on purpose* and asserts it.
- **Two date formatters, one of them not UTC-safe** (Standards axis). `page.tsx`'s local
  `formatDate` had no `timeZone`, so the header's dates were formatted in the server's zone
  while the filter's were UTC — the previous day for any Run in the small hours, and a different
  day on a box in another zone. Both now live in `range-copy.ts` and both pass `timeZone: 'UTC'`.
- **The two forms' markup was duplicated** (Standards axis) — ~45 near-identical lines each. Now
  one local `RangeForm`. The *two forms* stay two: that is the mutual-exclusion mechanism.
- **`getArchiveOverview()` ran twice per render** even unfiltered; the second read is now skipped
  when the range is the whole Archive.
- **`CONTEXT.md` gained the vocabulary this ticket introduced** (Standards axis): **Range**,
  **Degraded** — with the clamp-vs-degrade distinction, which had lived only in a code comment —
  and **Milestone Preset**.
- **Not changed:** `getTopHelpers(limit, range)` keeps its argument order, so the four existing
  `getTopHelpers(100)` call sites in `tests/db/archive-predicates.test.ts` stay as they are.

**Verified:** `npm run lint` 0 errors / 29 pre-existing warnings (none in touched files) ·
`npm run build` OK (both tsconfigs) · `npm test` **335 tests, 28 files** · `npm run e2e`
**38 specs**.

### #91 — Fastest clears list

- [x] `src/app/gos10k/duration-copy.ts` — **new.** `formatRunDuration(seconds)`: `7:33` under an
      hour, `3:23:54` over it. The ticket's own AC is that this is the *only* duration
      implementation the Archive has, because #92's median speed board renders the same column
      and `453` on one panel beside `7:33` on the other is the failure. Page-level copy, not SQL:
      the queries return raw seconds and `range-copy.ts` is the precedent for where formatting
      lives. **The Tracker's `PlayerProfileClient.tsx` has a private formatter of the same
      shape and is deliberately not imported** — it is a thousand-line `'use client'` component,
      and reaching into it would drag the client boundary across the two databases the repo
      keeps apart. Weighed, not missed; the file says so.
- [x] `src/app/gos10k/duration-copy.test.ts` — **new**, colocated (pure logic, per
      `tests/README.md`). Every expectation is a duration this Archive actually contains: 453
      (production's fastest, #81's reference figure), 676 (the fixture's fastest), 18820 (the
      fixture's slowest clear), plus the pad and hour-rollover boundaries.
- [x] `src/lib/db/archive/queries.ts` — `getFastestClears(limit = 10, range)`,
      `ArchiveFastestClear`, `ArchiveParticipant`. Follows #87's panel shape exactly: range last,
      defaulted to `UNFILTERED_ARCHIVE_RANGE`, scoped through the private `rangeClause()`.
      **Two statements, not one join.** A single query through `gos_10k_pgcr_players` returns
      six-plus rows per Run, which makes `LIMIT 10` mean ten *rows* — one and a half Runs. Rank
      first, then read the participants of exactly those instances. This is ADR 0001's
      fireteams-not-rows distinction reappearing on the Archive side.
      **Ordering is `duration ASC, period ASC, instance_id ASC`**: the fixture alone has two
      clears at 691s and two at 700s, and an untied order can differ between two databases for
      no reason a reader could see.
- [x] `tests/db/archive-fastest-clears.test.ts` — **new**, 9 tests. Specific instances and
      specific durations, per the ticket's test AC. Covers all three hazards: instance
      `9780072115` (7 player rows, 6 people — hazard 1, participants grouped on `membership_id`),
      instance `7085305400` (null display-name code — hazard 2, renders `bkuder12` through the
      shared formatter), and the pinned rule (hazard 3 — the fixture's 97-second Run is a reset
      and must not top a board of records). Also the tie ordering, the range scoping, and a
      one-clear range returning one row rather than a padded ten.
- [x] `src/app/gos10k/FastestClears.tsx` — **new.** Two lines per row: rank, duration, date and
      Clear Number on the first; every participant as a wrapping chip on the second. Runs, not
      players — a board of players puts the fastest fireteam's six members in the top six rows
      with identical times. The scope line uses `clears.length`, not a written-down ten, so a
      one-day filter does not print a heading that contradicts the list under it.
- [x] `src/app/gos10k/page.tsx` — `getFastestClears(10, range)` and the panel, placed after the
      Helper board per #81's render order.
- [x] `e2e/gos10k-fastest-clears.spec.ts` — **new**, 1 spec (2 as first landed; the second was
      dropped in review, see below). Only what no other seam can see:
      that the chips actually **wrap onto more than one line at 360px** and neither the chip row
      nor the page scrolls sideways. `flex-wrap` is a computed-layout fact — the server-rendered
      DOM carries the class either way. Asserts no counts and no names.
- [x] `e2e/gos10k-smoke.spec.ts` — the canary locator is now scoped to the Helper board. The
      canary is joined to every Run in the seed, so it renders as a chip in all ten fastest-clear
      rows too and the old unscoped `getByText` became strict-mode ambiguous — a real consequence
      of this panel, caught by the suite. Narrowed rather than `.first()`: the binding being
      asserted is that the *Helper board* read the fixture. (It landed as `getByRole('cell', …)`
      and the cleanup pass below replaced that with a testid — see there for why.)
- [x] `CLAUDE.md` — nine browser flows → ten.

**Production reconciliation (#91's 453 AC).** The fixture is a 406-Run sample and its fastest
clear is 676s, so no test asserts 453 against it — that would be asserting a number the database
does not contain. Reconciled by hand instead, running this query's SQL against the shipped
`data/gos-10k.db`: unfiltered, the fastest Pinned Full Clear is **453 seconds, Clear Number 9,701,
6 people**, rendering as **7:33**. The next four are 455, 456, 461 and 465. The formatter's
`453 → 7:33` is pinned in Vitest.

**Review fixes (second commit).** Both axes ran against #91 with #81 as parent.

- **`participant` was on CONTEXT.md's _Avoid_ list three times** (Standards, hard) — under
  **Roster**, **Helper** and **Player-Run**, all Tracker entries. But #81 mandates the word for
  the Archive ("the participants column… labelled as people who entered, not fireteam size"), so
  the glossary and the parent spec genuinely disagreed. Resolved by amending rather than
  renaming: the three _Avoid_ lines now point at a new **Participant** (Archive) entry, which
  states the distinct-membership rule, the 430 seven-plus clears, and why a Roster is a weaker
  claim than who demonstrably entered. **Fastest Clear** (Archive) added alongside it, carrying
  the Runs-not-players rationale that had lived only in a TSX comment.
- **"The 1 fastest Pinned Full Clears"** (Spec) — reachable, and this ticket's own one-clear-range
  test proves it. The panel now says "The fastest Pinned Full Clear … everyone who was in it".
- **The `MAX()` name projection was duplicated** across `getTopHelpers` and `getFastestClears`
  (Standards), and taking each name column's `MAX()` independently could in principle splice one
  row's name onto another's code (Spec). One `PLAYER_NAME_PROJECTION` now, and the splice was
  **checked rather than argued**: across all 217 duplicate (instance, membership) pairs in the
  shipped Archive, zero disagree on any of the three name columns. The Archive cannot gain a row
  (ADR 0007), so that check cannot go stale — the constant's comment says both halves.
- **One e2e spec was dropped** (Spec, scope creep). Asserting every row has a non-empty
  participant list is Vitest's fact, not a browser-only one; #81 rules browser coverage out of
  Phase 1 except where a behaviour has no other seam, and only the chip wrapping qualifies.
- **The duration formatter's comment argued the wrong thing** (Standards). It rebutted importing
  from the Tracker's `'use client'` file without considering extraction to a pure shared module —
  which is what `predicates.ts` already did for the same shape of problem. The duplication stands
  (extracting touches a Tracker feature; #91 is an Archive ticket) but the comment now says so
  instead of arguing it away. **Open follow-up, not a closed question.**
- **`docs/handoffs/260803-playwright-e2e.md` gained its entry** — CLAUDE.md points at that file as
  the coverage list and the nine→ten bump had contradicted it. It is gitignored, so it does not
  appear in the diff.
- **Not changed:** the `scope` prop name on `FastestClears` (flagged as a mysterious name). `scope`
  is what #87 named this string in `page.tsx`; repo precedent overrides the baseline smell.
- **Kept, and since confirmed by the user:** the `clear {n}` field on each row. #91 asks for
  "rank, duration and date", so this is a fourth field the ticket did not ask for. It stays
  because the Clear Number ties the record to the range control above it in that control's own
  denomination (ADR 0008) — `clear 9,701` is a value the reader can paste back into the filter.
  Raised as scope creep by the Spec review and **put to the user on 2026-09-10, who kept it**.
  Not an open question any more; a later ticket removing it is changing a decision, not tidying.

**Verified:** `npm run lint` 0 errors / 29 pre-existing warnings (none in touched files) ·
`npm run build` OK (both tsconfigs) · `npm test` **349 tests, 30 files** · `npm run e2e`
**39 specs**.

**Cleanup pass (third commit, `b84a1fd`).** Behaviour-neutral — same lint counts, both tsconfigs
clean, `npm test` and `npm run e2e` unchanged. Four extractions and one correction:

- **`formatClearNumber(n)` moved into `src/app/gos10k/range-copy.ts`** and both callers use it:
  the range control's single-clear window and each fastest-clears row. These had been two
  spellings of `clear 9,701` on one page — the duplication `duration-copy.ts` exists to prevent,
  missed by both review axes. The `clear {n}` field itself still stands unasked (above).
- **`expectNoHorizontalPageOverflow(page)` extracted to `e2e/support/viewport.ts`**, replacing
  the `documentElement.scrollWidth - clientWidth` probe hand-rolled in the shell, range-filter
  and fastest-clears specs. How page overflow is measured is one decision and three specs
  should not drift on it. Playwright-only, so it may import `@playwright/test` directly — that
  restriction binds `tests/helpers/`, which both runners share.
- **The smoke spec's canary locator became `getByTestId('archive-top-helpers')` + `getByText`**,
  and the Helper board table gained that testid. `getByRole('cell', …)` had `.first()`'s failure
  mode one step slower: it binds to "whatever is in a `<table>`", so the first of #88–#94 to ship
  as a table would silently capture the assertion. Name the panel you mean.
- **`membershipType` dropped from `ArchiveParticipant`.** Nothing read it —
  `formatBungieDisplayName()` takes the three name columns and falls back to `membershipId`.
  `PLAYER_NAME_PROJECTION` still projects the column, because `getTopHelpers` does use it, and
  its comment now says which callers need which columns. The frozen-dataset caveat and its
  217-pairs/0-disagreements evidence are untouched.
- One `isSingle` const in `FastestClears.tsx` replaces the singular-grammar ternary written
  twice, and the participant map builds with get-or-create instead of get-copy-set. Same output.

### #92 — Median speed board (this chunk)

- [x] `src/lib/db/archive/queries.ts` — `getMedianSpeedBoard(limit = 15, range)`,
      `ArchiveMedianSpeedHelper`, and the exported `MEDIAN_SPEED_CLEAR_FLOOR = 15`. #87's panel
      shape again: range last, defaulted to `UNFILTERED_ARCHIVE_RANGE`, scoped through the
      private `rangeClause()`. **The floor is exported because the panel has to state it** — a
      floor a reader cannot see is indistinguishable from a Helper who is missing (the ticket's
      "in the visitor's terms, not only in the code" criterion).
      **SQLite has no `median()`**, so it is the standard window-function form: a `DISTINCT
      (membership, instance, duration)` CTE, `ROW_NUMBER()` and `COUNT(*)` partitioned by
      membership, then `AVG()` over `position IN ((clears + 1) / 2, (clears + 2) / 2)` — integer
      division, so an odd count selects one row and an even count the two either side. Reading
      every (Helper, duration) pair into TypeScript instead is ~60,000 rows per request in
      production for a fifteen-row board.
      **The `DISTINCT` is hazard 1**, and it bites twice here: counting player rows would push a
      multi-character Helper over the floor *and* weight that Run several times in the median.
      **Two statements, not one join**, as `getFastestClears`: rank first, then read the names of
      exactly the memberships that made the board, which keeps `LIMIT` denominated in Helpers and
      the window functions off a query that also has to `GROUP BY` four name columns.
      **Ordering is `medianSeconds ASC, clears DESC, membershipId ASC`.** The fixture ties two
      Helpers at 884s on rows 14 and 15 — the cut of a 15-row board — so untied it is the query
      plan that decides which of them a reader sees. More clears wins: the board is about
      consistency, and 61 clears is more evidence of it than 15.
- [x] `tests/db/archive-median-speed.test.ts` — **new**, 10 tests, figures computed independently
      from `tests/fixtures/archive-seed.json` rather than read back off the query. Unfiltered,
      28 Helpers clear the floor and the board's top row is `孑孓#4862`, 18 clears, median
      **725.5** — the ticket's even-count case, and it is rank 1 rather than a corner case.
      `Azźyyy#2886` sits **exactly on the floor** at 15 clears and rank 6, which is the row a
      `> 15` drops and nothing else. The odd-count case is that same row (763s, a real Run's own
      duration). Range scoping is February 2022 (clears 103–143), where exactly one Helper
      reaches fifteen — a one-row board, which the panel must also survive.
- [x] `src/app/gos10k/duration-copy.ts` — `formatMedianDuration(seconds)`, delegating to
      `formatRunDuration` after `Math.round`. **A true median over an even clear count is
      fractional** (725.5), and `formatRunDuration` floors by design because it renders an integer
      column of real Run durations. Handing it 725.5 prints the lower of the two middles on every
      even-count row and looks exactly like a correct answer. The rounding decision is therefore
      stated once, in copy, and the formatting itself is still the one shared implementation #91
      introduced — this board cannot render a duration differently from the list above it.
- [x] `src/app/gos10k/duration-copy.test.ts` — two tests for the wrapper: `725.5 → 12:06` (the
      fixture's top row) and a whole-second median rendering identically through both functions.
- [x] `src/app/gos10k/MedianSpeedBoard.tsx` — **new.** Three columns — Guardian, Full clears,
      Median clear — with the floor and the median-not-mean reasoning in the panel's own copy,
      beside `describeArchiveRange()`'s scope line. **The empty state is prose, not an empty
      table**: any single-day range holds one clear, so nobody can reach fifteen, and three
      headings over nothing reads as a broken panel. Its own `data-testid="archive-median-speed"`
      rather than a role locator, for the reason #91's cleanup wrote down.
- [x] `src/app/gos10k/page.tsx` — `getMedianSpeedBoard(15, range)` and the panel, placed directly
      after the fastest-clears list per #81's render order. The two are adjacent on purpose: one
      good night and sustained form only read as a comparison side by side.
- [x] `e2e/gos10k-median-speed.spec.ts` — **new**, 2 specs (1 as first landed), and the same rule #91 settled on:
      assert only what no other seam can see. The medians, the floor, the tie-break and the empty
      state are Vitest's; what is left is the phone criterion, since a three-column table whose
      first column is `Name#Code` in full is the likeliest thing on this page to overflow 360px
      and the server-rendered DOM is identical whether it does or not. Asserts no counts, no
      names, no durations.
- [x] `CONTEXT.md` — **Median Clear Duration** (Archive), carrying **Clear Floor** in its second
      paragraph rather than as a competing entry. Records why the floor is 15 and measured (51 of
      725 Helpers reach it within clears 9,001–10,000; only 32 reach 25), why it is fixed (URL-driven
      server rendering — a slider is a full render per drag tick), and that an even count is
      legitimately fractional.
- [x] `CLAUDE.md` — ten browser flows → eleven.

**Review fixes (second commit).** Both axes ran against #92 with #81 as parent.

*Spec axis, 1 finding acted on.* The empty-state criterion says "renders an intelligible empty
state … **asserted in a test**", and the Vitest assertion only proved the *query* returns nothing
— its own comment conceded the panel was the other half. The render half is now
`e2e/gos10k-median-speed.spec.ts`'s second spec, at `?clearFrom=103&clearTo=104`: heading still
present, table absent, reason stated. A component test would have been the cheaper seam in a repo
that had one; this one runs Vitest in `node` with no jsdom, and standing up a rendering harness
for one branch is more machinery than the branch is worth. Three findings were raised and kept as
they are, with reasons: the browser spec against #81's "no browser coverage" Out of Scope line
(#91 set the precedent, #80 records that each ticket decides, and the phone criterion has no other
seam — but it is a deliberate departure, not an oversight); the median tie-break and its test (an
editorial call the ticket did not make, which fixes real nondeterminism at the 15-row cut); and
`formatMedianDuration` (an added public function, which is what keeps the one shared formatter
shared rather than forking it).

*Standards axis, no hard violations; 3 of 5 judgement calls acted on.*
- **`MEDIAN_SPEED_BOARD_ROWS = 15` is now its own constant**, because `getMedianSpeedBoard(15,
  range)` had two unrelated fifteens in one call — rows of Helpers and clears per Helper — and the
  test asserted the row count off the bare literal, so a change to the floor would have read as a
  change to the board's height. This repo has been bitten by exactly this shape: ADR 0001's
  active-session cap is two limits in two units.
- **The unreachable name fallback is gone.** `formatBungieDisplayName`'s last rung is already the
  membership id, so the fallback object it was being handed added nothing; the miss is now one
  ternary that says so.
- **The panel says "present for"**, not "with": every Run in this Archive is the subject's, so a
  Helper is present for a Pinned Full Clear rather than the owner of one. CONTEXT.md's **Helper**
  entry makes the same distinction.
- *Not acted on:* the name-hydration statement is the **second** "rank, then re-read names" block,
  after `getFastestClears` — **not the third.** The review said third and named `getTopHelpers`
  alongside it; that is wrong and is corrected here rather than left to mislead the next reader.
  `getTopHelpers` is a **single statement**: it projects `PLAYER_NAME_PROJECTION` inside its own
  `GROUP BY p.membership_id` and never re-reads anything, because it already groups on the table
  the names live in. So there are two such blocks and they are **different shapes** —
  `getFastestClears` hydrates *participants* per instance (`GROUP BY p.instance_id,
  p.membership_id`, carrying `MIN(p.start_seconds)` for entry order), `getMedianSpeedBoard`
  hydrates *names* per membership. A shared `namesFor(ids)` would fit the second and not the
  first. Left alone because collapsing them is a refactor of a shipped panel rather than a #92
  change, the way #91 left the Tracker's duplicate duration formatter — but the case for it is
  weaker than the review made it sound, not stronger.
- *Not acted on:* **Clear Floor** stays a bolded term inside the **Median Clear Duration** entry
  rather than becoming its own. The user prefers amending an entry over adding a competing one,
  and the floor is not a concept that stands up away from the statistic it gates.

**No second median implementation, and no floor knob.** The floor is a module constant, not a
parameter with a default: a parameter is a knob, and the ticket's reason for fixing it — a slider
is a full server render per drag tick — is an argument against having one at all. Tests read the
exported constant rather than the literal 15, so a change to it fails the boundary test loudly.

### #88 — Timeline (this chunk)

- [x] `src/lib/db/archive/queries.ts` — `getMonthlyClears()`, `ArchiveTimelineMonth`, and the
      private `monthsBetween()`. **The one panel query that takes no range**, and that is the
      ticket rather than an oversight: #81 makes the timeline the single deliberate exception to
      the global filter, so there is no argument through which the *counts* could be narrowed.
      (It takes one optional `ArchiveSpan`, added by the cleanup commit below, which fixes the
      axis's two ends and is not a `ResolvedArchiveRange`.)
      Writing `getMonthlyClears(range)` and splicing `rangeClause()` into it — the shape every
      panel since #87 has, and therefore the shape a reader reaches for — compiles, renders, and
      truncates six years to one February.
      **Gap-filled**, which is a real step and not a formality: `GROUP BY strftime('%Y-%m', …)`
      returns only the months holding a Run, and a chart drawn off it renders a two-year pause as
      the space between two bars. `getRunsByYear()` is the existing `strftime` precedent and does
      *not* fill — it is a table, where a missing year is a missing row rather than a squashed
      axis — so it was the wrong thing to copy. Months are enumerated in TypeScript (integer
      arithmetic over two `YYYY-MM` keys) rather than by a recursive CTE.
      **Anchored to `MIN`/`MAX(r.period)`, never to a clock** — the standing rule in the Notes
      below. A timeline ending at "now" grows an empty tail every month against a frozen dataset.
      Measured on the shipped `data/gos-10k.db`: **4–18 ms**, 75 months, 8 of them empty,
      cumulative 10,000. The median board remains the page's slowest query at 146 ms.
- [x] `tests/db/archive-timeline.test.ts` — **new**, 7 tests, figures computed independently from
      `tests/fixtures/archive-seed.json` with `node -e`, not read back off the query. The fixture
      spans **68 months of which only 20 hold a clear**, so it is an unusually good witness for
      the empty-month criterion; 2022-03 is empty *between* two 40-clear months (the extraction
      script samples across it deliberately), which is the case a reader would actually notice.
      One test asserts the no-truncation property structurally — `getMonthlyClears.length === 0`,
      i.e. the function has no *required* parameter to scope through, and its one optional
      parameter is a span rather than a range — alongside the behavioural one.
- [x] `src/app/gos10k/timeline-geometry.ts` + `.test.ts` — **new**, pure, colocated. The x-axis
      arithmetic: `timelineBand()` and `yearTicks()`, both over `YYYY-MM` keys alone. Extracted
      rather than inlined because the band is drawn **twice** and the ticket's "the shading reads
      across both charts" is a claim about them being the same geometry, not similar geometry.
      **The band's minimum width is one month of the axis, not a percentage picked by eye.** A
      single day of six years is 0.05% — a third of a pixel on a phone — and the first draft used
      a flat 1.5%, which is *wider than a month* on a 68-month axis and so widened almost every
      range anyone would actually pick. One month is self-explanatory against the bars underneath
      it. The widening slides back inside the chart at the right-hand edge: the Archive's own last
      day is the likeliest single-day selection, and a band drawn past 100% shades nothing.
- [x] `src/app/gos10k/ArchiveTimeline.tsx` — **new.** Two `<svg>`s sharing one `viewBox` width,
      both `w-full`, both `preserveAspectRatio="none"` so the chart is full-bleed at any width
      with no text inside to smear; the polyline carries `vector-effect="non-scaling-stroke"`
      because non-uniform scaling would otherwise render the stroke as a wedge. One SVG stacking
      both regions was rejected: the two heights would become a single scale factor, so the bars
      would squash whenever the line grew. Year labels are **HTML**, not SVG text, so they stay at
      a real font size on a phone. **No chart library** — this repo has none, #81 asks for none,
      and the `By year` bars are already a div with a percentage width; adding a dependency to
      draw two polylines is a decision for the user, not a default.
- [x] `src/app/gos10k/page.tsx` — the panel directly under the range control (#81's render order),
      and `getMonthlyClears()` called beside a comment saying why it is not handed the range
      (it takes the `span` the page already read; see the cleanup commit below).
- [x] `e2e/gos10k-timeline.spec.ts` — **new**, 3 specs. See the #80 note below.
- [x] `CONTEXT.md` — **Month Bucket** and **Shaded Band** (Archive), carrying the empty-month rule
      and the annotation-not-filter distinction.
- [x] `CLAUDE.md` — eleven browser flows → twelve.

**#80's decision 4 is answered here: the timeline's shading is asserted, structurally.** #88's own
criterion says the browser-only behaviour is "verified by hand and recorded as unverified by
automated tests" — written when the Archive had no harness. #96 built one, and #80 names the
shading as "the item with real regression risk", so the criterion is **superseded rather than
honoured**, deliberately and on the record (a comment on #80, not only here). The hand
verification still happened — desktop and 360px, against the production Archive, screenshots taken.

The assertion style, which is the decision #80 actually asks for: **structural, and only about
geometry no other seam can see.** The bucket counts and the empty months are Vitest's; the band's
*position* is Vitest's too, in the geometry module's own tests. The browser asserts what rendering
twice can get wrong — that the band exists when a range is active, that it does not when none is,
that both charts place it at the same x and width (±1px for independent layout rounding), and that
it is a band rather than the whole chart. The phone spec asserts both overflow probes plus a
minimum rendered band width, which is the criterion's "still identifiable" half.

**The phone probe earned its keep immediately**: `expectNoElementOverflow` failed on the first run
with 13px of overflow, caused by the last year label starting at ~97% of the axis and running off
the edge. Fixed by flipping labels past 90% to end at their boundary rather than start at it.

### #88 — review fixes (second commit)

Both axes ran against `331d028...HEAD` with #81 as parent. **No hard standards violations and no
spec gaps**; four judgement calls acted on, one finding rejected on evidence.

- [x] `src/lib/db/archive/month-keys.ts` — **new**. `monthIndex` and `monthsBetween` exported,
      `monthKey` file-local. The
      `YYYY-MM` walk existed three times in the #88 diff (the query's private helper, the geometry
      module, and the geometry test's expected axis) — three chances to be off by a month against
      the other two, with no seam that could notice. It lives beside `predicates.ts` and `range.ts`
      because the key is the Archive's own shape: the query names the bucket and everything
      downstream reads that name. Pure, no connection, so a script or a component can import it.
- [x] `src/lib/db/archive/queries.ts` — `cumulativeClears` is `MAX(r.clear_number)` per month,
      carried forward across empty months, instead of a running sum in TypeScript. ADR 0008 stores
      that ordinal so the page stops re-deriving it ("an ordinal eight call sites re-derive is an
      ordinal eight call sites can re-derive *differently*"), and the derivation ranks over this
      same `PINNED_FULL_CLEAR` by `period ASC` — so the highest ordinal inside a month *is* the
      count through the end of it. The two agree today; what changes is which failure they produce
      if this predicate ever drifts to the disjunctive rule. Summed, the line climbs to 10,020
      while the filter above it still says 10,000 — two axes disagreeing, both plausible. Read off
      the column, the *bars* break instead, visibly, and a test says so.
- [x] `src/app/gos10k/timeline-geometry.ts` — `yearTicks` positions each label by month-key
      arithmetic rather than `months.indexOf('2022-01')`, which returns `-1` for any year whose
      January is absent: a negative percentage, and a label for a mid-axis year drawn off the left
      edge. Safe only because `getMonthlyClears()` gap-fills, and this module is exported, pure and
      unable to enforce that. The first year's pinning to the origin now falls out of the clamp
      instead of being a special case. The contiguity assumption is stated in the module doc, and
      `axisPercent` and `yearTicks` share one `offsetPercent`, so the band and the ticks cannot
      drift onto different scales.
- [x] `src/app/gos10k/ArchiveTimeline.tsx` — the two sentences about the band are driven off `band`
      rather than off `range.mode`. The panel was deciding "is there a band" twice from two
      readings of the range; "The shaded band is clears 103–143" above a chart with no band on it
      is the failure, and it renders perfectly.
- [x] `tests/db/archive-timeline.test.ts`, `src/app/gos10k/timeline-geometry.test.ts` — two new
      tests. The line is asserted to still equal the running sum of the bars (the price of reading
      the ordinal is that the panel's two halves now come from two places, so their agreement has
      to be stated rather than structural) and to end at `getArchiveSpan().maxClearNumber`; the
      ticks are asserted against a deliberately gapped month list. The test's expected axis is now
      built with `monthsBetween`, so it cannot drift from the one the page gets.

**Rejected, on evidence: the band "misses a one-sided date range".** Standards read
`timelineBand` returning null unless both `periodFrom` and `periodTo` are set as a gap against a
range every other panel honours. There is no such state: `parseArchiveRangeRequest` returns
`malformed` for a truncated pair — deliberately, since "clears 9,001 onwards" is a fourth thing the
control cannot draw — and every malformed request resolves to the whole Archive. Both period bounds
are non-null in both real modes. The single-source-of-truth fix above is the defensible half of
that finding.

**Left alone at the time, as flagged in the handoff:** `formatMonth()` stripping the day off
`formatArchiveDay()` with a regex rather than adding a fourth formatter to `range-copy.ts`. The
cleanup commit below reversed that call and added the formatter.

lint 0 errors / 29 pre-existing warnings · both tsconfigs clean · `npm test` 376 tests / 33 files ·
`npm run e2e` 44/44.


### #88 — cleanup (`c262568`, third commit)

Not review-driven; a pass over the shipped panel after the fixes above. Verified at that commit:
lint 0 errors / 29 pre-existing warnings, both tsconfigs clean, `npm test` 376 / 33, `npm run e2e`
44/44 — the three timeline specs included, which is what checks the band's new units.

- **`getMonthlyClears(span: ArchiveSpan = getArchiveSpan())`.** The page reads the span once for
  the header and the presets; the chart now takes it rather than running a second `MIN`/`MAX(period)`
  of its own. The point is not the saved aggregate, it is the second *definition* of where the
  Archive begins: the header stating one extent above a chart drawn to another is a disagreement
  nothing would catch. **The no-truncation guarantee survives** — a defaulted first parameter keeps
  `getMonthlyClears.length === 0`, an `ArchiveSpan` is not a `ResolvedArchiveRange` so a range
  cannot be passed where it goes, and the bucket query stays unfiltered, so no span changes what
  the chart counts. What it *can* now do, which it could not before, is move the axis's two ends —
  unreachable in practice, since `getArchiveSpan()` is the one figure set documented as never
  obeying the range.
- **`scope` is no longer a prop**; `describeArchiveRange(range)` is derived inside the component,
  next to the band it describes. This is the review's single-source-of-truth fix carried one step
  further: the sentence and the rect are two readings of one `range` value rather than two props
  that could arrive from different ones. The trailing caption goes through `formatArchiveDayRange()`,
  which already collapses a single-day selection and already answers for null ends.
- **`formatArchiveMonth()` in `range-copy.ts`** replaces `formatMonth()`'s regex — the one Standards
  judgement call the fix commit left alone. A label built by stripping `^\d+\s` is coupled to
  `en-GB` putting the day first, so a locale change or a long month would produce a wrong label
  rather than a compile error.
- **`monthIndexAt(instant)` in `month-keys.ts`.** `axisPercent` was still spelling
  `getUTCFullYear() * 12 + getUTCMonth()` out by hand, which was a fourth copy of the arithmetic the
  module was extracted to give one home. `monthKey` became file-local in the same pass:
  `monthsBetween` is its only caller, and an exported inverse nothing imports reads as a contract.
- **The band is positioned in percentages**, straight onto the `rect`, which SVG resolves against
  the `viewBox` width — so `ShadedBand` no longer takes `AXIS_WIDTH` as a third prop whose only job
  was to agree with the axis. The two-charts-agree spec is what proves the units still line up.
- **`peak` is seeded as `{ month, clears }`** rather than a whole `ArchiveTimelineMonth`, so the
  reduce's shape says what it is: a max-by-clears, not a month.


### #90 — Helper board (this chunk)

- [x] `src/lib/db/archive/queries.ts` — **`getTopHelpers` is gone**, replaced by
      `getHelperBoard(limit: number | null = HELPER_BOARD_ROWS, range)` returning
      `ArchiveHelperPresence` (`runs`, `clears`, `secondsWithSubject`, `secondsInRun`) plus
      `getHelperBoardSize(range)` and the exported `HELPER_BOARD_ROWS = 25`. Removed rather than
      kept beside the new one: its `fullClears` field and the new `clears` are the same number
      under two names, and two functions ranking the same population differently is the drift
      this file's docblocks keep warning about.
      **`limit: null` means every row** (`LIMIT -1` in SQLite), which is what show-all binds.
      **`getHelperBoardSize` is deliberately not `getArchiveHelperCount(range)`** — the latter
      counts everyone in any Run, the board's population is everyone in a *Pinned Full Clear*,
      and in November 2020 that is 0 against a non-zero helper count. Using the wrong one would
      make the panel's own sentence disagree with the rows under it.
      **`runs` and `clears` are different columns on purpose** (the ticket's separate-columns
      criterion): `runs` counts `DISTINCT r.instance_id` over *all* Runs in range, `clears` only
      the Pinned Full Clears, and the gap between them is what the board exists to show.
      **The overlap is computed here, in SQL, not in the page** — the ticket says so explicitly.
      One statement with five CTEs: `clears`, `intervals`, `subject`, `presence`, `names`, `runs`.
      **`intervals` is hazard 1 wearing a third face.** It collapses each (instance, membership)
      to one envelope — `MIN(start_seconds)` to `MAX(start_seconds + time_played_seconds)` —
      before any overlap is taken. Summing overlap across character *pairs* instead double-counts
      the stretch two of the subject's own characters share, and it is not a rounding error: the
      first draft returned 105,278s of overlap for `Wolf#6888` against 103,912s he was in those
      Runs at all, an impossible row on the board's top line, off by 1,366s. Instance 8827366043
      is the one that does it — the subject's two characters run `[3, 3029]` and `[597, 2233]`.
      The envelope also matches the ticket's own wording, "his own interval in the same Run",
      singular. `secondsWithSubject <= secondsInRun` on all 382 fixture rows is pinned as a test.
      **Ranking is `clears DESC, runs DESC, membershipId`** and does *not* change with the time
      column: both measures come back on every row from one query, so the toggle swaps a reading
      of the same board rather than producing a second board. The ticket's "two swaps in the top
      fifteen" line is the spec author's analysis of a time-ranked board, not a requirement.
      **A `names` CTE rather than `getFastestClears`' two-statement `IN (...)` pattern**, because
      show-all would otherwise bind several thousand parameters. `PLAYER_NAME_PROJECTION` is
      reused, so hazard 2 (174 NULL name codes) still goes through `formatBungieDisplayName`.
- [x] `tests/db/archive-helper-board.test.ts` — **new**, 15 tests. Named Helpers and specific
      durations, as the ticket requires: `MESRINE#4991` at `{ secondsInRun: 6486,
      secondsWithSubject: 1504 }`, `pharaloover#4706` at `{ secondsInRun: 3895,
      secondsWithSubject: 0 }` (there, but never at the same time as him — the zero the `0 h`
      rendering exists for), and the top three exact pairs. `KaRNaGxFuRy#5001` is the
      multi-character row: counted **once** in clear 102, which is hazard 1's assertion.
      **The empty-board case is November 2020**, not the Archive's last day — the last day does
      hold clears, and the first draft of that test failed with a dump of them. November 2020 has
      1 Run and 0 Pinned Full Clears, and the same test asserts `getArchiveHelperCount()` is
      non-zero there, which is the population difference above, pinned.
- [x] `src/app/gos10k/helper-board-view.ts` + `.test.ts` — **new**, 8 tests. `helperTime` and
      `helperRows` as URL parameters rather than client state, for three reasons written into the
      docblock: a pasted link reproduces the view (#81's ninth story), show-all as client state
      means shipping several thousand hidden rows to save a navigation, and a `<Link>` is
      assertable where a `useState` is not. `helperBoardHref` is built **on top of**
      `archiveRangeHref`, not beside it — a second place spelling out `clearFrom`/`clearTo` is how
      a "show all" link silently drops the reader's filter, and a test pins the carried range.
      It takes the `ArchiveRangeRequest`, not the resolved range, so a degraded range is not
      written back as though the reader had asked for it. Unknown values degrade to the default
      view, which the `?canary=` nonce also depends on.
- [x] `src/app/gos10k/duration-copy.ts` + `.test.ts` — `formatPresenceHours`, and 9 tests.
      **Not `formatRunDuration`**: these columns are tens of hours over hundreds of Runs and
      `28:55:47` reads as one very long raid. `0 h` and `<0.1 h` are deliberately different
      strings — the first is a real nothing (a Helper who left before he arrived), the second a
      Helper who was demonstrably there, and `0.0 h` for the second says the opposite of what the
      row means. Both are reachable on show-all.
- [x] `src/app/gos10k/HelperBoard.tsx` — **new**, a server component like every other panel.
      The two time readings live in one `TIME_COLUMN` record because the header, the cell, the
      explanatory line and the toggle pill all have to agree what `inRun` means, and a switch in
      each is four places to disagree. The toggle is two `<Link>`s with `aria-current` on the
      active one. `data-testid="archive-helper-board"` (the old `archive-top-helpers`),
      `archive-helper-time-header`, `archive-helper-time-toggle`,
      `archive-helper-board-expand` — the header and the expand link because their *text*
      changes with the view, the table because three panels on this page render a `<table>`.
- [x] `src/app/gos10k/page.tsx` — parses the view, keeps the `ArchiveRangeRequest` beside the
      resolved range (the panel's links need it), and renders `<HelperBoard>` in #81's slot.
      The inline placeholder table is gone.
- [x] `e2e/gos10k-helper-board.spec.ts` — **new**, 4 tests: the default 25 rows and
      `Time with him` header, the toggle swapping the column *while preserving `clearFrom`/
      `clearTo`*, show-all expanding and reversing, and the 360px probe over the table, the
      toggle and the page. No names, counts or durations — those are Vitest's, and repeating
      them here breaks on every fixture re-extraction.
- [x] `e2e/gos10k-smoke.spec.ts`, `e2e/support/archive-world.ts` — the canary locator follows the
      testid rename, and the world's comments follow the new `ORDER BY`. **The canary survives
      the ranking change**: joined to every Run it holds 346 clears, the fixture maximum, and
      `0000000000000000001` wins the tie, so it is still deterministically row one. Its time
      columns render `0 h` — the seeded rows leave `start_seconds`/`time_played_seconds` at 0 —
      which is written down in `archive-world.ts` so no future spec asserts a duration on it.
- [x] `tests/db/archive-predicates.test.ts`, `tests/db/archive-range.test.ts` — the three hazard
      tests that went through `getTopHelpers` moved to the new file (a pointer comment is left
      behind); the range test now calls `getHelperBoard(1, february())` and asserts `clears: 22`.
- [x] `CONTEXT.md` — **Presence** and **Time Alongside** (Archive). The second entry is where the
      envelope collapse is written down in prose, because it is the thing a future panel reading
      `start_seconds` will otherwise rediscover the same way this one did.
- [x] `CLAUDE.md`, `docs/handoffs/260803-playwright-e2e.md` — twelve browser flows became
      thirteen, 44 specs became 49.

**The phone criterion found a real bug, in the hand verification rather than in the suite.**
At 360px against the *production* Archive, `?helperRows=all` overflowed the **page** by 11px while
the table's own box measured clean: a 31-character unbreakable name (Bungie caps a name at 26
characters, plus `#dddd`) made the `w-full` auto-layout table *grow* rather than scroll. The name
cell is `wrap-anywhere` — `overflow-wrap: anywhere`, not Tailwind's `break-words`, because only the
former shrinks a cell's min-content width, which is what a table sizes its columns from; the count
columns are `whitespace-nowrap` so a wrapped `2,488` cannot read as a second row. The fixture
cannot reproduce it — its longest name has spaces — so the spec that now covers the expanded board
at 360px is a regression guard and says so.

**#80's decision 2 is answered here, and the ticket's own AC is superseded.** #90 lists the
time-column toggle and the show-all expansion as browser-only behaviour to be hand-verified and
*recorded as unverified*. That was written assuming client state. Both shipped as links into the
same URL, so both are asserted in Chromium instead — the same substitution #88 made for its
shaded band. Recorded on #80 rather than left in a commit message.

## Notes and traps carried forward

- **`is_full_clear = 1` alone is 10,040, not 10,000.** Four full-clear predicates now exist
  across the two databases; the Archive's two each carry "and the subject finished it".
- **No `Date.now()` / `new Date()` reading the clock in `src/lib/db/archive/` or
  `src/app/gos10k/`.** #87's presets anchor to `getArchiveSpan()`, and its test pins that they
  resolve identically five years apart. The `new Date(...)` calls that exist all *format* a
  timestamp the database supplied; none of them ask what time it is now, and a panel ticket
  that introduces one reintroduces #71's bug on a dataset that stopped moving in 2026.
- **The Archive's cache `max-age` is 60 and must go back to 86400.** #95 shortened it for UI
  iteration; restoring it is the closing action on #81 and nothing but this line, the
  constant's comment and `docs/decisions.md` will remind you. Do not "fix" anything else about
  that header — the origin value was verified byte-identical on the wire on 2026-09-05.
- **The share card asserts nothing it did not read.** If a panel ticket adds a figure to
  `opengraph-image.tsx`, it goes inside the `try` — a hardcoded fallback there is the exact
  failure ADR 0007's verify-on-open exists to prevent, in the one artifact that gets shared.
- **`/gos10k`'s card is the only one that behaves this way.** The three sibling
  `opengraph-image.tsx` routes under `src/app/` still `catch { clears = 0 }`, i.e. they fall back
  to a figure. That is defensible for live Tracker data — 0 is not a claim about a frozen
  dataset — but it means copying a sibling reintroduces the pattern #95 removed. Left alone
  deliberately: they read the Tracker, not the Archive, and are outside #95.
- **The unfurl's *prose* still names 10,000 and 5,455**, in `src/app/gos10k/layout.tsx`'s
  OpenGraph description and the OG route's `alt`. Decided, not missed — see the 2026-09-08
  decisions entry — but it does leave #81's story 42 partly open, and a broken Archive shows a
  figureless card beside prose that still asserts both numbers.
- **The e2e Archive is knowingly *not* identical to the Vitest one.** It carries one extra
  helper — the per-run canary — so the Helper board and the class split differ by those rows.
  Nothing asserts either, and the difference lives in `e2e/support/archive-world.ts` rather
  than in the shared seed, which stays byte-deterministic for #84's ordinal assertions.
- **Every panel from here takes the range.** A new panel query takes
  `range: ResolvedArchiveRange = UNFILTERED_ARCHIVE_RANGE` and carries `rangeClause(range)`,
  which filters on `r.period` in *both* modes — so a query joining through
  `gos_10k_pgcr_players` must join `gos_10k_runs` to be scopeable at all. Filtering a Clear
  Number range on `clear_number` instead would be a second, disagreeing definition of the
  same window and would quietly break the equivalence AC. The timeline (#88) is the one
  deliberate exception: it draws the full history and shades the selection.
- **Two more `data-testid`s on `/gos10k`** — `archive-range-summary` and
  `archive-range-degraded` (plus `archive-range-filter` and `archive-range-clear`). They
  exist because the copy they hold is a whole sentence whose *figures* move with the fixture;
  the forms themselves are located by role (`getByRole('group', { name: 'By date' })`).
- **#80's decision 2 is recorded (#87 and #90) and decision 4 is recorded (#88, above).** What
  remains for #80 is updating ADR 0007's "no browser coverage" consequence.
- **The serving copy and the master are copied to the box by hand** (`docs/decisions.md`).
  After #84, a stale copy is now a wrong-analytics risk, not just a stale-counts one — but
  the new invariant assertions make that failure loud.
- **One `data-testid` now exists on `/gos10k`** — `archive-headline-figure`, because the
  headline's *value* moves the moment #85 widens the fixture, so no text locator can hold it.
  Its label needs no testid: the headline is a `figure`/`figcaption` pair, so the suite
  locates it as `getByRole('figure', { name: 'Pinned Full Clears' })`. A panel ticket
  rendering the same number-plus-label shape should reach for that structure, not a testid —
  every other locator in the browser suite is role- or text-based.
- **The fixture's figures are 406 / 346, not 9 / 4.** Four test files pin them. A panel
  ticket asserting a count reads them off the built fixture, and
  `tests/db/archive-fixture-shape.test.ts` is where the sample's *shape* is guaranteed — if
  a panel needs a population the sample lacks, widen a cohort there rather than working
  around it in the panel's test.
- **Weapon rows in the fixture cover the nine hazard Runs only.** Phase 2's weapon work
  needs a wider pull; it is a one-line change to the extractor, and it needs the master.
- **The seed is one JSON row per line and must stay that way.** Reformatting it with
  `JSON.stringify(…, null, 4)` would produce a ~70,000-line file.
- **The stat grid no longer carries a pinned-full-clear tile.** #86 promoted it to the
  headline. A panel ticket that "restores" it would state the page's own name twice.
- **The duration formatter is `src/app/gos10k/duration-copy.ts` and #92 imports it.** That is
  #91's own acceptance criterion, not a preference: two panels render the same column, and the
  failure it prevents is `453` on one beside `7:33` on the other. A second `formatDuration` in
  a panel file fails the ticket even if every number in it is right.
- **The e2e canary is joined to every Run in the seed**, so it renders in any panel that names
  participants — it is a chip in all ten fastest-clear rows. A new spec matching it by text must
  scope to the panel it means; an unscoped `getByText` is strict-mode ambiguous and will look
  like a fixture problem rather than a locator one.
