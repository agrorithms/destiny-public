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
   - [x] `src/lib/db/archive/timeline-buckets.ts` — `monthSlots(months)`
   - [x] `src/lib/db/archive/timeline-buckets.test.ts`
3. Client component + rendering
   - [x] `src/app/gos10k/TimelineDrag.tsx` (new, `'use client'`)
   - [x] `src/app/gos10k/TimelineHover.tsx` — tooltip hidden while a drag is in progress
   - [x] `src/app/gos10k/ArchiveTimeline.tsx` — both surfaces wrapped; stays a server component
   - [x] `src/app/gos10k/page.tsx` — the tab and the span handed to the timeline
4. Browser spec
   - [x] `e2e/gos10k-timeline.spec.ts` — main-chart drag (selection drawn, one navigation, outer
         edges), right-to-left, strip (wider + clamped), Clear Number → dates, tab kept + Helper
         params dropped, sub-threshold press, Escape, touch swipe scrolls
     - Proved able to fail: `touch-none` on the wrapper, a 0px threshold and a removed Escape
       listener each turn their spec red.
     - Touch is driven by raw CDP `Input.dispatchTouchEvent`: `synthesizeScrollGesture` scrolled
       nothing here, not even over a heading.
5. Docs
   - [x] `CLAUDE.md` e2e flow list (nineteen flows)
   - [x] `docs/handoffs/260803-playwright-e2e.md` (gitignored — local only)
6. [x] Verification: lint → build → test → e2e (0 lint errors / 29 old warnings; build ok; 516 unit; 86 e2e)
7. [x] Code review (`/mattpocock-skills:code-review`, base 8de2428). The two in-session sub-agents
       were stopped; the review came from the peer session `115-code-review`, verified against the source.
   - [x] Standards (near-hard): `monthSlots` re-derived `year*12+month` inline — now `monthStart()` in
         `month-keys.ts`, the arithmetic's one home
   - [x] Standards: `archiveRangeHref(…, archiveTabParams(tab))` → `archiveTabHref()`, as the presets and tabs
   - [x] Spec: a lost pointer capture left the drag stuck and following the mouse — now cancelled by
         `onLostPointerCapture`; new spec (the loss is delivered at the next pointer event, measured)
   - [x] Spec: "navigates once" was counted right after `toHaveURL` — now after the new page renders;
         the touch spec proves absence with a follow-up tab tap (and waits for hydration first: Next
         rewrites the loaded page's history entry, which counted as a navigation)
   - [x] Spec: why a pen doesn't drag, documented in `TimelineDrag.tsx`
   - [x] Judgement calls, by the user's decision:
     - [x] The overlay was named `selection`, a word CONTEXT.md reserves against the Shaded Band →
           `dragSpan` / `archive-timeline-drag-span`
     - [x] `ArchiveRunSpan` + `archiveRunSpan()` in `range.ts` for the non-null span
     - [x] `isMouse()` and `chartFraction()` in `timeline-geometry.ts`, shared by both client components
     - [x] Crosshair only once the script runs, and only for a fine pointer
     - [x] A drag landing on the URL already showing doesn't navigate; new spec
   - [x] Mutation-checked: no lost-capture handler, and no same-URL check, each turn their spec red
   - Left: the `Draggable` null branch (user kept it); the tooltip can reappear at the press-start
     bucket after a navigation until the mouse moves (cosmetic); the test file's `86_400` literal
     (that file's existing style, and independent of the module)
8. [x] Handoff — `docs/handoffs/260924-issue-115-implemented.md` (gitignored, local)
