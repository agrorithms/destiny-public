# Verification automation — mutation testing and the viewport matrix

Replaces the hand-made "bite proofs" (break the code by hand, show a test fails) with
Stryker for the Vitest side, and adds a 360/768/1280 × light/dark screenshot matrix with an
overflow gate for the browser side. Branch `fix/update-verification-automation`.

## Decisions (grilling, 2026-10-21)

- Both scripts take an optional git range; default `main...HEAD`. Verified against a past
  merged ticket that touched logic and UI.
- `mutate:diff` mutates changed `.ts` under `src/` only — not `*.test.ts`, not `.tsx`, not
  `src/hooks/`. Vitest runs in `node` with no DOM, so those would score 0% "no coverage" and
  drag the number you pick a threshold from. They are listed as "not mutation-tested".
- Changed lines (diff hunks) by default; `--files` for whole files.
- `@stryker-mutator/typescript-checker` on, so mutants that would not compile are discarded
  rather than counted. Its share of runtime is reported. *(Superseded by decisions 1–2
  below: a narrower checker tsconfig, the 90s rule, and `ignoreStatic`.)*
- Overflow gate: on page load at every size × theme, plus a helper (`expectNoOverflow`) that
  specs call after interactions. Not an automatic end-of-spec fixture.
- Overflow rule: every visible element inside the viewport horizontally (unless inside a
  sideways-scrolling container, which is checked itself) and inside its nearest clipping
  ancestor on both axes. Exempt: `text-overflow: ellipsis` clipping, visually-hidden text,
  SVG internals, zero-size elements, and a named exemption list in the test with reasons.
  Absolutely positioned popups are *not* exempt — the #160 copy bubble was one.
- `visual:check` (named `visual:diff` until decision 6) maps the diff to routes through each `page.tsx`'s import graph; layout,
  `globals.css` → all routes; `--all` forces every route. `/admin/stats` skipped.
- Playwright bite proofs: dropped where the spec was written red-first; otherwise one break
  per new spec, batched into one build.
- Equivalent-mutant justifications: this kind of progress file, `## Surviving mutants`.
- Local only, no CI, no threshold yet.

## Decisions (grilling rounds 2–3, 2026-10-22)

Mutation testing (`mutate:diff`):

1. **Checker tsconfig.** `tsconfig.stryker.json` covers `src/` and `tests/` only; the project
   `tsconfig.json` includes every `**/*.ts`, so `scripts/`, `e2e/` and `gos10k/` were
   type-checked too. Re-run #172: **≤ 90s wall → the checker stays always on; > 90s → off by
   default** behind a `--typecheck` flag, which the final reported score must use.
2. **`ignoreStatic: true`.** The report still states how many static mutants were skipped.
3. **`--incremental`** stays opt-in for kill loops; the reported score always comes from a full run.
4. **The threshold uses the overall score** (no-coverage mutants count against it). The
   covered-code score is reported next to it. CLAUDE.md and `tests/README.md` say which is which.
5. Past-range runs keep the temp worktree at the range's head with that commit's tests.

Viewport matrix:

6. **Renamed `visual:diff` → `visual:check`**: the npm script, `scripts/visual-check.ts`, the
   output folder `visual-check/` (still wiped each run, still git-ignored).
7. Sizes 360×780 / 768×1024 / 1280×800, Desktop Chrome UA, full-page screenshots: unchanged.
8. The overflow rules in `e2e/support/viewport.ts` are a **starting point**, tuned against the
   first run's results. Not settled.
9. **Page selection:** keep the root layout as import-only, **unless** the first `--all` run
   takes **≤ 3 minutes after the build**: then drop selection, always screenshot every page,
   and delete the import-graph code.
10. **First-run failures** go to the user with screenshot and a guess (real bug or rule too
    strict). Each becomes a rule fix, an `OVERFLOW_EXEMPT` entry with a reason, or a real bug,
    and the user rules on each. Nothing on the viewport side is committed before that.

Docs and landing:

11. CLAUDE.md's "Bite proofs are automated." block stays as written, plus the rename, *"The
    score reported at the end comes from a full run, not an incremental one."* on the
    three-loops bullet, and the overall score named as the threshold number. The three
    extensions (Playwright red-first, UI tickets pass the gate, interaction specs call
    `expectNoOverflow`) are approved.
