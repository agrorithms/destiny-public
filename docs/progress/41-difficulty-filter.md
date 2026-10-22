# #41 — Difficulty filter from the activity hash

Branch `feat/41-difficulty-tier`, base `main` @ a3a3e16. Spec: `gh issue view 41` (parent #32,
which has no progress file). Decisions and their reasons: the issue body, plus the gitignored
grilling handoff `docs/handoffs/261022-issue-41-difficulty-filter-grilling.md`.

Seams approved before any test:
1. pure: `src/lib/bungie/manifest.test.ts`, which drives the hash→Difficulty lookups (AC 2, AC 8's
   "known ahead of time" half);
2. DB: `tests/db/{leaderboard,fastest-clears,raid-stats}.test.ts`, which drive the runners with
   `filters.difficulty` (AC 1, 3–6, 9);
3. route: `tests/routes/{leaderboard,raid-stats}.test.ts`, which drive `GET` (AC 3, 4, 6 over
   HTTP, and AC 8's server half: boards omitted);
4. browser: `e2e/leaderboard-difficulty.spec.ts` (AC 7, AC 8's browser half, phone width).

Settled at the seams stop: the API leaves out boards for raids with no version at the requested
Difficulty, and `raidKeys` echoes the narrowed set; `hashes` becomes `{ [hash]: Difficulty }`;
Normal is `activity_hash NOT IN (Master ∪ Epic)`, so a hash outside `RAID_DEFINITIONS` is Normal.

## Chunks

1. The table and its lookups
   - [x] `src/lib/bungie/manifest.ts`: `hashes` tagged with a Difficulty; `getDifficultyFromHash`, `getRaidKeysWithDifficulty`, `getHashesWithDifficulty`
   - [x] `src/lib/bungie/manifest.test.ts` (new)
   - [x] `scripts/cleanup/debug-sessions.ts`: reads the new `hashes` shape. Gitignored (`scripts/cleanup/*`), so the edit is local only and no commit carries it
2. Server: the clause, the routes, the omitted boards
   - [x] `src/lib/db/queries.ts`: `buildRaidFilterClause` on `activity_hash`, accepts `epic`
   - [x] `src/lib/cache/leaderboard-cache.ts`: boards narrowed to raids with a version at the Difficulty
   - [x] `src/app/api/leaderboard/route.ts`: accepts `difficulty=epic`
   - [x] `src/app/api/analytics/raid-stats/route.ts`: accepts `difficulty=epic`
   - [x] `tests/db/leaderboard.test.ts`
   - [x] `tests/db/fastest-clears.test.ts`
   - [x] `tests/db/raid-stats.test.ts`
   - [x] `tests/routes/leaderboard.test.ts` (new)
   - [x] `tests/routes/raid-stats.test.ts` (new)
3. UI, e2e and bookkeeping
   - [x] `src/hooks/useLeaderboardPrefs.ts`: `DifficultyFilter` accepts `epic`
   - [x] `src/app/leaderboard/page.tsx`: the Difficulty dropdown, back on both tabs
   - [x] `e2e/support/seed-world.ts`: VoG Normal/Master and DP Epic runs
   - [x] `e2e/leaderboard-difficulty.spec.ts` (new)
   - [x] `docs/e2e-coverage.md`: flow list and journal entry
   - [x] `docs/progress/41-difficulty-filter.md` (this file)

## Surviving mutants

None. No `Stryker disable` comments.

## Notes

- **Mutation, three loops.** Loop 1 (full): 59.1% (88/149), FAIL. Sixty survivors were the table's
  tags and `buildHashMap`'s calls: they run while `manifest.ts` loads, and the test imported the
  module once at the top, so no mutant was ever live in it. `manifest.test.ts` now does
  `vi.resetModules()` + `await import('./manifest')` in `beforeEach`, as
  `tests/scanner/scanner-position.test.ts` does. The new `hashToDifficultyMap.clear()` was
  redundant (it's built once, at import) and is gone. One more survivor was `state: 'bypass'` on
  the no-board path; the route test now asserts `X-Cache: BYPASS`. Loop 2 (incremental) left
  `hashToRaidMap.set` (a changed line), killed by "every version of a raid still resolves to that
  raid". Its summary also reused stale results for `src/lib/active-session/*` from an earlier
  ticket's incremental file, which isn't in this diff. Loop 3, the full run with `--typecheck` at
  `561e299`: 100% overall (63/63), 100% covered, PASS; 85 compile errors discarded (a tag blanked to
  `""` isn't a `Difficulty`).
- **Not every test was red first.** In `tests/db/`, the rewritten composition tests (e.g.
  "difficulty + exactPlayers compose correctly") passed against the old tier-based clause too,
  because their seeds happen to agree on both readings. The tests that cross hash and tier are the
  ones that failed; mutation testing covers the rest.
- **e2e red run** at `03ff690`: the nine new specs failed and the 17 existing leaderboard,
  Fastest Clears and player-name specs passed with the new seed.
- `scripts/cleanup/debug-sessions.ts` is gitignored, so its one-line update to the new `hashes`
  shape is local to this checkout.
- `useLeaderboardPrefs.ts` takes `Difficulty` as a type-only import from `manifest.ts`, which
  imports `fs`. It is erased at build, so the client bundle doesn't pull the module in.
