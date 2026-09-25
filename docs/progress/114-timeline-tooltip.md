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
   - [x] `src/app/gos10k/timeline-geometry.ts` — slot under a pointer, clamped tooltip left
   - [x] `src/app/gos10k/timeline-geometry.test.ts`
3. Client wrapper + rendering
   - [x] `src/app/gos10k/TimelineHover.tsx` (new, `'use client'`)
   - [x] `src/app/gos10k/ArchiveTimeline.tsx` — stays a server component
4. Browser spec
   - [x] `e2e/gos10k-timeline.spec.ts` — line hover, bar hover (same bucket as the line), strip inert, 360px edges, touch tap + dismiss, JS disabled
5. Docs
   - [x] `CLAUDE.md` e2e flow list (eighteen flows)
   - [x] `docs/handoffs/260803-playwright-e2e.md` (gitignored — local only)
   - [x] `CONTEXT.md` — no new term: the tooltips speak in Clear Number and Month Bucket
6. [x] Verification: lint → build → test → e2e (0 lint errors / 29 old warnings; build ok; 499 unit; 77 e2e)
7. [x] Code review (`/mattpocock-skills:code-review`, base 593355c) — Standards + Spec in parallel
   - [x] Spec c1: a tapped tooltip outlived a change of chart width with a stale `left` — now
         closed by a width-only ResizeObserver; layout effect also re-runs on the strings
   - [x] Spec c2: a pen tap was treated as a mouse — everything but a mouse now taps
   - [x] Spec c3: a tap in the 4px gap neither showed nor dismissed — now dismisses. A finger
         can't reach it (Chromium's touch adjustment retargets onto the nearer SVG, measured),
         so it's a pen fix; the browser spec written for it was dropped as untestable
   - [x] Standards: header path `./queries.ts` → `@/lib/db/archive/queries`
   - [x] Standards smell 4: `slotCentre()` beside `slotAt()`, out of the component
   - [ ] Left as judgement calls: three Clear Number spellings, `formatTimelineBucket` vs
         `…Label` naming, `hoverable`/`compact` always opposite, the `data-timeline-part` string
   - [x] Re-verified: lint 0 errors / 29 old warnings, build ok, 500 unit, 78 e2e
8. [x] Handoff — `docs/handoffs/260924-issue-114-implemented.md` (gitignored, local)
