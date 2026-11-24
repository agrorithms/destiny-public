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

- [ ] `src/lib/db/entry-fold.ts` — the fold
- [ ] `src/lib/db/queries.ts` — `insertFullPGCR` inserts folded rows; duration still reads Entries

## Red run

## Bite proof

## Surviving mutants
