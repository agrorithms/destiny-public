---
name: ship-ticket
description: Deliver one ready-for-agent issue through implement → simplify → review → fix → handoff, checkpointed so it resumes after a usage limit or /clear.
disable-model-invocation: true
argument-hint: "#NNN [implementer=<model>] [simplifier=<model>] [reviewer=<model>] [fixer=<model>]"
---

# Ship a ticket

You are the **orchestrator**. You carry one ticket through five **passes** and end your turn at every
**decision stop**. Agents write the code; you write the state file and read every diff.

Invoking this skill is the user's "go ahead" for this ticket. It is not a go-ahead for anything a
decision stop covers.

## Vocabulary

- **Ticket**: an open issue on `agrorithms/destiny-public` labelled `ready-for-agent`, with a section
  headed "Acceptance criteria" or "Done when".
- **Pass**: `implement`, `simplify`, `review`, `fix`, `handoff`, in that order. Review and fix loop.
- **Decision stop**: you put a question to the user, set `pass_status` to `awaiting_decision`, write
  state, and end your turn. Nothing proceeds until the user answers. Start's stop is the one that
  writes no state; see _Start_.
- **State file**: `docs/handoffs/NNN-state.json`. Gitignored with the rest of `docs/handoffs/`. You
  are its only writer. Schema and field rules: [state.md](state.md) — read it before your first write
  in a session.
- **Report**: what `.claude/skills/ship-ticket/report.sh NNN` prints, followed by your
  `DECISIONS NEEDED` and `Next` lines. See _Reporting_.
- **Agent contract**: [agent-contract.md](agent-contract.md), which every agent reads first: the
  always-the-user's-call list, the commit-message forms and the report format they return.

## Arguments

`$ARGUMENTS` is `#NNN`, then any `role=model` pairs. Roles: `implementer`, `simplifier`, `reviewer`,
`fixer`. Models: `sonnet`, `opus`, `haiku`, `fable`, `inherit`. A role or model outside those lists:
stop and list the valid values. Every role defaults to `inherit`, the session's model.

Any other text after `#NNN` is a note from the user to you. Act on it where it bears on a step; it is
no reason to stop.

## 0. Entry

1. `gh issue view NNN --json number,title,body,labels,state`. If it is closed, lacks the label, or
   lacks the section, stop: "#NNN isn't ready: <what's missing>. Grill it first." Do no design work.
2. If `docs/handoffs/NNN-state.json` exists, go to **Resume**. Otherwise **Start**.

### Start

Start writes no state until the user's yes, the one exception to the decision-stop rule: nothing has
happened yet that a `/clear` could lose, and Entry would propose the same again.

1. Read the ticket's "Blocked by" and "Parent". Propose a branch and a base: the blocking ticket's
   branch if it is unmerged, else `main`. The branch is the ticket's existing `feat/NNN-*` branch if
   `git branch --list 'feat/NNN-*'` finds one, else a new `feat/NNN-<slug>`. Name the progress file:
   the parent spec's existing `docs/progress/<spec>-*.md` (a new `## #NNN` section), else
   `docs/progress/NNN-<slug>.md`.
2. **Decision stop**: branch, base, progress file, models, and whether the ticket is UI (it touches
   `.tsx` or `e2e/`; your guess from the ticket, for the user to correct). For an existing branch,
   list `git log --oneline <base>..<branch>`: those commits ship in the PR, so review loop 1 covers
   them.
3. On the user's yes: `git switch -c <branch> <base>` for a new branch, `git switch <branch>` for an
   existing one. Then write the first state, `pre_run` included.

### Resume

1. Run `report.sh NNN`. It checks every recorded SHA against git and prints git's view.
2. If it prints `DISCREPANCY`, stop and show its output unedited. Ask the user what happened. Never
   repair the state file from memory.
3. Apply any `role=model` arguments over `state.models`, record the override, and say so in your
   first line.
4. Then by `pass_status`:
   - `awaiting_decision`: put `state.decision` to the user again, word for word.
   - `in_progress` with a dirty tree: **decision stop**. (a) A fresh agent continues from the tree
     and the progress file — recommended. (b) `git stash` and restart the pass. (c) The user
     inspects first. The recorded `agent_id` is a hint only: an agent from a dead session can't be
     messaged.
   - `in_progress` with a clean tree: the pass died before its first commit or after its last.
     Compare `git log` with the progress file's ticks, say which, and continue the pass.
   - `committed`: start the next pass.

## Agents

