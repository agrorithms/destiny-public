# #230 — Scanner crosses an Id Hole instead of stopping behind it

Spec: `gh issue view 230 --repo agrorithms/destiny-public`. Branch `fix/scanner-id-hole`, base `main` @ `aa31005`.
Seams and decisions approved 2026-11-05:

- Seam A: the real `startScanner` loop against a real SQLite file, with only `fetch` stubbed. Seam B: a recording `console` spy on `log` and `warn`; the wording is the spec, and no ADR 0004 edit. Seam C: `findNextStoredInstanceId` in `src/lib/db/queries.ts`, reached only through Seam A.
- An empty batch is `result.misses === config.batchSize`, not `.every` over `results`, which is sparse after a stop mid-batch.
- The empty-batch count and `warnedAtPosition: bigint | null` are locals in `startScanner`. `SCANNER_HOLE_EMPTY_BATCHES` is read only in `DEFAULT_SCANNER_CONFIG`, default 5, and printed in the banner.
- Order: retry first, then crossing, so the test that a crossed hole's ids aren't retried can bite with no threshold in the way. Each is a red commit plus a green commit.
- The `missedIdsSet.size > 0` guard stays, with the one approved `Stryker disable` comment.
- CLAUDE.md's knob entry was approved; the orchestrator makes that edit.

1. Retry after every catch-up pause, red then green
   - [x] `tests/scanner/scanner-position.test.ts` — `describe('missed ids')` rewritten, log tests, `stubBungie` per-id answers, console spy (red run: 5 of 10 failed at `443ef95`. The AC8 rewrite passes at base, so its bite was a temporary break, the queue loop bound set to `results.length`: it failed, reverted)
   - [x] `src/lib/scanner/index.ts` — `RETRY_THRESHOLD` gone, pause and retry log lines
2. Crossing an Id Hole, red then green
   - [x] `tests/scanner/scanner-position.test.ts` — `describe('crossing an Id Hole')` (red run at `fe5ca1b`: 15 of 27 failed; the two `does not cross` cases pass at base, so the mutation run is their bite. AC5's bite was a temporary break, queueing the first batch's ids at the crossing: `never asks for the crossed ids again` failed, reverted)
   - [x] `src/lib/scanner/index.ts` — `holeEmptyBatches`, the banner line, the count, `warnedAtPosition`, the crossing, comments
   - [x] `src/lib/db/queries.ts` — `findNextStoredInstanceId`
3. Bite proofs and suite
   - [x] `docs/progress/230-scanner-id-hole.md` — this file
   - `npm run mutate:diff -- aa31005...HEAD --typecheck`, full run at `6f7984b`: 100.0% overall (38/38), 100.0% covered, 11 compile errors discarded, 4 ignored, PASS; no loops needed.
   - Stryker made no mutants of the SQL text, so that had hand bites, each reverted: `>` to `>=` and `ORDER BY instance_id DESC` each failed `lands on the lowest one` and `needs a full count`.
   - The approved comment ignores all four mutants on its line, including the two killable ones (`false`, `<= 0`). Hand bite, reverted: `size < 0` failed four retry tests.
   - Prod-shape reproduction from the diagnosis session: green, position +10498 past the hole, and a queue of 45 retried.
   - Lint, build and vitest at `6f7984b`: lint 0 errors (29 warnings), tsc app and scripts, build, vitest 908/908.

## Surviving mutants

- `src/lib/scanner/index.ts:934`
