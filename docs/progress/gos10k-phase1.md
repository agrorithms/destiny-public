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
- [ ] **#85** Widen the Archive fixture
- [ ] **#87** The range filter (largest ticket; gates Wave 3)
- [ ] **#91** Fastest-clears list (owns the shared duration formatter)
- [ ] **#92** Median speed board (imports #91's formatter)
- [ ] **#88** Timeline
- [ ] **#90** Helper board
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

### #95 — Cache lifetime + share-card fallback (this chunk)

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

## Notes and traps carried forward

- **`is_full_clear = 1` alone is 10,040, not 10,000.** Four full-clear predicates now exist
  across the two databases; the Archive's two each carry "and the subject finished it".
- **No `Date.now()` / `new Date()` in `src/lib/db/archive/` or `src/app/gos10k/`.** There is
  none today. #87's milestone presets must anchor to the Archive's own span, not to now.
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
- **#80's decisions 2 and 4 are still open.** #96 built the harness and one smoke spec only;
  which behaviours earn assertions is answered while building #87, #88 and #90.
- **The serving copy and the master are copied to the box by hand** (`docs/decisions.md`).
  After #84, a stale copy is now a wrong-analytics risk, not just a stale-counts one — but
  the new invariant assertions make that failure loud.
- **One `data-testid` now exists on `/gos10k`** — `archive-headline-figure`, because the
  headline's *value* moves the moment #85 widens the fixture, so no text locator can hold it.
  Its label needs no testid: the headline is a `figure`/`figcaption` pair, so the suite
  locates it as `getByRole('figure', { name: 'Pinned Full Clears' })`. A panel ticket
  rendering the same number-plus-label shape should reach for that structure, not a testid —
  every other locator in the browser suite is role- or text-based.
- **The stat grid no longer carries a pinned-full-clear tile.** #86 promoted it to the
  headline. A panel ticket that "restores" it would state the page's own name twice.
