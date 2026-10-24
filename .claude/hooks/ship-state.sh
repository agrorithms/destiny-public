# What "the /ship-ticket state file agrees with git" means, in one place.
# Sourced, never executed directly — hence no shebang and mode 644.
#
# Two callers: stop-ship-state.sh (the Stop hook) and
# .claude/skills/ship-ticket/report.sh (the orchestrator's report). Sharing the
# check means the report can never call a state OK that the hook then blocks on.
#
# Deliberately separate from lib.sh: lib.sh drains stdin at source time, which
# suits a hook and stalls report.sh, run from a Bash tool call, for its 2s
# timeout.

# ship_ticket_for_branch <root> -> the NNN of a `feat/NNN-*` branch, or exit 1.
# The branch name is how the Stop hook finds the ticket without being told:
# Stop fires on every turn of every session, and only these branches are ours.
ship_ticket_for_branch() {
  local b
  b="$(git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null)" || return 1
  [[ "$b" =~ ^feat/([0-9]+)- ]] || return 1
  echo "${BASH_REMATCH[1]}"
}

# ship_state_problems <root> <state-file> -> one problem per line; no output
# means the state file and git agree.
#
# Checks only what git can confirm or contradict:
#   - the branch the state names is the one checked out;
#   - every recorded SHA (base, head, pre_run, each pass's commits) exists and
#     is an ancestor of HEAD. HEAD may have moved on since (later commits are
#     normal); a SHA that left HEAD's history means a rebase, reset or
#     force-push the state knows nothing about;
#   - a pass recorded as `committed` leaves a clean tree. A dirty tree while a
#     pass is in progress is normal, and not reported.
ship_state_problems() {
  local root="$1" state="$2" sha branch cur status dirty
  if ! jq -e . "$state" >/dev/null 2>&1; then
    echo "the state file is not valid JSON: $state"
    return
  fi

  branch="$(jq -r '.branch // ""' "$state")"
  cur="$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null)"
  [ "$branch" = "$cur" ] || echo "the state records branch '$branch', but '${cur:-a detached HEAD}' is checked out"

  while IFS= read -r sha; do
    [ -z "$sha" ] && continue
    if ! git -C "$root" cat-file -e "$sha^{commit}" 2>/dev/null; then
      echo "recorded commit $sha does not exist"
    elif ! git -C "$root" merge-base --is-ancestor "$sha" HEAD; then
      echo "recorded commit $sha is not in HEAD's history (rebased, reset or force-pushed?)"
    fi
  done < <(jq -r '[.base.sha, .head, (.pre_run // [] | .[]), (.passes // {} | .[] | .commits // [] | .[])] | .[] | select(. != null and . != "")' "$state")

  status="$(jq -r '.pass_status // ""' "$state")"
  if [ "$status" = "committed" ]; then
    dirty="$(git -C "$root" status --porcelain)"
    if [ -n "$dirty" ]; then
      echo "the state says pass '$(jq -r '.pass' "$state")' is committed, but the working tree is dirty:"
      head -n 10 <<<"$dirty" | sed 's/^/    /'
    fi
  fi
}

# ship_code_unchanged_since <root> <sha> -> exit 0 when no code path differs
# between <sha> and HEAD; non-zero when one does, or when <sha> is unknown.
#
# "Code" is everything but docs/ and Markdown. A range that touches only docs,
# the progress file or CLAUDE.md leaves a suite run at <sha> as good as one at
# HEAD. Two callers rely on that, and must not each define it: report.sh,
# which prints such a run as "current" rather than STALE, and the skill's
# Review step 1, which calls this to reuse `checks` instead of rerunning a
# ~5 minute suite on an identical tree (#41 ran it four times).
#
# It names what isn't code rather than what is: a missed path here costs one
# extra suite run, while a missed path in a list of code paths (vitest.config.ts,
# middleware.ts, a tsconfig) would reuse stale checks.
#
# Committed changes only: the working tree isn't compared.
ship_code_unchanged_since() {
  git -C "$1" diff --quiet "$2" HEAD -- . ':(exclude)docs' ':(exclude)*.md' 2>/dev/null
}
