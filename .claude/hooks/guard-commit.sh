#!/usr/bin/env bash
# PreToolUse(Bash): refuse a `git commit` while lint, tsc or vitest is red.
#
# Why this exists: a commit on a red suite was otherwise only caught by a
# reviewer pass, or by CI after a push. Decided with /ship-ticket (2026-10-22),
# but it gates every commit Claude makes in this repo, whatever the session.
#
# What it runs, about 30s on this machine (14s + 4s + 6s + 6s): `npm run lint`,
# `npx tsc --noEmit` (the app), `npx tsc -p tsconfig.scripts.json --noEmit`
# (scripts/), `npm test`. Not `npm run build` (33s more): it rewrites .next, and
# `npm run e2e:nobuild` reuses whatever .next holds, including the dummy Bungie
# key the e2e build bakes in. A gate that built would silently swap that out
# from under it. Each /ship-ticket pass runs the build itself and records the
# SHA it passed at.
#
# Two exemptions:
#   - `WIP #NNN: red — …` in the command is a deliberate red-first commit. Only
#     vitest is skipped; lint and tsc still run.
#   - when every changed path in the tree is `*.md`, nothing runs. Read from the
#     whole tree, not the index, because this runs before `git add x && git
#     commit` has staged anything. Unrelated code edits lying around therefore
#     make a docs commit pay for the full gate — the safe direction to be wrong.
#
# Fails OPEN on "is this a commit?", like the other guards. Fails CLOSED once it
# is one: a check that doesn't exit 0, whether it failed or crashed, blocks.
# A gate that waved commits through on a crash would be the failure it exists
# to stop.
#
# Known gap: the checks run against the working tree, not the staged snapshot,
# so a partial `git add` can commit a state that was never checked.
#
# Every gated commit appends one line to .claude/hooks/logs/commit-gate.log
# (gitignored) in the checkout it ran in: pass, blocked or skipped, and how
# long it took. A PreToolUse hook's ~30s is invisible from inside a session
# (`time git commit` shows 0s), so the log is how anyone, an orchestrator
# included, answers "did the gate run on that commit?". A pass also emits a
# systemMessage; whether that reaches the model is unverified, so the
# orchestrator doesn't rely on it. A log that can't be written never blocks a commit.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CMD="$(hook_field '.tool_input.command')"
invokes "$CMD" 'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)*[[:space:]]+commit' || exit 0

CWD="$(hook_field '.cwd')"
ROOT="$(git -C "${CWD:-${CLAUDE_PROJECT_DIR:-.}}" rev-parse --show-toplevel 2>/dev/null)" || exit 0

START=$SECONDS
RAN=""
log_gate() { # log_gate <result>
  local where
  where="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || echo detached)@$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"
  { mkdir -p "$ROOT/.claude/hooks/logs" &&
    printf '%s %s %s %ss %s\n' "$(date -u +%FT%TZ)" "$where" "$1" "$((SECONDS - START))" "${RAN:-none}" \
      >> "$ROOT/.claude/hooks/logs/commit-gate.log"; } 2>/dev/null || true
}

# Porcelain v1 is "XY path" or "XY old -> new"; keep the path that will exist.
CHANGED="$(git -C "$ROOT" status --porcelain=v1 --untracked-files=all 2>/dev/null | cut -c4- | sed 's/.* -> //')"
# Nothing changed at all (a message-only --amend, or nothing to commit): no code to check.
[ -z "$CHANGED" ] && { log_gate "skipped (nothing changed)"; exit 0; }
grep -qvE '\.md$' <<<"$CHANGED" || { log_gate "skipped (only *.md changed)"; exit 0; }

RED=0
grep -qE 'WIP #[0-9]+: red [—-] ' <<<"$CMD" && RED=1

# The test suite swaps this for a stub that records what would have run, so
# every branch here is exercised in milliseconds (test-hooks.sh §I). Same idea
# as HOOK_STATE_DIR.
RUNNER="${COMMIT_GATE_RUNNER:-}"

run_check() { # run_check <label> <command...>
  local label="$1" out rc
  shift
  RAN="${RAN:+$RAN,}$label"
  if [ -n "$RUNNER" ]; then
    out="$("$RUNNER" "$label" "$@" 2>&1)"; rc=$?
  else
    out="$(cd "$ROOT" && "$@" 2>&1)"; rc=$?
  fi
  [ "$rc" -eq 0 ] && return 0
  log_gate "blocked by $label"
  deny "Commit blocked: $label is red ($* exited $rc). Fix it, then commit again.
A red-first TDD commit is spelled 'WIP #NNN: red — <what>'; that skips vitest only.

Last 40 lines:
$(tail -n 40 <<<"$out")"
}

run_check lint npm run lint
run_check "tsc (app)" npx tsc --noEmit
run_check "tsc (scripts)" npx tsc -p tsconfig.scripts.json --noEmit
[ "$RED" -eq 1 ] || run_check vitest npm test
log_gate "pass$([ "$RED" -eq 1 ] && echo ' (red-first: vitest skipped)')"
jq -nc --arg m "commit gate: pass in $((SECONDS - START))s" '{systemMessage: $m}'
exit 0
