# `/ship-ticket` fixes after its first real run (#41)

Implements decisions Q1–Q19 from the `ship-skill-fixes` grilling session (2026-10-22) on
`wf/ship-skill-fixes`, one WIP commit per chunk. The decisions and their reasons are in the untracked
`docs/handoffs/261022-ship-ticket-skill-fixes-decisions.md`; this file tracks only the edits.

## 1. Hooks

- [x] `.claude/hooks/ship-state.sh`: the "code changed" check (Q9); `pre_run` SHAs checked (Q6)
- [x] `.claude/hooks/guard-commit.sh`: a log line and a `systemMessage` per gated commit (Q13)
- [x] `.claude/hooks/test-hooks.sh`: cases for the above
- [x] `.gitignore`: `.claude/hooks/logs/` (proposed in the grilling; approved by the user 2026-10-23)
- [x] `bash .claude/hooks/test-hooks.sh` → `PASS: 145 FAIL: 0` (14 new: 9 in §I, 2 in §J, 3 in a new §J2)

## 2. `report.sh` and the state schema

- [x] `.claude/skills/ship-ticket/report.sh`: 30 commits and "… N more", `pre_run`, findings by axis,
      code-aware STALE, `mutation.pass`, `issue: "fixed"`, `pr: "user"` (Q6–Q10)
- [x] `.claude/skills/ship-ticket/state.md`: `simplifier`, `pre_run`, `decisions_made`,
      `mutation.pass`/`full`, `issue: "fixed"`, `pr: "user"`, review's `committed` (Q2, Q6–Q8, Q15)
- [x] `.claude/hooks/test-hooks.sh`: a new §J3, 12 cases for `report.sh`
- [x] `bash .claude/hooks/test-hooks.sh` → `PASS: 157 FAIL: 0`; against the old `report.sh`, 9 of
      the 12 fail (the other 3 pin behaviour it already had)

## 3. The skill, the contract and the simplifier

- [x] `.claude/skills/ship-ticket/SKILL.md`
- [x] `.claude/skills/ship-ticket/agent-contract.md`
- [x] `.claude/agents/ship-simplifier.md` (new)

## 4. Code review fixes (2026-10-23)

From a two-axis review of `main...wf/ship-skill-fixes` at `a328722`. The user agreed each item below.

- [x] `.claude/hooks/ship-state.sh`: `ship_code_unchanged_since` names what isn't code (`docs/`,
      `*.md`) instead of listing code paths; the old list missed `vitest.config.ts`, the tsconfigs,
      `middleware.ts` and the other root configs (Q9)
- [x] `.claude/hooks/test-hooks.sh` §J2: a root `CLAUDE.md`, `vitest.config.ts` and `middleware.ts`
      commit each; the last two fail against the old list
- [x] `.claude/agents/ship-simplifier.md` step 3: a changed Playwright spec gets a deliberate break,
      as CLAUDE.md says (Q16)
- [x] `.claude/skills/ship-ticket/SKILL.md` Handoff step 3: when `issue: "fixed"` is set (Q8)
- [x] A `follow-up` finding status: set by Review step 5 and Fix step 3, drafted at Handoff, shown by
      `report.sh` (Q4)
- [x] `passes.*.model` records the model that ran, never `inherit` (Q15)
- [ ] `agent-contract.md`: the contract and the definition both win over a prompt (S9)
- [ ] Review step 1 calls `ship_code_unchanged_since` against `checks.sha` (S5)
- [ ] "Start writes no state" once in SKILL.md; the `decisions_made` append rule only in state.md (S4)
- [ ] §J2's exit-code style; a comment on the 36-commit case (S8)
- [ ] `guard-commit.sh:37` comment: "the orchestrator doesn't rely on it" (S6)

Not changed:

- **S7, deferred:** the gate log grows without a sweep. It's ~100 bytes a commit, and
  `HOOK_STATE_DIR`'s mtime sweep wouldn't age out a file that's appended to anyway.
- **S3, rejected:** `issue: "fixed"` and `pr: "user"` are sentinels in place of a separate field. Two
  documented sentinels with one reader; revisit if a third appears.
- **The five scope-creep items, kept:** the "No axis recorded" group, the `pre_run` SHA checks,
  fix / follow-up / decline on every loop, the simplifier ticking its box, the contract template's
  definition lines.

## Outside the commits

- [x] `docs/handoffs/261022-ship-ticket-skill-design.md`: Q20 and Q29 amendments appended
      (untracked, never staged)
- [x] `CLAUDE.md` `### Shipping a ticket`: `simplifier=<model>` added by the user (committed in §4)

## Verification

All at `242d5ba`.

- [x] `bash .claude/hooks/test-hooks.sh` → `PASS: 157 FAIL: 0` (131 before this branch)
- [x] `npm run lint`: exit 0, 0 errors, 58 warnings. All are `no-explicit-any` in
      `gos10k/bungie-fetch.ts` and `gos10k/gos_10k_pgcr.smoke.ts`, counted twice because ESLint also
      reads the leftover probe worktree under `.claude/worktrees/`; 29 per copy, as at install
- [x] `npm run build`: exit 0
- [x] `npm test`: 48 files, 583 tests, all passed

No app code changed, so `mutate:diff`, e2e and `visual:check` don't apply. The gate's real path ran on
each code commit and logged it (`pass 37s`, `pass 36s`), and logged the `.md`-only commit as skipped.
