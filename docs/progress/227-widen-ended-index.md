# #227 — Widen the pgcrs ended_at index with the scope flags; 30d raid stats are Full Clears only

Spec: `gh issue view 227 --repo agrorithms/destiny-public`. Branch `feat/227-widen-ended-index`, base `main` @ `c65857a`.
Seams and decisions approved 2026-11-07:

- S1: `tests/db/raids-in-progress-index.test.ts` pins `idx_pgcrs_ended_period_raid_clear`'s columns, and that reopening a Tracker carrying the old `idx_pgcrs_ended_period_raid` drops it. Hardens ADR 0009, implements ADR 0006's second 2026-11-07 amendment.
- S2: `tests/db/raid-stats.test.ts` "windows above 168h": `allAttempts` null at 169h, computed at 168h, distinct from an empty `fullClear` at 720h, and the scalar fields still count every instance at 720h. Hardens ADR 0006.
- S3: `tests/routes/raid-stats.test.ts`: `hours=720` carries `"allAttempts": null` on the wire, `hours=168` an object.
- `INDEXED BY` has no Vitest test (decision 2a). It is proven by `EXPLAIN QUERY PLAN` under the backup's stale `sqlite_stat1`, recorded below.
- ADR 0009's "The covering index no longer covers." bullet gets an in-place pointer to #227 (decision 6b).

1. Failing tests, red
   - [x] `tests/db/raids-in-progress-index.test.ts` — S1
   - [x] `tests/db/raid-stats.test.ts` — S2
   - [x] `tests/routes/raid-stats.test.ts` — S3
   - Red run on the old code: 5 of 38 failed. Both index tests (no widened index; the old one not dropped), the 169h and 720h null tests, and the route's `hours=720` null. The 168h boundary, the 720h scalar fields and the route's `hours=168` pass before and after: they guard what must not change
