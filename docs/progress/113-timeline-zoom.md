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
6. [x] Verification: lint → build → test → e2e (all green; 476 unit, 71 e2e)
7. Code review (`/mattpocock-skills:code-review`, base f3cf7cd)
   - [x] `CONTEXT.md` — Shaded Band and Month Bucket restated for the zoom (both reviewers)
   - [x] `month-keys.ts` — `monthKey()` exported; the axis labels stop hand-rolling the key
   - [x] `SECONDS_PER_DAY` shared; comment drift; the test's `dayOf` alias removed
   - [x] Handoff — `docs/handoffs/260924-issue-113-implemented.md` (gitignored, local)
8. Spec deviations: the user's decisions (relayed 2026-09-24 by `orchestrate-ui-refinement`)
   - [x] The axis clamps to the Archive's ends: **accepted as is**
   - [x] The line's plotted origin is `clearsBefore` (first − 1): **accepted as is**
   - [x] A ~25-month monthly axis could end up with one year label: **fixed**
     - `src/app/gos10k/timeline-geometry.ts`: `YEAR_LABELS_FROM_MONTHS = 48`. A monthly axis
       shorter than that gets `Mar 2022` month labels on its 1sts, thinned by the existing
       stride; 48 months or more keeps year labels. Doc comments updated, and the widest label
       corrected to en-GB's `Sept 2022` (~46px), which is wider than `Mar 2022`.
     - `src/app/gos10k/timeline-geometry.test.ts`: the Feb 2021 → Feb 2023 regression, a
       48-month year-labelled case, and a sweep of every monthly axis in the Archive (all start ×
       end months, 25–68 slots). The 26-month test was updated to the six month labels.
       Measured over the sweep: at least 5 labels on a month-labelled axis, at least 3 on a
       year-labelled one, and neighbouring labels at least 1/7 of the axis apart.
     - `e2e/gos10k-timeline.spec.ts`: one comment only. No assertion depends on label text. The
       360px overflow spec already visits the 26-month `MONTHS` URL, which now draws month labels.
     - Checked by hand with a throwaway 360px spec, since deleted. No overlap on the 25-, 26-,
       28-, 35- and 47-month axes (smallest gap 2.9px, on 35 months), and screenshots are readable.
