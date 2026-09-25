# #114 — GoS 10k timeline hover tooltips

Branch `10karchive/114-timeline-tooltip`, based on #113's tip (593355c). Spec: `gh issue view 114`.
Briefing from the peer session `orchestrate-ui-refinement`.

Seams agreed with the user before any test:
1. the pure tooltip-copy module (months or zoomed buckets → one `{ line, bar }` per bucket),
   plus one `tests/db` check running the real February 2022 zoom through it;
2. the pure pointer geometry (slot under a pointer fraction; the clamped tooltip left edge);
3. the browser spec (line hover, bar hover, touch tap + dismiss, 360px edges, JS disabled).

Decisions confirmed with the user:
- The line picks the **slot under the pointer**, the same bucket as the bar beneath it — not the
  geometrically nearest vertex, which sits at the slot's right edge.
- Edge copy: empty bar `Mar 2021 · no clears`; one clear `Mar 2021 · 1 clear · #4,121`; a line
  with nothing cleared yet `No clears yet · 4 Jul 2020`; a zoomed empty bucket before the range's
  first clear shows the absolute position (`Clear 102 · 1 Feb 2022`).
- Main chart only; the overview strip stays pointer-inert.

## Chunks

1. Tooltip copy
   - [x] `src/app/gos10k/range-copy.ts` — a bucket name without "the"
   - [x] `src/app/gos10k/timeline-tooltips.ts` (new, pure)
   - [x] `src/app/gos10k/timeline-tooltips.test.ts`
   - [x] `tests/db/archive-timeline.test.ts` — the February 2022 zoom through it
2. Pointer geometry
   - [ ] `src/app/gos10k/timeline-geometry.ts` — slot under a pointer, clamped tooltip left
   - [ ] `src/app/gos10k/timeline-geometry.test.ts`
3. Client wrapper + rendering
   - [ ] `src/app/gos10k/TimelineTooltip.tsx` (new, `'use client'`)
   - [ ] `src/app/gos10k/ArchiveTimeline.tsx` — stays a server component
4. Browser spec
   - [ ] `e2e/gos10k-timeline.spec.ts`
5. Docs
   - [ ] `CLAUDE.md` e2e flow list
   - [ ] `docs/handoffs/260803-playwright-e2e.md` (gitignored — local only)
   - [ ] `CONTEXT.md` if a new term appears
6. [ ] Verification: lint → build → test → e2e
7. [ ] Code review (`/mattpocock-skills:code-review`, base 593355c)
8. [ ] Handoff — `docs/handoffs/260924-issue-114-implemented.md` (gitignored, local)
