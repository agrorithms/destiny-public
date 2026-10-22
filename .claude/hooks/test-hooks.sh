#!/usr/bin/env bash
# Full behavioural test for the .claude/hooks suite. Run: bash .claude/hooks/test-hooks.sh
cd /home/louisagro/destinyCode/destiny-farm-finder || exit 1
H=.claude/hooks

# Run against a throwaway state dir, NOT the live one.
#
# The suite rm -rf's its state dir several times. Pointed at the real
# /tmp/claude-hooks-$(id -u), that deletes the warned-PID file of any session
# currently running — silently disabling its orphan check for the rest of the
# session. Exported before lib.sh is sourced so the hooks under test inherit it.
export HOOK_STATE_DIR="/tmp/claude-hooks-test-$$"
D="$HOOK_STATE_DIR"
# One handler. A second `trap ... EXIT` later in the file would silently
# replace this one rather than adding to it.
STARTED_LISTENER=""
cleanup() {
  rm -rf "$HOOK_STATE_DIR"
  [ -n "$STARTED_LISTENER" ] && kill "$STARTED_LISTENER" 2>/dev/null
}
trap cleanup EXIT

source "$H/lib.sh" < /dev/null

pass=0; fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 (expected '$2', got '$3')"; fail=$((fail+1)); fi
}
m() { invokes "$1" "$2" && echo match || echo nomatch; }

echo "=== A. invokes() matcher: real invocations must MATCH ==="
DEVPAT='npm run dev|next dev'
while IFS= read -r c; do
  check "invocation: $c" "match" "$(m "$c" "$DEVPAT")"
done <<'INVOCATIONS'
npm run dev
cd app && npm run dev
PORT=3001 npm run dev
next dev
npm run dev -- --turbo
INVOCATIONS

echo
echo "=== A2. bypasses closed by the wrapper allowlist / anchor fix ==="
# Each of these slipped past the original matcher. They are forms Claude
# genuinely emits, so a silent bypass here means the guard simply never fires.
while IFS= read -r c; do
  check "closed bypass: $c" "match" "$(m "$c" "$DEVPAT")"
done <<'BYPASSES'
nohup npm run dev &
env npm run dev
(npm run dev)
x=$(npm run dev)
if true; then npm run dev; fi
for i in 1; do npm run dev; done
BYPASSES
check "closed bypass: timeout 600 npm run build" "match" \
  "$(m 'timeout 600 npm run build' 'npm run build')"

echo
echo "=== A3. sh -c stays an ACCEPTED bypass (pinned deliberately) ==="
# Nested quoting is where regex stops paying and nothing in the incident
# history involved it. This assertion exists so the gap cannot be closed by
# accident without someone re-reading the trade-off.
check "accepted bypass: sh -c" "nomatch" "$(m 'sh -c "npm run dev"' "$DEVPAT")"

echo
echo "=== B. invokes() matcher: mere mentions must NOT match ==="
while IFS= read -r c; do
  check "mention: $c" "nomatch" "$(m "$c" "$DEVPAT")"
done <<'MENTIONS'
echo "npm run dev"
grep -r "npm run dev" .
echo '{"tool_input":{"command":"npm run dev"}}' | ./hook.sh
git commit -m "document npm run dev"
echo "first; npm run dev second"
MENTIONS
# yarn/pnpm were unrequested scope creep; this repo is npm-only.
check "mention: yarn dev (out of scope)" "nomatch" "$(m 'yarn dev' "$DEVPAT")"

