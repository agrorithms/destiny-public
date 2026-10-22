---
name: ship-ticket
description: Deliver one ready-for-agent issue through implement → simplify → review → fix → handoff, checkpointed so it resumes after a usage limit or /clear.
disable-model-invocation: true
argument-hint: "#NNN [implementer=<model>] [reviewer=<model>] [fixer=<model>]"
---

# Ship a ticket

You are the **orchestrator**. You carry one ticket through five **passes** and end your turn at every
**decision stop**. Agents write the code; you write the state file, read every diff, and run Simplify
yourself (the one pass where you edit code, because `/simplify` launches agents of its own and an
agent cannot).

Invoking this skill is the user's "go ahead" for this ticket. It is not a go-ahead for anything a
decision stop covers.

## Vocabulary

- **Ticket**: an open issue on `agrorithms/destiny-public` labelled `ready-for-agent`, with a section
  headed "Acceptance criteria" or "Done when".
- **Pass**: `implement`, `simplify`, `review`, `fix`, `handoff`, in that order. Review and fix loop.
- **Decision stop**: you put a question to the user, set `pass_status` to `awaiting_decision`, write
  state, and end your turn. Nothing proceeds until the user answers.
- **State file**: `docs/handoffs/NNN-state.json`. Gitignored with the rest of `docs/handoffs/`. You
  are its only writer. Schema and field rules: [state.md](state.md) — read it before your first write
  in a session.
- **Report**: what `.claude/skills/ship-ticket/report.sh NNN` prints, followed by your
  `DECISIONS NEEDED` and `Next` lines. See _Reporting_.
- **Agent contract**: [agent-contract.md](agent-contract.md), which every agent reads first: the
  always-the-user's-call list, the commit-message forms and the report format they return.

## Arguments

`$ARGUMENTS` is `#NNN`, then any `role=model` pairs. Roles: `implementer`, `reviewer`, `fixer`.
Models: `sonnet`, `opus`, `haiku`, `fable`, `inherit`. Anything else: stop and list the valid values.
Simplify has no role; it runs on the session's model.

When launching an agent, pass its model as the Agent tool's `model` only when the role's value isn't
`inherit`.

## 0. Entry

1. `gh issue view NNN --json number,title,body,labels,state`. If it is closed, lacks the label, or
   lacks the section, stop: "#NNN isn't ready: <what's missing>. Grill it first." Do no design work.
2. If `docs/handoffs/NNN-state.json` exists, go to **Resume**. Otherwise **Start**.

### Start

1. Read the ticket's "Blocked by" and "Parent". Propose a branch `feat/NNN-<slug>` and a base: the
   blocking ticket's branch if it is unmerged, else `main`. Name the progress file: the parent spec's
   existing `docs/progress/<spec>-*.md` (a new `## #NNN` section), else `docs/progress/NNN-<slug>.md`.
2. **Decision stop**: branch, base, progress file, models, and whether the ticket is UI (it touches
   `.tsx` or `e2e/`; your guess from the ticket, for the user to correct).
3. On the user's yes: `git switch -c <branch> <base>`, then write the first state.

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

## The passes

Every pass has the same frame:

1. Set `pass` and `pass_status: in_progress`, write state.
2. Do the pass.
3. Read the diff of `src/` and `e2e/` that the pass produced, yourself. Anything wrong goes into
   `findings` as `O<n>` (axis `orchestrator`). #161's refresh-path bug was found this way.
4. Record the pass's commits, set `pass_status: committed`, write state, run `report.sh`, and send
   the report.

A `DECISIONS NEEDED` block from any agent that isn't `none` is a decision stop. Relay the user's
answer to the same agent with `SendMessage` (load it with `ToolSearch` `select:SendMessage`), and to a
fresh agent of the same type if that one can't be reached.

### 1. Implement

1. Launch `ship-implementer` with the ticket number, branch, base SHA, progress file path and the UI
   flag. Record its `agent_id`.
2. Its first return is a seam proposal. **Decision stop**: relay the seams, the ADRs each one touches,
   and its recommendation. Send the approved seams (with any changes the user made) back to it.