Launch each agent with the Agent tool, passing the role's model as `model` only when it isn't
`inherit`. Post one line as you launch it and one when it returns: role, model, commit range.

Every prompt carries facts and decisions: the ticket number, branch, base SHA, commit range, progress
file and UI flag; what its pass below adds; and the whole `decisions_made` list, so no agent re-raises
a settled question. The contract and the agent's own definition say how it works and what needs a
bite proof, and a prompt never grants an exemption from either. #41's fixer prompt waived a bite
proof its definition required, and the reviewers flagged the result (S10).

When an agent returns:

- A `DECISIONS NEEDED` block that isn't `none` is a decision stop. Relay the user's answer to the
  same agent with `SendMessage` (load it with `ToolSearch` `select:SendMessage`), and to a fresh agent
  of the same type if that one can't be reached.
- Its "Out of scope" lines go into `out_of_scope`, with `source` set to its pass: `implement` or
  `simplify`, and `review` for the reviewers and the fixer.

## The passes

Every pass has the same frame:

1. Set `pass` and `pass_status: in_progress`, write state.
2. Do the pass.
3. Read the diff of `src/` and `e2e/` that the pass produced, yourself. Anything wrong goes into
   `findings` as `O<n>` (axis `orchestrator`). #161's refresh-path bug was found this way.
4. Once every decision stop the pass raised is answered and acted on: record the pass's commits, set
   `pass_status: committed`, write state, run `report.sh`, and send the report.

### 1. Implement

1. Launch `ship-implementer`. Record its `agent_id`.
2. Its first return is a seam proposal. **Decision stop**: relay the seams, the ADRs each one touches,
   and its recommendation. Send the approved seams (with any changes the user made) back to it.
3. When it reports done, check before recording: its commits exist, its suite line's SHA is HEAD, the
   mutation line is filled in (or `n/a` because no `.ts` under `src/` changed), and `visual:check`
   passed if the ticket is UI. Record its Suite line in `checks` and its Mutation line in `mutation`
   with `pass: "implement"`.
4. CLAUDE.md wording it proposes (the e2e flow list) is a **decision stop**. On the user's yes, you
   make the edit and commit it as `WIP #NNN: CLAUDE.md — <what>`.

### 2. Simplify

1. Launch `ship-simplifier` over `<base sha>..HEAD`. It runs `/simplify` (its review and its fixes),
   runs the full suite, and commits. Record its `agent_id`.
2. When it returns, check its commits exist and its Suite line's SHA is HEAD. Record the Suite line
   in `checks`; Review step 1 reuses it.
3. If its notes say `/simplify` ran single-pass, the agent lacked the Agent tool: say so in your
   report.

Simplify has no decision stop of its own. `/simplify` leaves behaviour-changing and outside-the-diff
fixes undone, and Handoff batches them into one issue.

### 3. Review

1. If `report.sh`'s Checks line reads `HEAD` or `current`, the recorded `checks` stand: no code has
   changed since they ran. Otherwise run the whole suite at HEAD yourself: lint, tsc,
   `npm run build`, `npm test`, `npm run e2e` and `npm run visual:check` if the ticket is UI, and
   record it in `checks` with the SHA. The reviewers don't run it: two parallel e2e runs collide on
   port 3100 and on the build lock.
2. Follow steps 1–3 of `~/.claude/skills/mattpocock-skills/skills/engineering/code-review/SKILL.md`:
   - fixed point: the base SHA on loop 1 (so `pre_run` commits are reviewed), the previous loop's
     HEAD after that;
   - spec: the ticket, plus its parent spec if it has one;
   - standards: `CLAUDE.md`, `tests/README.md`, `CONTEXT.md`, `docs/adr/`, `docs/decisions.md`, and
     the smell baseline from that skill's step 3.
3. Launch two `ship-reviewer` agents in parallel, one with `axis: spec` and one with
   `axis: standards`. Each prompt carries what that skill's step 4 says it should, plus the suite
   results. From loop 2, add the findings the user picked last time, so the reviewers can mark each
   resolved or not.
4. Add their findings to `findings` and present them under `## Spec`, `## Standards` and
   `## Orchestrator`, unmerged and unreranked, as code-review step 5 does.
5. **Decision stop**: which findings to fix, which to leave for a follow-up issue, which to decline.
   Pre-tick every blocking finding and your recommended non-blocking ones to fix. From loop 2, a new
   non-blocking finding is pre-ticked as a follow-up instead, so a nit can't spend the last fix loop.
   A blocking finding the user unticks needs a reason, recorded in its `note`. A follow-up stays
   `open` until Handoff drafts its issue. With nothing picked to fix, skip Fix and go to Handoff.

