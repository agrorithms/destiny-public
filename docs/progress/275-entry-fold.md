# #275 — fold a player's PGCR Entries into one Player-Run row

Branch `feat/275-entry-fold` from `main` @ 5278070. Rules: the ticket and ADR 0006's
2026-11-23 amendment. Seams approved 2026-11-23: a pure module colocated with its test, a
`swapEntries` builder, and database tests through `insertFullPGCR`.

## Chunk 1 — docs: `WIP #275: ADR 0006 amendment heading names #275`

- [x] `docs/adr/0006-population-kda-quartiles-and-dual-scope.md` — amendment heading names #275
- [x] `CONTEXT.md` — Player-Run parenthetical: old rows aren't repaired, they age out
- [x] `docs/progress/275-entry-fold.md` — this file

## Chunk 2 — red: `WIP #275: red — Entry fold rules, finishing Entry second`

- [x] `src/lib/db/entry-fold.ts` — typed stub that throws
- [x] `src/lib/db/entry-fold.test.ts` — one test per fold rule, including a tie on time played
- [x] `tests/helpers/pgcr-builder.ts` — `swapEntries`
- [x] `tests/db/entry-fold.test.ts` — swapped fixture, builder Full Clear, ended_at guard
- [x] `tests/real-pgcrs.test.ts` — Garden test asserts the fold; comments reworded

## Chunk 3 — green: `WIP #275: fold a player's Entries inside insertFullPGCR`

- [x] `src/lib/db/entry-fold.ts` — the fold
- [x] `src/lib/db/queries.ts` — `insertFullPGCR` inserts folded rows; duration still reads Entries

## Chunk 4 — `/simplify` pass

- [x] /simplify pass — 4 cleanup agents over `5278070..HEAD`; no fixes applied. Suite at
  `a15075d`: lint pass (29 warnings, all `gos10k/`), tsc app + scripts pass, build pass, vitest 1237/1237

## Red run

At `ba3a5ad`, before `insertFullPGCR` called the fold, 15 of the 34 tests in the three files failed:

- The 12 pure-function tests failed on the stub (`not implemented`).
- The 3 database tests failed on their assertions, under the old first-Entry-wins insert:
  - swapped checkpoint fixture: `expected +0 to be 1`, so Vick XCII was stored as not finishing;
  - builder Full Clear: `expected [] to match object`, so the finisher had no Completion;
  - Garden fixture: the first character's stats, not the fold.
- The ended_at guard passed, as intended. It is a guard against folding before the duration is
  measured, not a red-first test.

All 34 pass at `19ee852`.

## Bite proof

`npm run mutate:diff -- 5278070...HEAD --typecheck` at `19ee852`, first loop:

- 22 mutants: 13 killed, 0 survived, 0 no coverage, 9 compile errors (discarded).
- 100.0% overall, 100.0% covered. PASS against 62.5%.
- All mutants were in `src/lib/db/entry-fold.ts`. The one-line change in `queries.ts` produced none.

## Surviving mutants

None.

## Suite at `19ee852`

- lint: pass (0 errors; 29 warnings, all in `gos10k/`, untouched)
- tsc for the app and for `scripts/`: pass
- `npm run build`: pass
- `npm test`: 1237/1237
