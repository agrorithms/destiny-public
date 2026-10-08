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
   - [ ] `CLAUDE.md`
   - [ ] `tests/README.md`
   - [ ] `.claude/skills/verify/SKILL.md`
   - [ ] `.github/workflows/e2e.yml`
   - [ ] `docs/decisions.md`
   - [ ] `docs/adr/0007-the-archive-is-a-second-read-only-database.md`
   - [ ] `src/app/gos10k/HelperBoard.tsx`
   - [ ] `src/app/gos10k/MedianSpeedBoard.tsx`
   - [ ] `src/lib/http/rate-limit.test.ts`
   - [ ] `e2e/client-write-guard.spec.ts`
   - [ ] `e2e/gos10k-helper-board.spec.ts`
   - [ ] `e2e/gos10k-median-speed.spec.ts`
   - [ ] `docs/progress/113-timeline-zoom.md` — note only
   - [ ] `docs/progress/114-timeline-tooltip.md` — note only
   - [ ] `docs/progress/115-drag-range.md` — note only
   - [ ] `docs/progress/132-fastest-clears.md` — note only
   - [ ] `docs/progress/gos10k-phase1.md` — note only
3. **Verify**
   - [ ] grep: the old path appears only in the stub, the five progress logs and the new file's note
   - [ ] `npm run lint`
   - [ ] `npx tsc --noEmit`
   - [ ] `npm test`
4. **Follow-up issue** — drafted below, filed with `needs-triage` once the user approves
   - [ ] filed; number added to the note in `docs/e2e-coverage.md`

## Follow-up issue draft

_Filled in at chunk 4._