3. When it reports done, check before recording: its commits exist, its suite line's SHA is HEAD, the
   mutation line is filled in (or `n/a` because no `.ts` under `src/` changed), and `visual:check`
   passed if the ticket is UI.
4. CLAUDE.md wording it proposes (the e2e flow list) is a **decision stop**. On the user's yes, you
   make the edit and commit it as `WIP #NNN: CLAUDE.md — <what>`.

### 2. Simplify

1. Run `/simplify` with: "The changes since `<base sha>`. Behaviour-preserving changes only. List
   anything that would change behaviour or reach outside this ticket's files as out of scope; don't
   apply it."
2. Run `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, and `npm run e2e` if the
   ticket is UI. Commit as `WIP #NNN: /simplify pass — <what>`, or record that it changed nothing.
3. Out-of-scope items go into `out_of_scope` with `source: "simplify"`.

### 3. Review

1. Run the whole suite at HEAD yourself: lint, tsc, `npm run build`, `npm test`, `npm run e2e` and
   `npm run visual:check` if the ticket is UI. Record it in `checks` with the SHA. The reviewers don't
   run it: two parallel e2e runs collide on port 3100 and on the build lock.
2. Follow steps 1–3 of `~/.claude/skills/mattpocock-skills/skills/engineering/code-review/SKILL.md`:
   - fixed point: the base SHA on loop 1, the previous loop's HEAD after that;
   - spec: the ticket, plus its parent spec if it has one;
   - standards: `CLAUDE.md`, `tests/README.md`, `CONTEXT.md`, `docs/adr/`, `docs/decisions.md`, and
     the smell baseline from that skill's step 3.
3. Launch two `ship-reviewer` agents in parallel, one with `axis: spec` and one with
   `axis: standards`. Each prompt carries what that skill's step 4 says it should, plus the suite
   results. From loop 2, add the findings the user picked last time, so the reviewers can mark each
   resolved or not.
4. Add their findings to `findings` and present them under `## Spec` and `## Standards`, unmerged and
   unreranked, as code-review step 5 does.
5. **Decision stop**: which findings to fix. Pre-tick every blocking finding and your recommended
   non-blocking ones. A blocking finding the user unticks needs a reason, recorded in its `note`.
   With nothing picked, skip Fix and go to Handoff.

### 4. Fix

1. Launch a fresh `ship-fixer` with the picked findings (id, `file:line`, summary, the user's note),
   the ticket, the branch and the base SHA.
2. Then go back to Review with `loop + 1`, covering the fix commits' range only.
3. At most two fix loops. If anything picked is still open after the second re-review, that is a
   **decision stop** listing what's open.

### 5. Handoff

1. If any `.ts` under `src/` changed: `npm run mutate:diff -- <base sha>...HEAD --typecheck`, a full
   run. This is the score that gets reported. New survivors go to a fresh `ship-fixer`, with the
   implementer's loops counted against the same three-loop limit. Whatever survives the third loop is
   a **decision stop**.
2. Write the handoff doc, `docs/handoffs/YYMMDD-issue-NNN-<slug>.md`, in the shape of
   `docs/handoffs/261015-issue-161-fireteam-size-chips.md`: status; a pointer table to the progress
   file, the coverage journal and `git log <base>..HEAD`; a table of passes with commits and models;
   the behaviour decisions (decision / why / decided by); **local check steps** (the user tests by
   deploying to prod, so give steps they can run first); the files edited; the verified suite at its
   SHA; **For the next orchestrator**; Suggested skills. It is untracked. Never stage it.
3. Draft follow-up issues from the unpicked non-blocking findings and from `out_of_scope`. First
   check `gh issue list` for one that already covers each item; propose a comment there instead.
   **Decision stop**: the whole batch at once. Open only what the user approves, labelled
   `needs-triage`, and record each number.
4. **Decision stop**: push and open the PR. One yes covers `git push -u origin <branch>` and
   `gh pr create --base <base ref>`. Draft the body in the session scratchpad. Merging is the user's.

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
- Never commit the state file or a handoff doc. Both are gitignored; keep it that way.
- Merges, pushes and force-pushes happen only at the push stop. After a GitHub-side merge, merge
  `origin/<branch>`. Never `pull --rebase`, never force-push.