12. Two follow-up issues for `agrorithms/destiny-public`, drafted and shown before opening: wide
    names seeded into the e2e world; the #172 baseline's gaps (`roster.ts` survivors, `dedupe.ts`
    no coverage).
13. Before/after screenshots (also screenshot `main`, show the pair): this line only, no issue.
14. WIP commits on this branch; no push and no PR until the user has reviewed the diffs.

## Files

- [x] `package.json` / `package-lock.json` — Stryker deps, `mutate:diff`, `visual:check`
- [x] `stryker.config.mjs`
- [x] `stryker.config.mjs` — `tsconfigFile: tsconfig.stryker.json`, `ignoreStatic` (1, 2)
- [x] `tsconfig.stryker.json` — checker-only, `src/` + `tests/` (1)
- [x] `scripts/mutate-diff.ts` — static-skipped count, overall vs covered wording, checker
      tsconfig copied into past-range worktrees, 90s rule applied (1, 2, 4)
- [x] `scripts/lib/git-range.ts` — shared range parsing for both scripts
- [x] `scripts/mutate-diff.ts`
- [x] `scripts/visual-check.ts`
- [x] rename `visual:diff` → `visual:check` across script, folder, config and docs (6)
- [ ] `scripts/visual-check.ts` — 3-minute rule applied (9)
- [x] `playwright.config.ts` — six viewport projects, only when `visual:check` asks
- [x] `e2e/support/viewport.ts` — `expectNoOverflow`
- [x] `e2e/visual.spec.ts`
- [x] `.gitignore`
- [x] `CLAUDE.md` — commands + mutation-killing rules
- [x] `tests/README.md` — how to read and act on a mutation report
- [x] `docs/e2e-coverage.md` — the visual matrix entry
- [x] `CLAUDE.md` / `tests/README.md` — full-run score, overall vs covered (4, 11)
- [ ] `docs/agents/domain.md` — the user's own ADR-list fix; rides in the docs commit
- [ ] first `visual:check -- --all` run; overflow rulings applied (8, 10)
- [ ] `npm run e2e` unchanged by the `chromium` project's `testIgnore`

## Found while building

- Route selection: the root layout's StatsBar fetches `/api/live-stats`, which imports the
  fireteam dedupe and most of `queries.ts`. Following API edges from the layout made every
  `src/lib` change pick all eight pages. The layout counts by import only, and is not one of
  a page's own roots; pages still follow their own API edges. `queries.ts` is still a hub:
  #142's change to it picks `/active-sessions`, `/gos10k` and the player page as well as
  `/leaderboard`. Over-selection, the safe direction.
- A past range's changed lines only line up with that commit's files, so `mutate:diff` runs
  a past range in a temporary worktree (OS temp dir, `node_modules` symlinked) at its head,
  with that commit's tests. `visual:check` always renders the checked-out code.

## Baseline

**Mutation, #172** (`fefda5f...e12eb45` = `f83d344^1...f83d344^2`, changed lines, 2026-10-22,
`ignoreStatic` on, `tsconfig.stryker.json`):

| Run | Mutants | Overall | Covered code | Wall |
|---|---|---|---|---|
| `--typecheck` (the reported score) | 128: 62 killed, 1 timeout, 22 survived, 9 no coverage, 31 compile error, 3 static skipped | **67.0%** | 74.1% | 126–139s |
| default (no checker) | 128: 88 killed, 1 timeout, 24 survived, 12 no coverage, 3 static skipped | 71.2% | 78.8% | 13s |

The narrowed tsconfig took the checked run from 232s (261021 handoff, whole-project tsconfig)
to ~130s: over the 90s line, so decision 1 lands on `--typecheck` opt-in. Undetected:
`roster.ts` 57, 62, 108, 153, 158–167 (survived) and `dedupe.ts:41–43` (no coverage).
`reports/mutation/` holds this run. The `#179 --files` cost comparison was not finished.

**Viewport matrix:** (after the first `visual:check -- --all`)