echo
echo "=== B2. heredoc bodies are not invocations (spec R1.3) ==="
# Writing docs about `npm run dev` used to be denied — and only while a server
# was running, i.e. exactly when you are most likely to be documenting one.
HEREDOC='cat > docs/x.md <<EOF
npm run dev
EOF'
check "heredoc body -> nomatch" "nomatch" "$(m "$HEREDOC" "$DEVPAT")"
HEREDOC_Q="cat > docs/x.md <<'EOF'
npm run dev
EOF"
check "quoted heredoc body -> nomatch" "nomatch" "$(m "$HEREDOC_Q" "$DEVPAT")"
# The opener line itself, and anything after the terminator, still count.
HEREDOC_AFTER='cat > docs/x.md <<EOF
some text
EOF
npm run dev'
check "invocation after heredoc -> match" "match" "$(m "$HEREDOC_AFTER" "$DEVPAT")"
# `<<<` is a here-string, not a heredoc — must not swallow the rest.
check "here-string is not a heredoc" "match" "$(m 'grep x <<<"y"
npm run dev' "$DEVPAT")"

# S-1 regression. A `<<` inside a QUOTED string is not a heredoc opener. When it
# was treated as one, it adopted a terminator that never arrived and discarded
# every following line — silently turning all three guards into no-ops. This is
# the highest-severity bug the suite has caught; do not delete this assertion.
check "quoted << does not open a heredoc" "match" "$(m 'echo "a << B"
npm run dev' "$DEVPAT")"
check "quoted << (destructive pattern)" "match" "$(m 'echo "a << B"
rm -rf node_modules' 'rm -[a-zA-Z]*[rR][a-zA-Z]*')"
# The quoted-terminator form must still be recognised as a REAL heredoc — the
# naive fix for the above (blanking quotes before detecting) breaks exactly this.
check "quoted-terminator heredoc still strips body" "nomatch" "$(m "cat > f <<'EOF'
npm run dev
EOF" "$DEVPAT")"
check "double-quoted-terminator heredoc still strips body" "nomatch" "$(m 'cat > f <<"EOF"
npm run dev
EOF' "$DEVPAT")"
check "<<- dash form still strips body" "nomatch" "$(m 'cat <<-EOF
npm run dev
EOF' "$DEVPAT")"

echo
echo "=== C. build matcher ==="
BLDPAT='npm run build|npm run next-build|next build'
check "invocation: npm run build" "match" "$(m 'npm run build' "$BLDPAT")"
check "mention: echo npm run build" "nomatch" "$(m 'echo "npm run build"' "$BLDPAT")"

echo
echo "=== C2. destructive matcher (R7) ==="
# Sourced from lib.sh, not restated: this copy had already drifted to a
# narrower pattern than production used.
DESTPAT="$HOOK_DESTRUCTIVE"
while IFS= read -r c; do
  check "destructive: $c" "match" "$(m "$c" "$DESTPAT")"
done <<'DESTRUCTIVE'
npm uninstall sqlite3
cd . && npm uninstall sqlite3
npm prune
rm -rf node_modules
rm -fr build
DESTRUCTIVE
check "destructive: mention" "nomatch" "$(m 'echo "npm uninstall sqlite3"' "$DESTPAT")"
# Single-file deletes are deliberately not gated — prompting on every one
# would train the prompt to be ignored.
check "destructive: rm -f single file not gated" "nomatch" "$(m 'rm -f /tmp/x' "$DESTPAT")"

echo
echo "=== C3. invokes_strict(): R7 sees inside quotes, R1/R2 still do not ==="
# Spec's matching policy says "a false positive costs more than a bypass". That
# was derived from R1/R2, where the decision is DENY and a false positive blocks
# real work. R7 emits ASK, so the asymmetry inverts: a missed `rm -rf` destroys
# state, a false prompt costs one keystroke. invokes_strict() therefore skips
# quote-blanking and allows an `sh -c` wrapper.
ms() { invokes_strict "$1" "$2" && echo match || echo nomatch; }
DESTPAT="$HOOK_DESTRUCTIVE"
check "strict: sh -c \"rm -rf x\"" "match" "$(ms 'sh -c "rm -rf x"' "$DESTPAT")"
check "strict: bash -c 'npm uninstall y'" "match" "$(ms "bash -c 'npm uninstall y'" "$DESTPAT")"
# ...while R1/R2 keep the pinned §A3 bypass. Adding the wrapper there would do
# nothing anyway: they blank quotes first, so sh -c "npm run dev" -> sh -c "".
check "lenient: sh -c \"npm run dev\" still bypasses" "nomatch" "$(m 'sh -c "npm run dev"' "$DEVPAT")"
# A bare mention is still not an invocation even without quote-blanking: the
# match must sit at the start of a command position, and `echo` is not a wrapper.
check "strict: echo \"rm -rf x\" is not an invocation" "nomatch" "$(ms 'echo "rm -rf x"' "$DESTPAT")"
# ACCEPTED false positive, pinned. Dropping blank_quoted means a separator inside
# a quoted string opens a command position. Costs one keystroke on an `ask`.
check "strict: accepted false positive on quoted separator" "match" \
  "$(ms 'git commit -m "stop; rm -rf x"' "$DESTPAT")"

