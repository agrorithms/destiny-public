#!/usr/bin/env bash
# Stop: keep a /ship-ticket turn from ending while its state file and git
# disagree.
#
# Why this exists: orchestrator reports were written from memory, and memory
# said "uncommitted" about work that had already landed. The skill now builds
# every report from the state file plus git; this hook catches the turn where
# the state file itself has drifted from git, before the user reads a report
# built on it.
#
# Acts only on a `feat/NNN-*` branch whose docs/handoffs/NNN-state.json exists.
# Every other turn of every other session exits 0 at once. The checks
# themselves live in ship-state.sh, shared with report.sh.
#
# Blocks ONCE. A block makes Claude keep going and reconcile; if the state is
# still wrong when it tries to stop again (stop_hook_active), the hook steps
# aside and shows the user the problem instead. Blocking twice would loop for
# as long as the problem lasted.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$(dirname "${BASH_SOURCE[0]}")/ship-state.sh"

CWD="$(hook_field '.cwd')"
ROOT="$(git -C "${CWD:-${CLAUDE_PROJECT_DIR:-.}}" rev-parse --show-toplevel 2>/dev/null)" || exit 0
TICKET="$(ship_ticket_for_branch "$ROOT")" || exit 0
STATE="$ROOT/docs/handoffs/$TICKET-state.json"
[ -f "$STATE" ] || exit 0

PROBLEMS="$(ship_state_problems "$ROOT" "$STATE")"
[ -z "$PROBLEMS" ] && exit 0

if [ "$(hook_field '.stop_hook_active')" = "true" ]; then
  jq -nc --arg m "/ship-ticket #$TICKET: the state file still disagrees with git:
$PROBLEMS" '{systemMessage: $m}'
  exit 0
fi

jq -nc --arg r "The /ship-ticket #$TICKET state file disagrees with git:
$PROBLEMS

Before you report anything, run .claude/skills/ship-ticket/report.sh $TICKET. Then either correct the state file from git (git log, git status) or tell the user what you found and that you can't reconcile it. Never correct it from memory." \
  '{decision: "block", reason: $r}'
