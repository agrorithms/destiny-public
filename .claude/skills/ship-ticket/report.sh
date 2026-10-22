#!/usr/bin/env bash
# report.sh NNN — the factual top of every /ship-ticket status message.
#
# Prints the ticket's state from docs/handoffs/NNN-state.json and from git, so
# no SHA, count or score in a report is typed from memory. Checks the state
# against git with the same function the Stop hook uses (ship-state.sh).
#
# Exit 0: consistent. Exit 3: a DISCREPANCY, printed last. Exit 2: no state file.
set -uo pipefail

N="${1#\#}"
[[ "$N" =~ ^[0-9]+$ ]] || { echo "usage: report.sh NNN" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel)" || exit 2
# Relative to this script, not to $ROOT, so it works from any worktree.
source "$(dirname "${BASH_SOURCE[0]}")/../../hooks/ship-state.sh"
STATE="$ROOT/docs/handoffs/$N-state.json"
[ -f "$STATE" ] || { echo "no state file: docs/handoffs/$N-state.json" >&2; exit 2; }

PROBLEMS="$(ship_state_problems "$ROOT" "$STATE")"
if ! jq -e . "$STATE" >/dev/null 2>&1; then
  echo "DISCREPANCY"; echo "$PROBLEMS"; exit 3
fi

j() { jq -r "$1" "$STATE"; }
short() { [ -n "$1" ] && [ "$1" != "null" ] && git rev-parse --short "$1" 2>/dev/null || echo "—"; }

HEAD_SHA="$(git rev-parse HEAD)"
BASE_SHA="$(j '.base.sha')"
BRANCH="$(j '.branch')"

# How far a recorded SHA is behind HEAD, as words.
age() {
  [ -z "$1" ] || [ "$1" = "null" ] && { echo "never run"; return; }
  [ "$(git rev-parse "$1" 2>/dev/null)" = "$HEAD_SHA" ] && { echo "HEAD"; return; }
  local n; n="$(git rev-list --count "$1..HEAD" 2>/dev/null)" || { echo "unknown commit"; return; }
  echo "STALE, $n commit(s) behind HEAD"
}

if [ -z "$(git status --porcelain)" ]; then TREE="tree clean"; else TREE="tree DIRTY ($(git status --porcelain | wc -l) paths)"; fi
UPSTREAM="$(git rev-parse --abbrev-ref "$BRANCH@{upstream}" 2>/dev/null)"
if [ -z "$UPSTREAM" ]; then PUSHED="not pushed"
else PUSHED="pushed, $(git rev-list --count "$UPSTREAM..HEAD") ahead / $(git rev-list --count "HEAD..$UPSTREAM") behind $UPSTREAM"; fi

echo "#$N $(j '.title')"
echo "Branch $BRANCH @ $(short "$HEAD_SHA") · base $(j '.base.ref') @ $(short "$BASE_SHA") · $(git rev-list --count "$BASE_SHA..HEAD" 2>/dev/null || echo '?') commits · $TREE · $PUSHED"
echo "Models $(j '.models | to_entries | map("\(.key)=\(.value)") | join("  ")')"

line="Passes"
for p in implement simplify review fix handoff; do
  s="$(j ".passes.$p.status // \"pending\"")"
  case "$s" in
    committed) mark="✓" ;; skipped) mark="–" ;; pending) mark="·" ;;
    *) mark="▶ $s" ;;
  esac
  loop="$(j ".passes.$p.loop // 0")"
  [ "$loop" -gt 1 ] 2>/dev/null && mark="$mark (loop $loop)"
  line="$line  $p $mark"
done
echo "$line"

echo
echo "Commits ($(short "$BASE_SHA")..HEAD)"
git log --format='  %h %s' --reverse "$BASE_SHA..HEAD" 2>/dev/null | tail -n 20

echo
CS="$(j '.checks.sha // empty')"
echo "Checks   @ $(short "$CS") ($(age "$CS")): lint $(j '.checks.lint // "—"') · tsc $(j '.checks.tsc // "—"') · build $(j '.checks.build // "—"') · vitest $(j '.checks.vitest // "—"') · e2e $(j '.checks.e2e // "—"') · visual $(j '.checks.visual // "—"')"
MS="$(j '.mutation.sha // empty')"
if [ -n "$MS" ]; then
  kind="$(j 'if .mutation.full then "full --typecheck run" else "incremental, not the reported score" end')"
  echo "Mutation @ $(short "$MS") ($(age "$MS"); $kind): $(j '.mutation.overall')% overall ($(j '.mutation.killed')/$(j '.mutation.scored')), $(j '.mutation.covered')% covered — $(j '.mutation.verdict'); survivors: $(j '.mutation.survivors | if length == 0 then "none" else join(", ") end')"
else
  echo "Mutation not run"
fi

echo
OPEN="$(j '[.findings // [] | .[] | select(.status == "open" or .status == "picked")] | length')"
echo "Findings open or picked: $OPEN"
j '.findings // [] | .[] | select(.status == "open" or .status == "picked") | "  \(.id) \(.severity) \(.status) \(.where) — \(.summary)"'
echo "Out of scope: $(j '.out_of_scope // [] | length') listed, $(j '[.out_of_scope // [] | .[] | select(.issue != null)] | length') with an issue"
ISSUES="$(j '.passes.handoff.issues // [] | map("#\(.)") | join(" ")')"
[ -n "$ISSUES" ] && echo "Issues opened: $ISSUES"
PR="$(j '.passes.handoff.pr // empty')"
[ -n "$PR" ] && echo "PR: $PR"

echo
if [ -n "$PROBLEMS" ]; then
  echo "DISCREPANCY — the state file and git disagree:"
  echo "$PROBLEMS" | sed 's/^/  /'
  exit 3
fi
echo "State OK: every recorded SHA is in HEAD's history$( [ "$(j '.pass_status')" = "committed" ] && echo ', and the tree is clean as recorded')."
