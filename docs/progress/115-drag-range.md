# #115 — GoS 10k timeline: drag across it to set the range

Branch `10karchive/115-drag-range`, based on #114's tip (8de2428). Spec: `gh issue view 115`.
Briefing from the peer session `orchestrate-ui-refinement`.

Seams agreed with the user before any test:
1. the pure drag geometry in `timeline-geometry.ts` — the ordered pair of slots a drag touches,
   the clamped `from`/`to` dates they snap out to, and the movement threshold;
2. the month slots the server hands down for the two monthly surfaces (the unfiltered chart and
   the overview strip), whose keys carry no `start`/`end`;
3. the browser spec — one test per acceptance criterion, plus the existing phone and no-JS specs.

Decisions confirmed with the user:
- The threshold is **sideways distance, 4px**: only horizontal movement selects buckets, so only
  horizontal movement counts. A vertical wobble inside one bar is still a click, and does nothing.
- Drag lives in its own client component (`TimelineDrag.tsx`), not a flag on `TimelineHover`:
  the strip gets drag alone, the main chart gets drag wrapped around hover.

Briefing corrections found while reading:
- The zoomed chart's *axis* is clamped to the Archive's ends, but its first week or month slot
  still starts on the Monday or the 1st, which can be before the first Run. So the clamp applies
  on every surface, not only the strip.
- The unfiltered main chart is monthly keys too, so it needs server-computed slots as the strip does.

## Chunks

1. Drag geometry
   - [x] `src/app/gos10k/timeline-geometry.ts` — `DRAG_THRESHOLD_PX`, `isDrag`, `dragSlots`, `dragDates`
   - [x] `src/app/gos10k/timeline-geometry.test.ts`
2. Month slots
   - [ ] `src/lib/db/archive/timeline-buckets.ts` — `monthSlots(months)`
   - [ ] `src/lib/db/archive/timeline-buckets.test.ts`
3. Client component + rendering
   - [ ] `src/app/gos10k/TimelineDrag.tsx` (new, `'use client'`)
   - [ ] `src/app/gos10k/TimelineHover.tsx` — tooltip hidden while a drag is in progress
   - [ ] `src/app/gos10k/ArchiveTimeline.tsx` — both surfaces wrapped; stays a server component
   - [ ] `src/app/gos10k/page.tsx` — the tab and the span handed to the timeline
4. Browser spec
   - [ ] `e2e/gos10k-timeline.spec.ts`
5. Docs
   - [ ] `CLAUDE.md` e2e flow list
   - [ ] `docs/handoffs/260803-playwright-e2e.md` (gitignored — local only)
6. [ ] Verification: lint → build → test → e2e
7. [ ] Code review (`/mattpocock-skills:code-review`, base 8de2428)
8. [ ] Handoff — `docs/handoffs/260924-issue-115-implemented.md` (gitignored, local)
