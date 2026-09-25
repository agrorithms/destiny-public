# #113 — GoS 10k timeline zoom + whole-Archive overview strip

Branch `10karchive/113-timeline-zoom`, based on `10karchive/ui-navheight-h1` (7827f00 + the
verify-skill merge f3cf7cd). Spec: `gh issue view 113`. Seams agreed with the user before any test:
the pure bucket module, the range-scoped Archive read, the zoomed axis ticks, the browser spec.

## Chunks

1. Pure bucket module
   - [x] `src/lib/db/archive/timeline-buckets.ts`
   - [x] `src/lib/db/archive/timeline-buckets.test.ts`
2. Range-scoped Archive read
   - [x] `src/lib/db/archive/queries.ts` — `getRangeTimeline()` beside the unchanged `getMonthlyClears()`
   - [x] `tests/db/archive-timeline.test.ts`
3. Zoomed axis ticks + rendering
   - [x] `src/app/gos10k/timeline-geometry.ts`
   - [x] `src/app/gos10k/timeline-geometry.test.ts`
   - [x] `src/app/gos10k/ArchiveTimeline.tsx`
   - [x] `src/app/gos10k/page.tsx`
   - [x] `src/app/gos10k/range-copy.ts` — day-of-month and bucket names
4. Browser spec
   - [x] `e2e/gos10k-timeline.spec.ts` (rewritten, onto `boxOf()`)
5. Old-rule wording + docs
   - [x] `src/lib/db/archive/queries.ts` comment on `getMonthlyClears()` (landed with chunk 2)
   - [x] `docs/progress/gos10k-phase1.md` (:560, :1279)
   - [x] `CLAUDE.md` e2e flow list, `docs/handoffs/260803-playwright-e2e.md` (the handoff is gitignored — local only)
   - [ ] Draft #81/#88 wording — **ask the user before `gh issue edit`**
6. Verification: lint → build → test → e2e
7. Code review (`/mattpocock-skills:code-review`), handoff
