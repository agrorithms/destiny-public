# #137 — Track the e2e coverage doc at `docs/e2e-coverage.md`

Branch `fix/137-e2e-doc`. Spec: `gh issue view 137`. Decisions agreed with the user in a grilling
session on 2026-10-08:

- Move `docs/handoffs/260803-playwright-e2e.md` unchanged to `docs/e2e-coverage.md`, with a short
  note above the original header. Rewriting the journal into a real coverage list is a follow-up.
- The old file becomes a local-only stub (`docs/handoffs/` is gitignored) pointing at the new path
  and keeping no content.
- The 12 live references switch to the new path. The 5 progress logs keep the old path as written
  and get one dated note after their opening paragraph.

## Chunks

1. **Move** — WIP commit
   - [x] `docs/e2e-coverage.md` — copied unchanged, note above the header
   - [x] `docs/handoffs/260803-playwright-e2e.md` — replaced by the stub (gitignored, not committed)
2. **References** — WIP commit
   - [x] `CLAUDE.md`
   - [x] `tests/README.md`
   - [x] `.claude/skills/verify/SKILL.md`
   - [x] `.github/workflows/e2e.yml`
   - [x] `docs/decisions.md`
   - [x] `docs/adr/0007-the-archive-is-a-second-read-only-database.md`
   - [x] `src/app/gos10k/HelperBoard.tsx`
   - [x] `src/app/gos10k/MedianSpeedBoard.tsx`
   - [x] `src/lib/http/rate-limit.test.ts`
   - [x] `e2e/client-write-guard.spec.ts`
   - [x] `e2e/gos10k-helper-board.spec.ts`
   - [x] `e2e/gos10k-median-speed.spec.ts`
   - [x] `docs/progress/113-timeline-zoom.md` — note only
   - [x] `docs/progress/114-timeline-tooltip.md` — note only
   - [x] `docs/progress/115-drag-range.md` — note only
   - [x] `docs/progress/132-fastest-clears.md` — note only
   - [x] `docs/progress/gos10k-phase1.md` — note only
3. **Verify**
   - [x] grep: the old path appears only in the five progress logs, the new file's note and this file
   - [x] `npm run lint` — 0 errors, 29 `no-explicit-any` warnings, none in a touched file
   - [x] `npx tsc --noEmit` — clean
   - [x] `npm test` — 45 files, 539 tests passed

   No build or e2e run: only comments and docs changed.
4. **Follow-up issue** — drafted below, filed with `needs-triage` once the user approves
   - [x] filed as #151; number added to the note in `docs/e2e-coverage.md`

## Follow-up issue draft

Filed as #151 on 2026-10-08, with the text below unchanged.

**Title:** Rewrite `docs/e2e-coverage.md` into a coverage list, and point CLAUDE.md at it

**Body:**

> ## Problem
>
> #137 moved the e2e coverage record to the tracked `docs/e2e-coverage.md` unchanged. The file is
> still a ~1,640-line dated journal: the 2026-08-03 handoff plus one entry per ticket. To answer
> "is flow X covered?" a reader has to go through the entries in order, and the opening sections
> describe the state on 2026-08-03 (15 tests, "confirm 15 green", the `playwright-testing` branch
> "not merged").
>
> `CLAUDE.md`'s Verification section repeats the same information as a twenty-flow inline list,
> so every new spec updates two places.
>
> ## Proposal
>
> - Rewrite `docs/e2e-coverage.md` into a current list of covered and uncovered browser flows, one
>   line per flow with its spec file. Keep the journal somewhere: as a local handoff, or as a
>   section at the bottom of the file.
> - Shrink `CLAUDE.md`'s twenty-flow list to a sentence and a pointer to that file.
>
> ## Watch for
>
> - `e2e/client-write-guard.spec.ts` cites "§2" and `.github/workflows/e2e.yml` cites "§3 item 7".
>   Both break if the sections are renumbered.
> - `.claude/skills/verify/SKILL.md` and ADR 0007 describe the coverage list as living in
>   `CLAUDE.md` *and* this file. Update them if `CLAUDE.md` stops holding the list.
>
> ## Context
>
> Deferred from #137 to keep that issue to moving the file and updating its references.