### 4. Fix

1. Launch a fresh `ship-fixer` with the picked findings (id, `file:line`, summary, the user's note).
2. Record its commits, and a Mutation line in `mutation` with `pass: "fix"`. Then go back to Review
   with `loop + 1`, covering the fix commits' range only.
3. At most two fix loops. After the second re-review, if any picked finding is still open or the
   re-review raised new findings, that is a **decision stop** listing each one, with options: (a) one
   more fix loop, (b) a follow-up issue, (c) decline. A fix loop the user grants goes into
   `decisions_made`.

### 5. Handoff

1. If any `.ts` under `src/` changed: `npm run mutate:diff -- <base sha>...HEAD --typecheck`, a full
   run, recorded with `pass: "handoff"`. This is the score that gets reported. New survivors go to a
   fresh `ship-fixer`, with the implementer's loops counted against the same three-loop limit.
   Whatever survives the third loop is a **decision stop**.
2. Write the handoff doc, `docs/handoffs/YYMMDD-issue-NNN-<slug>.md`, in the shape of
   `docs/handoffs/261015-issue-161-fireteam-size-chips.md`: status; a pointer table to the progress
   file, the coverage journal and `git log <base>..HEAD`; a table of passes with commits and models;
   the behaviour decisions (decision / why / decided by); **local check steps** (the user tests by
   deploying to prod, so give steps they can run first); the files edited; the verified suite at its
   SHA; **For the next orchestrator**; Suggested skills. It is untracked. Never stage it.
3. Give every `out_of_scope` item already fixed on the branch `issue: "fixed"`, then draft
   follow-up issues from the open non-blocking findings and from the `out_of_scope` items whose
   `issue` is `null`. Every `source: "simplify"` item goes into one cleanup issue that lists them all;
   every other item gets its own. First check `gh issue list` for one that already covers each item;
   propose a comment there instead. **Decision stop**: the whole batch at once. Open only what the
   user approves, labelled `needs-triage`, and record each number.
4. **Decision stop**: push and open the PR. One yes covers `git push -u origin <branch>` and
   `gh pr create --base <base ref>`. Draft the body in the session scratchpad. Merging is the user's.
   If the user pushes it themselves, record `pr: "user"`.

## Decision stops

Always the user's call, whoever raises it. Agents get the same list from the agent contract:

- schema or API changes; dependency changes; deleting significant code; deviating from the spec;
  ambiguous requirements; auth, secrets or env config;
- surviving mutants after three loops; `Stryker disable` comments;
- CLAUDE.md wording; seams; which review findings to fix; follow-up issues; push and PR.

Ask in this form, and copy it into `state.decision` before you end the turn:

```
DECISIONS NEEDED:
- <decision>. Options: (a) … (b) …. Recommend (x): <why, one line>.
```

When the user answers, append `{pass, question, answer}` to `decisions_made`, one line each, and set
`decision` back to `null`.

## Reporting

Every status message you send starts with `report.sh NNN`'s output, pasted unedited. The script
reads the state file and `git`; that is where every SHA, count and score in your message comes from.
Type none of them from memory. Then add:

```
DECISIONS NEEDED:
- … (or "none")
Next: <the next action, one line>
```

`report.sh` exits 3 and prints `DISCREPANCY` when git contradicts the state file. The Stop hook
(`.claude/hooks/stop-ship-state.sh`) runs the same check at the end of every turn on a `feat/NNN-*`
branch with a state file, and blocks your turn from ending until you reconcile or say why you can't.

## Commits

- One WIP commit per logical chunk, `WIP #NNN: <what>`, so each pass's diff can be reviewed alone.
- `WIP #NNN: red — <what>` is a red-first commit. The commit gate (`.claude/hooks/guard-commit.sh`)
  skips vitest for it, nothing else, so a red test of a new function needs a typed stub to pass tsc.
- The gate logs every commit it sees to `.claude/hooks/logs/commit-gate.log`: pass, blocked or
  skipped, with the time taken. Read its last lines to confirm the gate ran on a commit.
- Never commit the state file or a handoff doc. Both are gitignored; keep it that way.
- Merges, pushes and force-pushes happen only at the push stop. After a GitHub-side merge, merge
  `origin/<branch>`. Never `pull --rebase`, never force-push.
