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
- [ ] **#96** Playwright harness for the Archive — must land before #88 and #90.
- [ ] **#86** Page shell
- [ ] **#95** Cache lifetime + share-card fallback
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

## Files

Per ticket, so a reviewer can see which diff belongs to which chunk.

### #84 — Clear Number (this chunk)

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

## Notes and traps carried forward

- **`is_full_clear = 1` alone is 10,040, not 10,000.** Four full-clear predicates now exist
  across the two databases; the Archive's two each carry "and the subject finished it".
- **No `Date.now()` / `new Date()` in `src/lib/db/archive/` or `src/app/gos10k/`.** There is
  none today. #87's milestone presets must anchor to the Archive's own span, not to now.
- **#95's shortened cache `max-age` is restored to a long value after Wave 3.** Nothing else
  will remind you.
- **The serving copy and the master are copied to the box by hand** (`docs/decisions.md`).
  After #84, a stale copy is now a wrong-analytics risk, not just a stale-counts one — but
  the new invariant assertions make that failure loud.
