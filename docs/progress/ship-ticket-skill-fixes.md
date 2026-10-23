# `/ship-ticket` fixes after its first real run (#41)

Implements decisions Q1–Q19 from the `ship-skill-fixes` grilling session (2026-10-22) on
`wf/ship-skill-fixes`, one WIP commit per chunk. The decisions and their reasons are in the untracked
`docs/handoffs/261022-ship-ticket-skill-fixes-decisions.md`; this file tracks only the edits.

## 1. Hooks

- [ ] `.claude/hooks/ship-state.sh`: the "code changed" check (Q9); `pre_run` SHAs checked (Q6)
- [ ] `.claude/hooks/guard-commit.sh`: a log line and a `systemMessage` per gated commit (Q13)
- [ ] `.claude/hooks/test-hooks.sh`: cases for the above and for chunk 2's `report.sh`
- [ ] `.gitignore`: `.claude/hooks/logs/` (proposed in the grilling, not explicitly confirmed)
- [ ] `bash .claude/hooks/test-hooks.sh`

## 2. `report.sh` and the state schema

- [ ] `.claude/skills/ship-ticket/report.sh`: 30 commits and "… N more", `pre_run`, findings by axis,
      code-aware STALE, `mutation.pass`, `issue: "fixed"`, `pr: "user"` (Q6–Q10)
- [ ] `.claude/skills/ship-ticket/state.md`: `simplifier`, `pre_run`, `decisions_made`,
      `mutation.pass`/`full`, `issue: "fixed"`, `pr: "user"`, review's `committed` (Q2, Q6–Q8, Q15)
- [ ] `bash .claude/hooks/test-hooks.sh`

## 3. The skill, the contract and the simplifier

- [ ] `.claude/skills/ship-ticket/SKILL.md`
- [ ] `.claude/skills/ship-ticket/agent-contract.md`
- [ ] `.claude/agents/ship-simplifier.md` (new)

## Outside the commits

- [ ] `docs/handoffs/261022-ship-ticket-skill-design.md`: Q20 and Q29 amendments appended
      (untracked, never staged)
- [ ] `CLAUDE.md` `### Shipping a ticket`: `simplifier=<model>` proposed to the user, not edited

## Verification

- [ ] `bash .claude/hooks/test-hooks.sh` (131/131 before this branch)
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test`
