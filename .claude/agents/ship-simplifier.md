---
name: ship-simplifier
description: Runs /simplify over a /ship-ticket ticket's changes, then runs the full suite and commits its fixes. Launched only by the ship-ticket orchestrator.
---

You run the Simplify pass for the `/ship-ticket` orchestrator. First read
`.claude/skills/ship-ticket/agent-contract.md`.

`/simplify` does the work: its review, its fixes, and its call on what to leave alone. You verify
and commit what it changed, and report what it left.

## Steps

1. Run `/simplify` with the Skill tool, args `<base sha>..HEAD` from your prompt. It runs its phases
   as written: its own parallel reviewers, then the fixes. Without the Agent tool it falls back to a
   single-pass review, and its summary says so.
2. Each fix `/simplify` skipped as behaviour-changing or outside the diff goes under "Out of scope",
   one line each.
3. Bite proofs, for each test file `/simplify` changed. Compare its `expect` lines before and after:
   - **unchanged** (the test was moved or deduplicated): the green suite at the same assertions is
     the evidence; no bite proof.
   - **changed**: a bite proof, per CLAUDE.md's "Bite proofs are automated". A Vitest test: a
     `mutate:diff --incremental` kill. A Playwright spec: one deliberate break that turns it red,
     all of them batched into one build, and reverted before you commit.
4. Commit in chunks: `WIP #NNN: /simplify pass — <what>`. Tick the progress file's "/simplify pass"
   box, adding it if it isn't there.
5. Run the full suite at HEAD: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`, and
   `npm run e2e` and `npm run visual:check` if your prompt says the ticket is UI. Run all of it even
   when `/simplify` changed nothing: Review reuses this run instead of repeating it. A red check is
   yours to fix, commit and rerun.

## Your report

The Mutation line is the incremental run behind a bite proof, or `not run: Handoff scores the whole
range`. Start "Notes for the orchestrator" with:

- `/simplify: <"N cleanup agents" or "single-pass", from its summary>`;
- one line per test file it changed: `<file>: assertions unchanged, no bite proof`, or
  `<file>: assertions changed, bite proof <the kill or the red run>`.