echo
echo "=== C4. destructive git commands (R7, D7) ==="
# git clean -fdx here removes data/ (9.0G), .env, .claude/plans/, certificates/
# and docs/handoffs/ — none of them recoverable from git. It was entirely
# ungated while `rm -rf` was gated.
gc() { invokes_real_git_clean "$1" && echo match || echo nomatch; }
check "git clean -fdx" "match" "$(gc 'git clean -fdx')"
check "git clean in a chain" "match" "$(gc 'cd . && git clean -fd')"
check "git clean -ndx is a dry run" "nomatch" "$(gc 'git clean -ndx')"
check "git clean --dry-run" "nomatch" "$(gc 'git clean --dry-run -x')"
# REGRESSION. The dry-run exemption used to grep the WHOLE command for any -n
# flag, so an unrelated `head -n`/`sort -n`/`grep -n` anywhere exempted a real
# destructive clean — and because the hook then exited, it suppressed the rm
# rules for that call too. Both review axes caught this independently.
check "unrelated -n does not exempt (trailing)" "match" "$(gc 'git clean -fdx && head -n 20 file')"
check "unrelated -n does not exempt (leading)"  "match" "$(gc 'grep -n foo x && git clean -fdx')"
check "unrelated -n does not exempt (pipe)"     "match" "$(gc 'git clean -fdx | sort -n')"
check "a real dry run in a chain is still exempt" "nomatch" "$(gc 'git clean -ndx && echo done')"
check "git reset --hard" "match" "$(ms 'git reset --hard origin/main' "$DESTPAT")"
check "git checkout -- ." "match" "$(ms 'git checkout -- .' "$DESTPAT")"
check "git restore ." "match" "$(ms 'git restore .' "$DESTPAT")"
# Switching branches is not destructive and must stay silent.
check "git checkout main (not gated)" "nomatch" "$(ms 'git checkout main' "$DESTPAT")"
check "git reset (soft) not gated" "nomatch" "$(ms 'git reset HEAD~1' "$DESTPAT")"

echo
echo "=== D. guard end-to-end (port 3000 occupied) ==="
# Occupy the port ourselves so the suite is self-contained. The guards only ask
# "is anything listening on 3000", so a bare netcat listener is a faithful
# stand-in for a real dev server and starts in milliseconds rather than seconds.
if [ -z "$(dev_port_pids)" ]; then
  nc -l 3000 >/dev/null 2>&1 &
  STARTED_LISTENER=$!
  for _ in $(seq 1 20); do [ -n "$(dev_port_pids)" ] && break; sleep 0.2; done
