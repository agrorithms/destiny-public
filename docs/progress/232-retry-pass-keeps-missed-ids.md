# #232 — A Retry Pass cut short keeps the Missed Ids it never reached

Spec: `gh issue view 232 --repo agrorithms/destiny-public`. Branch `feat/232-retry-pass-keeps-missed-ids`, base `fix/scanner-id-hole` @ `c5e3275`.
Seams and decisions approved 2026-11-06:

- All seams drive the real `startScanner` loop against a real SQLite file with only `fetch` stubbed (ADR 0003 and 0004 followed; no ADR contradicted or hardened).
- Seam 1: `describe('a retry pass cut short')`, proving AC1, AC2, AC3, the cap-free half of AC4 and part of AC5.
- Seam 2: the two pinned lines gain ` | Position: <id>`, proving AC4 for both lines. The existing `of 2 retried` line also guards against a count taken from `nextIndex`.
- Seam 3: a separate cap test, `SCANNER_MAX_MISSED_IDS=1`, proving AC4's "after any cap count". It goes beyond the ticket's "one cut-short test"; the user chose to keep it as a separate short test.
- Seam 4: the existing `logs nothing for a retry pass that recovers no raid`, unchanged, proving AC5. It is green before and after, so its bite proof is one temporary uncommitted break.
- `retryLines` moves to file scope beside `loggedLines`.

1. Failing tests, red
   - [x] `tests/scanner/scanner-position.test.ts` — seams 1, 2 and 3, `retryLines` moved (red run on the old scanner: 4 of 32 failed. The cut-short test failed on the ids asked for, the two unreached ids never being asked again; the two pinned lines and the cap test failed on the missing suffix)
2. The queue rule and the log lines, green
   - [x] `src/lib/scanner/index.ts` — the pass keeps the queue, ids leave on `raid` or `not_raid`, `attempted`, `Position:` on both lines, `addMissedIds` and `stillMissingIds` gone
3. Bite proofs and suite
   - [x] `docs/progress/232-retry-pass-keeps-missed-ids.md` — this file
   - `npm run mutate:diff -- c5e3275...HEAD --typecheck`, full run at `f14d2a1`: 100.0% overall (14/14), 100.0% covered, 1 compile error discarded, 0 ignored, no survivors, threshold PASS, no kill-and-rerun loops needed. Both `missedIdsSet.delete` lines were mutated and killed, and the cap test killed the seven mutants on the cap line.
   - The `Stryker disable` comment above the `missedIdsSet.size > 0` guard is unchanged, and no new one was added.
   - Seam 4's bite, a temporary uncommitted hand break: `retryRaidsFound > 0` to `>= 0` at `f14d2a1` failed `logs nothing for a retry pass that recovers no raid`, plus the cut-short test and the pinned retry line (3 of 32). Reverted with `git checkout`; the tree was clean afterwards.
   - The cut-short test can't tell a count taken from `nextIndex` here, because the top guard breaks before the claim with one worker. The pinned `of 2 retried` line is what catches that.
   - The throw path comes from reading the code: not reproduced, no test. The queue rule covers it with no code of its own.
4. Quality
   - [x] /simplify pass — `retryMissedIds` takes its own snapshot and checks before it claims an index, so `attempted` is `nextIndex` and the separate counter is gone. This replaces the `nextIndex` caveats above: the pinned `of 2 retried` line now guards a count that does come from `nextIndex`. `importScannerWithEnv` replaces the hole-batch helper and the cap test's copy of it. No `expect` line changed.
5. Review fixes
   - [x] S1 `tests/scanner/scanner-position.test.ts` — the cap test's comment says Missed Id. `firstGap` keeps its name.
   - [x] S2 `CONTEXT.md` — the Missed Id entry says "Ids a crossing skips never become Missed Ids.", because `scanBatch` queues the misses of a short Id Hole that has a confirmed id past it in the same batch.
