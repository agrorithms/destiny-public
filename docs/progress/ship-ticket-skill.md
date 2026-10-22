# Installing the `/ship-ticket` skill

Installs the drafted `/ship-ticket` skill, its three agents and its two hooks on `wf/ship-skill`.
The design (decisions Q1–Q30) was settled in a grilling session on 2026-10-22; this file tracks
only the install, one WIP commit per chunk.

## 1. Commit gate, Stop state check, hook tests

- [x] `.claude/hooks/guard-commit.sh` (755)
- [x] `.claude/hooks/stop-ship-state.sh` (755)
- [x] `.claude/hooks/ship-state.sh` (644, sourced)
- [x] `.claude/hooks/test-hooks.sh` (replaced: the existing 95 cases plus §I and §J)
- [x] `.claude/settings.json` (replaced: two hook entries added)
- [x] `bash .claude/hooks/test-hooks.sh` → `PASS: 128 FAIL: 3`. The three are §J's `report.sh`
      cases, which can't pass until chunk 2 installs `report.sh`

## 2. The skill and its three agents

- [x] `.claude/skills/ship-ticket/SKILL.md`
- [x] `.claude/skills/ship-ticket/state.md`
- [x] `.claude/skills/ship-ticket/agent-contract.md`
- [x] `.claude/skills/ship-ticket/report.sh` (755)
- [x] `.claude/agents/ship-implementer.md`
- [x] `.claude/agents/ship-reviewer.md`
- [x] `.claude/agents/ship-fixer.md`
- [x] `.claude/hooks/test-hooks.sh`: §J's three `report.sh` cases called a relative `$H` after
      `cd "$SHIP_REPO"` (exit 127; the sandbox had an absolute `H`). Now an absolute `$REPORT`,
      fixed in §J only
- [x] `bash .claude/hooks/test-hooks.sh` rerun → `PASS: 131 FAIL: 0`

## 3. CLAUDE.md

- [x] `CLAUDE.md`: the commit gate and worktree paragraphs under **Environment**, and
      `### Shipping a ticket` under **Agent skills**

## Verification

- [x] `npm run lint`: exit 0, 0 errors, 29 warnings (all pre-existing)
- [x] `npm run build`: exit 0
- [x] `npm test`: 48 files, 583 tests, all passed (at `59eb215`)