fi
echo "  (port 3000 holders: [$(dev_port_pids)])"
# A silent hook emits NO output at all (that is what "allow" looks like), so
# assert on raw output: empty = allowed, else parse the decision.
decision() { # decision <script> <command-json-string>
  local out
  out=$(printf '{"session_id":"sessAAA","tool_input":{"command":%s}}' "$2" | "$1")
  [ -z "$out" ] && { echo "allow"; return; }
  jq -r '.hookSpecificOutput.permissionDecision // "malformed"' <<<"$out"
}
check "real dev invocation while port busy -> deny" "deny" "$(decision $H/guard-dev-server.sh '"npm run dev"')"
check "quoted mention while port busy -> allow" "allow" "$(decision $H/guard-dev-server.sh '"echo \"npm run dev\""')"
check "unrelated command -> allow" "allow" "$(decision $H/guard-dev-server.sh '"git status"')"
check "build with no build running -> allow" "allow" "$(decision $H/guard-build.sh '"npm run build"')"
check "npm uninstall in && chain -> ask" "ask" "$(decision $H/guard-destructive.sh '"cd . && npm uninstall sqlite3"')"
check "quoted uninstall mention -> allow" "allow" "$(decision $H/guard-destructive.sh '"echo \"npm uninstall x\""')"

echo
echo "=== D2. R7.3 untracked-path rule (any rm naming a gitignored path) ==="
# `rm data/raid-tracker.db` needs no -r flag: it is a file. 9.0G, gitignored,
# backed up only by manual snapshots, and completely ungated by the flag rule.
# Resolved dynamically via `git check-ignore` rather than a hardcoded list — a
# hand-written list of "precious" paths was already missing docs/handoffs/,
# certificates/, scripts/cleanup/ and seeds.txt when it was first drafted.
check "rm of the live database -> ask" "ask" "$(decision $H/guard-destructive.sh '"rm data/raid-tracker.db"')"
check "rm -f of the WAL sidecar -> ask" "ask" "$(decision $H/guard-destructive.sh '"rm -f data/raid-tracker.db-wal"')"
check "rm .env -> ask" "ask" "$(decision $H/guard-destructive.sh '"rm .env"')"
# Tracked source is recoverable from git; deleting it must not prompt.
check "rm of a tracked source file -> allow" "allow" "$(decision $H/guard-destructive.sh '"rm src/lib/db/queries.ts"')"
check "rm outside the repo -> allow" "allow" "$(decision $H/guard-destructive.sh '"rm /tmp/scratch-file"')"
# A dry run destroys nothing; prompting on it is pure noise.
check "git clean -ndx (dry run) -> allow" "allow" "$(decision $H/guard-destructive.sh '"git clean -ndx"')"
check "git clean --dry-run -> allow" "allow" "$(decision $H/guard-destructive.sh '"git clean --dry-run -x"')"
check "git clean -fdx -> ask" "ask" "$(decision $H/guard-destructive.sh '"git clean -fdx"')"
# The exemption must never suppress the OTHER rules. It used to exit the whole
# hook, so an unrelated -n anywhere disabled the rm rules for that call.
check "unrelated -n does not un-gate the clean" "ask" \
  "$(decision $H/guard-destructive.sh '"git clean -fdx && head -n 20 file"')"
check "dry run does not suppress the rm rule" "ask" \
  "$(decision $H/guard-destructive.sh '"git clean -ndx && rm -rf data"')"
# The token scan must not glob-expand; -rf already gates this, so the assertion
# is really "the scan did not crash or hang on an unmatched glob".
check "rm -rf with a glob -> ask" "ask" "$(decision $H/guard-destructive.sh '"rm -rf /tmp/nonexistent-dir-*"')"

