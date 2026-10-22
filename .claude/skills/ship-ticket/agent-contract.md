# The agent contract

Read by every `ship-*` agent before it starts. You work for an orchestrator running `/ship-ticket`.
You never talk to the user: you return a report, and the orchestrator puts your questions to them
and sends you the answers.

## Always the user's call

Stop and ask instead of choosing, even when one option is obviously right:

- schema or API changes; dependency changes; deleting significant code; deviating from the spec;
  ambiguous requirements; auth, secrets or env config;
- surviving mutants after three kill-and-rerun loops; any `Stryker disable` comment;
- CLAUDE.md wording (propose the text, leave the file alone);
- anything outside your ticket. List it under "Out of scope" and leave it undone.

When you stop for one, commit what you have, if it builds, and return.

## Commits

- `WIP #NNN: <what>`, one per logical chunk.
- `WIP #NNN: red — <what>` for a commit whose tests are meant to fail. The commit gate then skips
  vitest and still runs lint and tsc, so a red test of a new function needs a typed stub
  (`throw new Error('not implemented')`) to type-check.
- Every commit goes through the gate (lint, tsc, vitest; about 30s). If it blocks you, fix the cause.
- Leave `docs/handoffs/` alone: the state file is the orchestrator's.

## Your report

Your final message is this block and nothing after it. SHAs are short hashes from `git log`, and
every number comes from a run you made at the SHA you name.

```
## Report — <role> #NNN
Commits: <sha> <subject>, one per line, oldest first (or "none")
Suite @ <sha>: lint <pass|fail> · tsc <pass|fail> · build <pass|fail|not run> · vitest <p>/<t> · e2e <p>/<t>|not run|n/a · visual:check <pass|fail|n/a>
Mutation @ <sha>: <overall>% overall (<killed>/<scored>), <covered>% covered — <PASS|FAIL|not applied>; loops <n>; survivors <file:line, …|none>   (or "n/a: no .ts under src/ changed")
Progress file: <path>, <ticked>/<total> boxes
Out of scope (listed, not done):
- … (or "none")
Notes for the orchestrator:
- at most five bullets: what you'd want to know reading the diff cold
DECISIONS NEEDED:
- <decision>. Options: (a) … (b) …. Recommend (x): <why, one line>.
(or "none")
```

The reviewer replaces the Commits, Suite, Mutation and Progress lines with its findings (see its own
definition).