2. The index, the hint and the 30d rule, green (superseded: see steps 4–5. `RAID_STATS_INDEX` and the top-level per-scope table became literals in the functions, and the tests' `?.` reads became `!.`)
   - [x] `src/lib/db/schema.ts` — DROP the old index, CREATE the widened one, comment
   - [x] `src/lib/db/queries.ts` — `ALL_SCOPES_MAX_HOURS`, `RAID_STATS_INDEX`, the per-scope `pgcrs` source, `RaidStatsRow`, comments naming the index
   - `tests/db/raid-stats.test.ts` also needed `?.` on the existing `allAttempts` reads (and a throw in the class-sum loop) once the type allows `null`. No assertion changed: a `null` there still fails each test
3. Docs, measurements and bite proofs
   - [x] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — pointer on the covering-index bullet
   - [x] `docs/progress/227-widen-ended-index.md` — this file, with the real-data hashes, plans and timings

## Real-data checks (2026-11-07, x86 under WSL2)

The harness is in the session scratchpad, not the repo (decision 4a). Data: two `cp`s of `data/raid-tracker.backup-2026-11-05.db` (2,073,886,720 bytes, max `ended_at` 1793931697). The live DB was never opened. "Before" is a `git archive 0f26684 src` with the repo's `node_modules`, run on one copy. "After" is this branch's `src`, run on a fresh copy, so its first `getDb()` did the DROP and CREATE. Both run the real `getRaidStats` and `getRaidsInProgress` through `getDb()`, with `RAID_TRACKER_DB_PATH` set to the copy and `Date.now` pinned to max `ended_at` × 1000. SQLite 3.51.2 (repo better-sqlite3).

**The open.** The first open by branch code on the copy took 3,031 ms, page cache evicted beforehand. The file grew by 3,784,704 bytes (2,073,886,720 → 2,077,671,424). Afterwards `pgcrs` had `idx_pgcrs_ended_period_raid_clear` and no `idx_pgcrs_ended_period_raid`. The grill's 1.4 s was the same DDL with a warm cache.

**Byte-identical** (sha1 of `JSON.stringify(rows)`, first 12 hex; 720h projected to the scalar fields + `fullClear`):

| window, filters | rows | before | after | after `allAttempts` |
|---|---|---|---|---|
| 24h | 13 | f5d27a4abef2 | f5d27a4abef2 | computed |
| 168h | 13 | d28e24106872 | d28e24106872 | computed |
| 720h | 13 | b7533d17e7a5 | b7533d17e7a5 | null for every raid |
| 168h difficulty=master | 6 | b4ab9696093d | b4ab9696093d | computed |
| 24h maxPlayers=3 | 13 | e9188216a90f | e9188216a90f | computed |
| 720h difficulty=normal | 13 | 0f6c9a206766 | 0f6c9a206766 | null for every raid |
| 168h exactPlayers=6 | 13 | 72b21c30bb1f | 72b21c30bb1f | computed |

The row order is in the hash and didn't change, so no `ORDER BY` was added (decision 7a).

**Plans** (`EXPLAIN QUERY PLAN` of the statements the app actually prepared, with their own parameters; `pgcrs` access only):

| statement | before, backup (prod `sqlite_stat1`) | after, backup (prod `sqlite_stat1`) | after, fresh DB (no stats) |
|---|---|---|---|
| scalar | `INDEX idx_pgcrs_raid_ended (ANY(raid_key) AND ended_at>?)` | `COVERING INDEX idx_pgcrs_ended_period_raid_clear (ended_at>?)` | same as backup |
| scalar + difficulty/maxPlayers | `INDEX idx_pgcrs_raid_ended` | `INDEX idx_pgcrs_ended_period_raid_clear (ended_at>?)` (reads `activity_hash`) | same |
| fullClear | `INDEX idx_pgcrs_raid_ended (ANY(raid_key) AND ended_at>?)` | `INDEX idx_pgcrs_ended_period_raid_clear (ended_at>?)` | same |
| allAttempts (planner's choice) | `INDEX idx_pgcrs_raid_ended` | `INDEX idx_pgcrs_raid_ended` (unchanged) | `INDEX idx_pgcrs_ended (ended_at>?)` |
| `endedRaidRuns` (sweep + curve, 24h/7d/30d) | `COVERING INDEX idx_pgcrs_ended_period_raid (ended_at>? AND ended_at<?)` | `COVERING INDEX idx_pgcrs_ended_period_raid_clear (ended_at>? AND ended_at<?)` | same |
| #204's sweep + both flags (hand-written) | `INDEX idx_pgcrs_ended` (not covering) | `COVERING INDEX idx_pgcrs_ended_period_raid_clear` | same |

The backup's `sqlite_stat1` has rows for `idx_pgcrs_ended`, `idx_pgcrs_raid_ended`, `idx_pgcrs_raid_key`, `idx_pgcrs_period` and the autoindex, all at 2,664,160. It has none for the old or the new `ended_at` index. The sweep needs no `INDEXED BY`. Removing the hint from getRaidStats would put the scalar query and Full Clears back on `idx_pgcrs_raid_ended` under prod's statistics. Only this check shows that, not a test (decision 2a).

**Timings, per statement** (ms; cold = `sync` + `posix_fadvise(DONTNEED)` + `fincore` 0 B, plus `PRAGMA shrink_memory` before each statement; three cold runs, then two warm):

| window | statement | before cold | after cold | before warm | after warm |
|---|---|---|---|---|---|
| 24h | scalar | 115 / 136 / 101 | 20 / 26 / 17 | 17 / 17 | 22 / 16 |
| 24h | fullClear | 939 / 759 / 713 | 610 / 488 / 479 | 109 / 106 | 90 / 88 |
| 24h | allAttempts | 1,016 / 869 / 975 | 969 / 923 / 868 | 424 / 422 | 411 / 411 |
| 168h | scalar | 476 / 541 / 498 | 251 / 228 / 236 | 295 / 282 | 273 / 206 |
| 168h | fullClear | 5,799 / 5,717 / 5,375 | 3,289 / 3,103 / 2,997 | 1,160 / 1,163 | 1,117 / 1,019 |
| 168h | allAttempts | 7,441 / 8,898 / 7,411 | 7,514 / 6,891 / 8,733 | 6,403 / 4,930 | 5,482 / 5,108 |
| 720h | scalar | 2,400 / 3,037 / 2,670 | 1,535 / 1,615 / 1,571 | 1,598 / 1,348 | 1,440 / 1,278 |
| 720h | fullClear | 27,237 / 27,186 / 26,993 | 13,592 / 13,380 / 13,864 | 7,304 / 6,241 | 4,636 / 4,528 |
| 720h | allAttempts | 40,897 / 40,476 / 36,772 | not computed | 25,792 / 25,973 | not computed |

`getRaidStats` end to end, warm: 24h 551 / 546 → 523 / 516 ms; 168h 7,860 / 6,377 → 6,875 / 6,335 ms; 720h 34,696 / 33,565 → 6,077 / 5,807 ms. Cold end to end at 720h is 67.6–72.0 s → 15.7–16.2 s, including the evictions.

The 24h and 168h plans are no slower. The two changed statements are faster, and allAttempts keeps the same plan and lands within its run-to-run spread.

**The 30d cold Full Clears miss misses the ~9–10 s target in absolute terms.** Scope statement plus scalar is ~15 s here (13.4–13.9 s + 1.5–1.6 s). The whole machine ran ~1.5x slower than on the grill's day:

- Today's baseline is 27.0–27.2 s + 2.4–3.0 s, against the grill's 17.1 s + 1.5 s.
- A grill-style re-run (a fresh readonly connection, default cache, the branch's exact 720h SQL) gives the same picture: scalar 1,440 / 1,325 / 1,359 cold, 1,263 / 1,446 warm; fullClear 15,478 / 13,501 / 12,861 cold, 4,369 / 4,315 warm.

So the gap isn't the app's connection settings. The ratio holds: ~2.0x on Full Clears cold, against the grill's 1.86x.

4. Kill loop 1
   - [x] `src/lib/db/queries.ts` — `RAID_STATS_INDEX` and the top-level `RAID_SCOPE_PGCRS` are gone. The scalar query spells `FROM pgcrs p INDEXED BY idx_pgcrs_ended_period_raid_clear`, and the per-scope `pgcrs` source is a local in `queryScope`, each with its comment. The index name is written twice, which the user accepted. No assertion changed
   - [x] `src/lib/db/schema.ts` — the open cost now reads ~3.0 s cold (1.4 s warm) and +3.8 MB, x86 (orchestrator finding O1)

5. /simplify pass
   - [x] /simplify pass — 4 cleanup agents. `8fd9482`: reflowed the index comments in `schema.ts` and `queries.ts`, said the hint skips the table only when the request is unfiltered, and the scope-predicate docblock now names the 168h gate. `7c56897`: `allAttempts!.` in place of `?.` in the tests at or under 168h, so a `null` fails the test, where `?.` let `.not.toBeNull()` pass on one. The route tests share one `raids(query)` helper. Bite proof for the changed `expect` lines: `mutate:diff -- c65857a...HEAD --incremental` at `7c56897`. 9 of 9 mutants in `queries.ts` killed, among them `hoursBack > ALL_SCOPES_MAX_HOURS` → `true`, which `returns class distribution as counts per class` kills through `allAttempts!.`

**Timings, filtered (`difficulty: 'master'`)** (review finding P1, at `b1a7cfe`, same harness, copies and method; `HARNESS_FILTERS` passes the filter to `getRaidStats`). Under prod's `sqlite_stat1` the filtered scalar query moved from `idx_pgcrs_raid_ended` to the widened index, both with table lookups for `activity_hash`. 168h was run twice per side, the second time after first; the two runs are separated by `;`:

| window | statement | before cold | after cold | before warm | after warm |
|---|---|---|---|---|---|
| 24h | scalar | 91 / 88 / 88 | 88 / 89 / 102 | 10 / 10 | 13 / 11 |
| 24h | fullClear | 191 / 181 / 195 | 162 / 183 / 190 | 12 / 12 | 7 / 7 |
| 24h | allAttempts | 464 / 473 / 477 | 452 / 517 / 451 | 46 / 49 | 48 / 47 |
| 168h | scalar | 408 / 387 / 378; 393 / 412 / 385 | 547 / 559 / 509; 527 / 583 / 514 | 167 / 140; 144 / 132 | 136 / 119; 145 / 127 |
| 168h | fullClear | 1,479 / 1,521 / 1,453; 1,435 / 1,468 / 1,444 | 1,298 / 1,529 / 1,290; 1,311 / 1,527 / 1,301 | 172 / 168; 173 / 175 | 82 / 79; 101 / 76 |
| 168h | allAttempts | 3,391 / 3,675 / 3,685; 3,665 / 3,560 / 3,435 | 3,636 / 3,669 / 3,515; 3,668 / 3,576 / 3,696 | 513 / 547; 526 / 524 | 582 / 543; 533 / 509 |

`getRaidStats` end to end: 24h cold 1,295 / 1,270 / 1,332 → 1,220 / 1,365 / 1,430 ms (incl. evictions), warm 68 / 72 → 69 / 65 ms. 168h cold 5,817 / 6,149 / 6,112; 6,043 / 6,081 / 5,892 → 6,029 / 6,443 / 5,951; 6,063 / 6,293 / 6,092 ms (incl. evictions), warm 853 / 856; 845 / 832 → 800 / 742; 779 / 713 ms.

One statement is slower outside its spread: the filtered 168h scalar query cold, 378–412 → 509–583 ms (~+130 ms, ~1.35x), in both pairs of runs. Full Clears gains back about as much cold and halves warm, so end to end the 168h cold request lands within its spread and the warm one is faster. 24h is unchanged within spread. Put to the user as a decision; no code changed for it. The user accepted the regression on 2026-11-07: the request end to end is unchanged cold (within spread) and faster warm.

## Review fixes

- [x] P1 — filtered timings above; the 168h cold scalar regression was accepted by the user on 2026-11-07
- [x] S1 — `src/lib/db/schema.ts`: the two flags let the Full Clears predicate filter on the index, not the table (it still reads the table for `instance_id`)
- [x] O2 — `src/lib/db/queries.ts`: the `INDEXED BY` comment re-wrapped to its neighbours' width
- [x] S2 — `tests/db/raids-in-progress-index.test.ts`: dropped `toHaveLength(5)`, which `testDb()` had already satisfied before the reopen; the first test pins the new index's columns
- [x] S3 — `tests/routes/raid-stats.test.ts`: `Body['raids']` is `RaidStatsRow[]`
- [x] S4, P2 — step 2 above marked superseded
- [x] S6 — `tests/db/raids-in-progress-index.test.ts`: the docblock says the flags let the Full Clears predicate filter on the index, not the table (the scope still reads the table for `instance_id`), as S1 made `schema.ts` say
- [x] P3 — this file: the P1 regression recorded as accepted, in "Timings, filtered" and in P1's line above

## Bite proofs

- The red run is recorded in step 1.
- Run 1, `npm run mutate:diff -- c65857a...HEAD --typecheck` at `e535116`: 57.1% overall (4 of 7), three survivors.
  - They were the string literals in the top-level `RAID_STATS_INDEX` and `RAID_SCOPE_PGCRS`. Each one, made by hand, failed the tests: 29, 29 and 26 of the 29 tests in `tests/db/raid-stats.test.ts`, with a SQL syntax error. So they weren't equivalent.
  - They survived because the constants are evaluated when the module loads, before Stryker switches the mutant on: the case #195 and #196 hit.
  - The user chose to turn them into literals inside the functions, as those tickets did.
- Loop 1 (`0f11950`), `--incremental` rerun: no survivor in this branch's files. That run's summary also listed `src/lib/active-session/` mutants, which come from the incremental cache, not from this range.
- Final full run, `npm run mutate:diff -- c65857a...HEAD --typecheck` at `0f11950`: 100.0% overall (6 of 6), 100.0% covered. 3 compile errors discarded, 0 ignored, 0 static. The threshold wasn't applied (fewer than 8 scored). No `Stryker disable` comments.

## Surviving mutants

None.

## Suite

At `0f11950`, then again at the commit that adds this line (which changes only this file): `npm run lint` 0 errors (29 warnings, all in `gos10k/`, there before this branch); `tsc` passes for the app and for `scripts/`; `npm run build` passes; `npm test` 920 of 920 tests in 62 files. Not a UI ticket, so no e2e or visual:check.

After the /simplify pass, at `7c56897` (the commit adding this line changes only this file): `npm run lint` 0 errors (the same 29 `gos10k/` warnings); `tsc` passes for the app and for `scripts/`; `npm run build` passes; `npm test` 920 of 920 in 62 files.