echo
echo "=== E. holders_younger_than(): the orphan decision, as a pure function ==="
# Replaces the whole session-start-snapshot mechanism. A port holder is this
# session's debris if it is YOUNGER than the session itself.
#
# Split out as a pure function on purpose: session_age() does the ancestry walk
# and nothing else, so the decision logic can be tested with synthetic ages and
# no sleeps. The fail-open case in particular CANNOT be staged end-to-end —
# every process a test spawns is a descendant of the real `claude`, so "no
# ancestor" is unreachable from inside a session.
sleep 300 & YOUNG=$!            # age 0
OLD=1                           # init, older than any session
check "young holder is session debris"  "$YOUNG" "$(holders_younger_than 500 "$YOUNG")"
check "old holder is pre-existing"      ""       "$(holders_younger_than 500 "$OLD")"
check "mixed: only the young one"       "$YOUNG" "$(holders_younger_than 500 "$OLD $YOUNG")"
# FAIL OPEN (R4.4). An unknown session age must mean silence, never "report
# everything" — that would hand the user a kill command aimed at their own
# server, the single outcome the no-kill design exists to prevent.
check "empty age -> report nothing"     ""       "$(holders_younger_than "" "$OLD $YOUNG")"
check "non-numeric age -> report nothing" ""     "$(holders_younger_than "wat" "$YOUNG")"
check "zero age -> report nothing"      ""       "$(holders_younger_than 0 "$YOUNG")"
check "dead pid is skipped"             ""       "$(holders_younger_than 500 "999999")"
kill "$YOUNG" 2>/dev/null

echo
echo "=== E2. session_age(): the ancestry walk ==="
# Cannot assert a VALUE — it depends on when this session started. What it can
# assert is that the walk finds a claude ancestor at all. This is the one guard
# against the mistake that nearly shipped: $PPID is a per-invocation `sh -c`
# wrapper with etimes=0, NOT the claude process. A fixed-depth lookup would have
# read 0, classified every holder as pre-existing, and silently gone dead.
AGE="$(session_age)"
check "finds a claude ancestor" "yes" "$([ -n "$AGE" ] && echo yes || echo no)"
check "age is numeric"          "yes" "$(case "$AGE" in ''|*[!0-9]*) echo no;; *) echo yes;; esac)"
check "age is plausible (>0s)"  "yes" "$([ "${AGE:-0}" -gt 0 ] && echo yes || echo no)"

echo
echo "=== E3. Stop hook end-to-end: reports once, then stays quiet (R4.3) ==="
# Stop fires once per TURN, not once per session, so an orphan must be reported
# exactly once. Uses a spare port so a real dev server on 3000 is untouched.
rm -rf "$D"
export DEV_PORT=3999
nc -l 3999 >/dev/null 2>&1 &
ORPHAN=$!
for _ in $(seq 1 20); do [ -n "$(dev_port_pids)" ] && break; sleep 0.2; done
first="$(printf '{"session_id":"sessSTOP"}' | $H/stop-orphan-check.sh)"
second="$(printf '{"session_id":"sessSTOP"}' | $H/stop-orphan-check.sh)"
check "first turn reports the orphan" "yes" \
  "$(jq -e --arg p "$ORPHAN" '.systemMessage | test($p)' <<<"$first" >/dev/null 2>&1 && echo yes || echo no)"
check "report names a kill command" "yes" \
  "$(jq -re '.systemMessage' <<<"$first" 2>/dev/null | grep -q 'kill ' && echo yes || echo no)"
check "second turn stays silent (no re-nag)" "" "$second"
check "warned file records the pid" "yes" \
  "$(grep -qw "$ORPHAN" "$D/warned-sessSTOP.txt" 2>/dev/null && echo yes || echo no)"
kill "$ORPHAN" 2>/dev/null
# A holder older than the session is the user's, and must never be reported.
check "no port holder -> silent" "" "$(printf '{"session_id":"sessNONE"}' | $H/stop-orphan-check.sh)"
export DEV_PORT=3000   # restore, do not unset: lib.sh resolved it at source time

echo
echo "=== F. sweep removes warned state older than 7 days ==="
# R6.2. SessionEnd is gone, so the age-based sweep is now the ONLY cleanup, and
# it runs from Stop — every turn, rather than only when a new session starts in
# this repo. That closes review finding P-4.
rm -rf "$D"; mkdir -p "$D"
touch "$D/warned-livesession.txt"
touch -d '10 days ago' "$D/warned-deadsession.txt"
printf '{"session_id":"sessSWEEP"}' | $H/stop-orphan-check.sh > /dev/null
check "stale state swept"      "0" "$(ls -1 "$D" | grep -c deadsession)"
check "live state kept"        "1" "$(ls -1 "$D" | grep -c livesession)"

