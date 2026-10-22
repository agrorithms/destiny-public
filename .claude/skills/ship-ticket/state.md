# The state file

`docs/handoffs/NNN-state.json`. The orchestrator is its only writer and rewrites the whole file each
time. It records what git can't say about a ticket: which pass is running, which commits belong to
which pass, the checks and the SHA they ran at, the findings, the pending question.

It is gitignored, as is all of `docs/handoffs/`. Committing it would change the SHAs it records.

## Example

```json
{
  "schema": 1,
  "ticket": 166,
  "title": "Active sessions: unit tests for dedupeActiveSessions",
  "branch": "feat/166-dedupe-tests",
  "base": { "ref": "main", "sha": "61954b0f…" },
  "progress_file": "docs/progress/166-dedupe-tests.md",
  "ui": false,
  "models": { "implementer": "sonnet", "reviewer": "inherit", "fixer": "inherit" },

  "pass": "review",
  "pass_status": "awaiting_decision",
  "head": "9c1e2d3a…",

  "passes": {
    "implement": { "status": "committed", "model": "sonnet", "agent_id": "a7f3…", "commits": ["3b4c…", "5d6e…"], "mutation_loops": 2 },
    "simplify":  { "status": "committed", "model": "session", "commits": ["7f80…"] },
    "review":    { "status": "awaiting_decision", "loop": 1, "range": "61954b0f…..7f80…" },
    "fix":       { "status": "pending", "loop": 0, "commits": [] },
    "handoff":   { "status": "pending", "doc": null, "issues": [], "pr": null }
  },

  "checks": {
    "sha": "7f80…",
    "lint": "pass", "tsc": "pass", "build": "pass",
    "vitest": "575/575", "e2e": "n/a", "visual": "n/a"
  },
  "mutation": {
    "sha": "7f80…", "range": "61954b0f…...HEAD", "full": false,
    "overall": 75.0, "covered": 85.7, "killed": 6, "scored": 8,
    "verdict": "PASS", "survivors": []
  },

  "findings": [
    { "id": "S1", "axis": "standards", "severity": "blocking", "where": "src/lib/active-session/dedupe.test.ts:40",
      "summary": "the tie-break test can't fail: both rows share startedAt", "status": "open", "note": null }
  ],
  "out_of_scope": [
    { "summary": "dedupe.ts still imports the db module for a type", "source": "simplify", "issue": null }
  ],

  "decision": {
    "question": "Which review findings to fix",
    "options": ["(a) S1, P1 (pre-ticked)", "(b) S1, P1, S2"],
    "recommendation": "(a)"
  },
  "updated_at": "2026-10-22T14:03:00Z"
}
```

## Field rules

- **SHAs are full 40-character hashes**, written from `git rev-parse`, never typed by hand.
  `report.sh` and the Stop hook check each one: `base.sha`, `head`, and every `passes.*.commits`.
- `head` is `git rev-parse HEAD` at the moment of writing.
- **Statuses**, for `pass_status` and each `passes.*.status`: `pending`, `in_progress`,
  `awaiting_decision`, `committed`, `skipped`. `pass_status` always equals `passes[pass].status`.
  `committed` claims a clean tree; the Stop hook holds you to it.
- **`checks` describes one run at one SHA.** Overwrite all of it after each full run. A field not run
  is `"not run"`; one that doesn't apply (e2e and visual on a non-UI ticket) is `"n/a"`.
- **`mutation.full`** is `true` only for the Handoff run with `--typecheck`, the one that gets
  reported. `verdict` is `PASS`, `FAIL` or `not applied` (fewer than 8 scored). `survivors` is
  `file:line` strings.
- **Finding ids**: `P<n>` for the Spec axis, `S<n>` for Standards, `O<n>` for your own diff reads.
  Numbering continues across review loops, so an id is never reused. `status`: `open`, `picked`,
  `fixed`, `declined` (with the user's reason in `note`), `issue #NNN`.
- `out_of_scope.source`: `implement`, `simplify`, `review` or `orchestrator`. `issue` is the number
  once one is opened or commented on.
- `decision` is `null` unless `pass_status` is `awaiting_decision`.
- `models` values are role defaults; `passes.*.model` is what actually ran. Simplify's is always
  `"session"`.
