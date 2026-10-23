# `/ship-ticket` fixes after its first real run (#41)

Implements decisions Q1–Q19 from the `ship-skill-fixes` grilling session (2026-10-22) on
`wf/ship-skill-fixes`, one WIP commit per chunk. The decisions and their reasons are in the untracked
`docs/handoffs/261022-ship-ticket-skill-fixes-decisions.md`; this file tracks only the edits.

## 1. Hooks

- [x] `.claude/hooks/ship-state.sh`: the "code changed" check (Q9); `pre_run` SHAs checked (Q6)
- [x] `.claude/hooks/guard-commit.sh`: a log line and a `systemMessage` per gated commit (Q13)
- [x] `.claude/hooks/test-hooks.sh`: cases for the above
- [x] `.gitignore`: `.claude/hooks/logs/` (proposed in the grilling, not explicitly confirmed)
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

## Outside the commits

- [x] `docs/handoffs/261022-ship-ticket-skill-design.md`: Q20 and Q29 amendments appended
      (untracked, never staged)
- [x] `CLAUDE.md` `### Shipping a ticket`: `simplifier=<model>` proposed to the user, not edited (awaiting their wording call)

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