echo
echo "=== G. missing session_id falls back, does not create 'warned-.txt' ==="
# R5.2. Degrade to a fixed name rather than a malformed one.
rm -rf "$D"
export DEV_PORT=3999
nc -l 3999 >/dev/null 2>&1 &
ORPHAN2=$!
for _ in $(seq 1 20); do [ -n "$(dev_port_pids)" ] && break; sleep 0.2; done
printf '{}' | $H/stop-orphan-check.sh > /dev/null
kill "$ORPHAN2" 2>/dev/null
export DEV_PORT=3000   # restore, do not unset: lib.sh resolved it at source time
ls "$D/warned-nosession.txt" >/dev/null 2>&1 && r=yes || r=no
check "fallback file created" "yes" "$r"
ls "$D/warned-.txt" >/dev/null 2>&1 && r=yes || r=no
check "no malformed empty-key file" "no" "$r"

echo
echo "=== G2. build guard detects a running build ==="
# The detection path had NEVER been executed: every prior assertion only checked
# "allow when nothing is running". Stands in for a real `next build` with a
# process whose cmdline matches the decisive pattern. The real cmdline is
# confirmed separately by running an actual build — see the spec.
FAKEBUILD="$D/fake/node_modules/.bin"
mkdir -p "$FAKEBUILD"
printf '#!/usr/bin/env bash\nsleep 30\n' > "$FAKEBUILD/next"
chmod +x "$FAKEBUILD/next"
"$FAKEBUILD/next" build & FAKEBUILD_PID=$!
for _ in $(seq 1 20); do [ -n "$(next_build_pids)" ] && break; sleep 0.2; done
check "build running -> next_build_pids finds it" "yes" \
  "$([ -n "$(next_build_pids)" ] && echo yes || echo no)"
check "build running -> second build denied" "deny" "$(decision $H/guard-build.sh '"npm run build"')"
check "build running -> mention still allowed" "allow" "$(decision $H/guard-build.sh '"echo \"npm run build\""')"
kill "$FAKEBUILD_PID" 2>/dev/null
wait "$FAKEBUILD_PID" 2>/dev/null

echo
echo "=== H. manual run with no stdin must not hang ==="
# No /dev/tty in this environment, so the [ -t 0 ] branch cannot be exercised
# directly. Closing stdin is the adjacent risk: cat must not block forever.
timeout 5 $H/guard-build.sh <&- >/dev/null 2>&1; rc=$?
[ $rc -ne 124 ] && r=ok || r=hung
check "closed stdin: no hang" "ok" "$r"
echo "  SKIP  real-tty branch (no /dev/tty available here)"

echo
echo "=== I. commit gate (guard-commit.sh) ==="
# The real checks take ~25s and depend on whatever the tree holds, so a stub
# runner records which checks would have run and fails the ones named in
# FAKE_FAIL. Under test is the gate's decision, not lint or vitest.
GATE_REPO="$(mktemp -d)"
git -C "$GATE_REPO" init -q
git -C "$GATE_REPO" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
export GATE_LOG="$GATE_REPO.log"
cat > "$GATE_REPO.runner" <<'RUNNER'
#!/usr/bin/env bash
echo "$1" >> "$GATE_LOG"
case ",${FAKE_FAIL:-}," in *",$1,"*) echo "stub: $1 failed"; exit 1 ;; esac
exit 0
RUNNER
chmod +x "$GATE_REPO.runner"
export COMMIT_GATE_RUNNER="$GATE_REPO.runner"
gate() { # gate <command> -> allow | deny; the checks it ran are in $GATE_LOG
  : > "$GATE_LOG"
  local out
  out=$(jq -nc --arg c "$1" --arg d "$GATE_REPO" \
    '{session_id:"sessGATE",cwd:$d,tool_input:{command:$c}}' | $H/guard-commit.sh)
  [ -z "$out" ] && { echo allow; return; }
  jq -r '.hookSpecificOutput.permissionDecision // "malformed"' <<<"$out"
}
ran() { paste -sd, "$GATE_LOG"; }
ALL='lint,tsc (app),tsc (scripts),vitest'

echo x > "$GATE_REPO/a.ts"
check "not a commit -> allow" "allow" "$(gate 'git status')"
check "not a commit -> nothing runs" "" "$(ran)"
check "quoted mention -> allow" "allow" "$(gate 'echo "git commit"')"
check "quoted mention -> nothing runs" "" "$(ran)"
check "green commit -> allow" "allow" "$(gate 'git commit -m "WIP #1: x"')"
check "green commit -> all four checks" "$ALL" "$(ran)"
gate 'git add a.ts && git commit -m x' >/dev/null
check "add && commit -> all four checks" "$ALL" "$(ran)"
gate 'git -C . commit -m x' >/dev/null
check "git -C <dir> commit -> all four checks" "$ALL" "$(ran)"
gate 'git commit --amend --no-edit' >/dev/null
check "--amend -> all four checks" "$ALL" "$(ran)"
check "heredoc message -> gated" "allow" "$(gate "git commit -F - <<'EOF'
WIP #1: x
EOF")"

export FAKE_FAIL=vitest
check "vitest red -> deny" "deny" "$(gate 'git commit -m "WIP #1: x"')"
out=$(jq -nc --arg c 'git commit -m x' --arg d "$GATE_REPO" '{cwd:$d,tool_input:{command:$c}}' | $H/guard-commit.sh)
check "deny names the red check" "yes" \
  "$(jq -r '.hookSpecificOutput.permissionDecisionReason' <<<"$out" | grep -q 'vitest is red' && echo yes || echo no)"
check "red-first commit -> allow" "allow" "$(gate 'git commit -m "WIP #1: red — size specs"')"
check "red-first commit -> vitest skipped" "lint,tsc (app),tsc (scripts)" "$(ran)"
check "red marker with a hyphen -> allow" "allow" "$(gate 'git commit -m "WIP #1: red - size specs"')"
check "'red' elsewhere in the message is no marker" "deny" "$(gate 'git commit -m "WIP #1: the red border"')"
export FAKE_FAIL="tsc (app)"
check "red-first commit, tsc red -> deny" "deny" "$(gate 'git commit -m "WIP #1: red — size specs"')"
check "the first red check stops the run" "lint,tsc (app)" "$(ran)"
unset FAKE_FAIL

COMMIT_GATE_RUNNER=/nonexistent/runner
check "a check that crashes -> deny (fails closed)" "deny" "$(gate 'git commit -m x')"
export COMMIT_GATE_RUNNER="$GATE_REPO.runner"

rm "$GATE_REPO/a.ts"; echo notes > "$GATE_REPO/notes.md"
check ".md-only tree -> allow" "allow" "$(gate 'git commit -m "WIP #1: progress tick"')"
check ".md-only tree -> nothing runs" "" "$(ran)"
echo x > "$GATE_REPO/b.ts"
gate 'git add notes.md && git commit -m x' >/dev/null
check ".md staged but code changed elsewhere -> all four" "$ALL" "$(ran)"
rm "$GATE_REPO/b.ts" "$GATE_REPO/notes.md"
check "nothing changed (message-only amend) -> allow" "allow" "$(gate 'git commit --amend -m y')"
check "nothing changed -> nothing runs" "" "$(ran)"
unset COMMIT_GATE_RUNNER GATE_LOG
rm -rf "$GATE_REPO" "$GATE_REPO.log" "$GATE_REPO.runner"

echo
echo "=== J. ship-ticket state check (stop-ship-state.sh, report.sh) ==="
# A throwaway repo on a feat/999-* branch, with a state file the cases rewrite.
SHIP_REPO="$(mktemp -d)"
sg() { git -C "$SHIP_REPO" -c user.name=t -c user.email=t@t "$@"; }
sg init -q
sg symbolic-ref HEAD refs/heads/main   # this git predates init -b
echo 'docs/handoffs/' > "$SHIP_REPO/.gitignore"
sg add .gitignore && sg commit -q -m base
BASE=$(sg rev-parse HEAD)
sg switch -q -c feat/999-test
echo a > "$SHIP_REPO/a.ts" && sg add a.ts && sg commit -q -m "WIP #999: a"
C1=$(sg rev-parse HEAD)
sg switch -q -c elsewhere main
echo b > "$SHIP_REPO/b.ts" && sg add b.ts && sg commit -q -m "elsewhere"
OFF=$(sg rev-parse HEAD)
sg switch -q feat/999-test
mkdir -p "$SHIP_REPO/docs/handoffs"
STATE_FILE="$SHIP_REPO/docs/handoffs/999-state.json"
state() { # state <pass_status> <commit-sha>
  jq -n --arg b "$BASE" --arg c "$2" --arg s "$1" '{schema:1,ticket:999,title:"t",
    branch:"feat/999-test",base:{ref:"main",sha:$b},models:{implementer:"inherit"},
    pass:"implement",pass_status:$s,head:$c,
    passes:{implement:{status:$s,commits:[$c]}},checks:{},findings:[],out_of_scope:[]}' > "$STATE_FILE"
}
stop() { # stop [stop_hook_active] -> the hook's raw output
  jq -nc --arg d "$SHIP_REPO" --argjson a "${1:-false}" \
    '{session_id:"sessSHIP",cwd:$d,stop_hook_active:$a}' | $H/stop-ship-state.sh
}
verdict() { # verdict <raw-output> -> silent | block | message
  [ -z "$1" ] && { echo silent; return; }
  jq -r 'if .decision == "block" then "block" elif .systemMessage then "message" else "malformed" end' <<<"$1"
}

state committed "$C1"
check "consistent, committed, clean -> silent" "silent" "$(verdict "$(stop)")"
check "report.sh: consistent -> exit 0" "0" "$(cd "$SHIP_REPO" && $H/../skills/ship-ticket/report.sh 999 >/dev/null; echo $?)"
check "report.sh: says State OK" "yes" \
  "$(cd "$SHIP_REPO" && $H/../skills/ship-ticket/report.sh 999 | grep -q '^State OK' && echo yes || echo no)"

state committed 0123456789012345678901234567890123456789
check "missing SHA -> block" "block" "$(verdict "$(stop)")"
check "missing SHA, second stop -> message, not a loop" "message" "$(verdict "$(stop true)")"
check "report.sh: missing SHA -> exit 3" "3" "$(cd "$SHIP_REPO" && $H/../skills/ship-ticket/report.sh 999 >/dev/null; echo $?)"

state committed "$OFF"
check "SHA outside HEAD's history -> block" "block" "$(verdict "$(stop)")"

state committed "$C1"
echo dirty > "$SHIP_REPO/c.ts"
check "committed but tree dirty -> block" "block" "$(verdict "$(stop)")"
state in_progress "$C1"
check "in progress and tree dirty -> silent" "silent" "$(verdict "$(stop)")"
rm "$SHIP_REPO/c.ts"

echo '{not json' > "$STATE_FILE"
check "unreadable state file -> block" "block" "$(verdict "$(stop)")"

sg switch -q main
check "not a feat/NNN-* branch -> silent" "silent" "$(verdict "$(stop)")"
sg switch -q feat/999-test
rm "$STATE_FILE"
check "feat branch, no state file -> silent" "silent" "$(verdict "$(stop)")"
rm -rf "$SHIP_REPO"

echo
echo "================================"
echo "PASS: $pass   FAIL: $fail"
[ "$fail" -eq 0 ] || exit 1
