# Plan: leaderboard follow-ups #135–#141

Written 2026-10-07. Planning only; nothing implemented. Issues are in `agrorithms/destiny-public`.
All seven came out of the Fastest Clears work (#130, #132–#134, branch `feat/time-leaderboard`).

## The issues

| # | Summary | Predates the branch? | Files |
|---|---------|----------------------|-------|
| 135 | Fastest Clears serves a cached board during maintenance instead of the "unavailable" message | No | `src/app/api/leaderboard/route.ts`, `src/lib/cache/swr-cache.ts` |
| 136 | Leaderboard SQL lives in the cache layer, outside `queries.ts` | Yes (Full Clears runner) | `src/lib/cache/leaderboard-cache.ts`, `src/lib/db/queries.ts`, CLAUDE.md |
| 137 | `docs/handoffs/` is gitignored but 17 tracked files point at the e2e coverage handoff | Yes | `.gitignore`, 17 referencing files |
| 138 | View toggle shows Per Raid after a hard load with Total Clears stored (hydration mismatch) | Yes | `src/hooks/useLeaderboardPrefs.ts` |
| 139 | 60s refresh shows the previous tick's data (browser stale-while-revalidate) | Yes | `src/lib/http/cache.ts`, `src/app/leaderboard/page.tsx` |
| 140 | Movement baseline survives a filter changed and changed back before the response lands | Yes (Full Clears) | `src/app/leaderboard/page.tsx` |
| 141 | Cleanups carried over from #132–#134 (server, client, e2e seed). **Parent issue, split into #143–#150 below** | No | `leaderboard-cache.ts`, `page.tsx`, `LeaderboardTable.tsx`, `e2e/support/seed-world.ts` |

### #141 sub-issues (created 2026-10-08)

Each is a native GitHub sub-issue of #141 with native blocked-by edges. All labelled `needs-triage`.

| # | Scope | Blocked by | Hand check? |
|---|-------|------------|-------------|
| 143 | Server: runner cleanups (shared rank loop, rename `fastestFirst`) | #136 | No |
| 144 | Server: `getFastestResponse` cleanups (`board()`, the `shape` bag) | #143 (soft ordering edge; not strictly needed) | No |
| 145 | E2E: assert the seed-fixture `clearTimes` invariant | none | No |
| 146 | Client: naming and type tidy-ups (`FullClearsRow`, `boardData`, named `annotateMovement` constraint) | #140 | Yes (touches `annotateMovement`) |
| 147 | Client: table entry union keyed on `metric`, narrow `ClearTimeLink` | #140, #146 | No (type-level) |
| 148 | Server always sends `board: 'fullClears'`; plain discriminant replaces `'board' in` | #135, #140, #147 | No, but check cached and maintenance bodies |
| 149 | Per-board descriptor, data half (copy, labels, widths, request params) | #146, #147, #148 | No |
| 150 | Per-board descriptor, render and movement half | #149 | **Yes** (riskiest) |

The "same Clear Time doesn't flash" note is not an issue: it is recorded in `docs/decisions.md`
(2026-10-08).

## Dependencies

- **#136 → #143.** Both touch `runLeaderboardRows` / `runFastestClearRows`. Move the runners first, then extract the shared ranking loop and rename `fastestFirst`. If #136 resolves by amending CLAUDE.md instead, the order stops mattering. #144 follows #143 so the file settles once.
- **#139 → #140.** #139's one-refresh lag would blur the hand check for #140 (a stale baseline looks like a stale response). Fix or rule out #139 first.
- **#140 → #146, #147, #148 (client items).** Both rework `annotateMovement`. Do the behaviour fix first. Then the chain is #146 → #147 → #148 → #149 → #150. #146 and #150 need the movement hand check.
- **#135 → #148 (`route.ts`).** #135 changes the `board=fastest` branch; #148's "always send `board: 'fullClears'`" edits the same route, including the maintenance snapshot spread.
- **#145** has no dependencies.
- **#137 and #138** are independent of everything else. #138 touches only `useLeaderboardPrefs.ts` (and at most a line in `page.tsx`).

## Branching

- #135 and #141 only make sense once `feat/time-leaderboard` merges: they concern Fastest Clears code not on `main`.
- #136, #137, #138, #139 predate the branch and could go on their own branches off `main`.
- #140 sits between: the Full Clears fix could go on `main`, but Fastest Clears should be covered too.

## Order

1. **Merge `feat/time-leaderboard`.**
2. **#137.** Quick and independent. Preferred fix: move the file to `docs/e2e-coverage.md` and update the 17 references, rather than folding it into `tests/README.md`.
3. **#135.** Resolve the open question below, then a small change in `route.ts`.
4. **#138.** Read storage in an effect after mount. Also stops the write-back on the Fastest tab.
5. **#136.** Resolve the open question below. Moving the runners unblocks #141.
6. **#139.** Run the prod `curl` first (CLAUDE.md requires checking before touching `cache.ts`), then choose origin vs client fix. Closes the outstanding "double fetch" item in `docs/decisions.md`. Do not switch the route to `withNoStore`.
7. **#140.** After #139. Reset the baseline in an effect keyed on the whole filter combo, so the `[board]` effect folds into it.
8. **#141 server half: #143, then #144.** Right after #136.
9. **#141 client half: #146 → #147 → #148 → #149 → #150.** Last, after #140 (and #135 for #148). #150 is the riskiest and needs the movement hand check; #146 also needs it.
10. **#145** (e2e seed-fixture assertion) can go anywhere.

Steps 3–5 can run in parallel on separate branches. Steps 6–7 are sequential, and the #141 sub-issues follow their own chain above.

## Open questions

1. **#135: enforce the message or amend the story?** Check maintenance state before consulting the cache for `board=fastest` and answer with the flagged empty body (recommended: it matches #132's acceptance criteria and #130 story 30), or accept cached boards and amend story 30.
2. **#136: move the runners or document an exception?** Move both runners into `queries.ts` with the cache module calling them (recommended: unblocks #141), or amend the CLAUDE.md rule to name the leaderboard cache module as an exception, with the reason.
3. **#137: track the file or fold it in?** Move to `docs/e2e-coverage.md` and update 17 references (recommended), or fold the coverage list into `tests/README.md` / CLAUDE.md and drop the pointers.
4. **#139: origin fix or client fix?** Depends on what prod actually returns. Sub-questions:
   - Origin: drop stale-while-revalidate globally from `cacheControl()`, or add a second helper (or third argument) for polled routes only? Fixing `/api/leaderboard` together with `/api/live-stats` and `/api/active-sessions` would resolve the outstanding item in `decisions.md`.
   - Client: `cache: 'no-store'` or `'no-cache'`? Does the browser add request `Cache-Control`/`Pragma` headers in that mode, and does the Cloudflare rule honour them? Needed before relying on edge caching to keep absorbing the polls.
   - Unverified: does a fresh page load inside the stale window render a copy up to `<stale>` seconds old, and does that copy become the movement baseline?
5. **#141: which cleanups are worth doing?** Every item is optional, and each now has its own sub-issue (#143–#150), so they can be dropped one at a time. The per-board descriptor is the largest change and is split into #149 (data) and #150 (render and movement).
6. ~~**#141 minor note: record or change?**~~ **Resolved 2026-10-08:** intended behaviour, recorded in `docs/decisions.md` (2026-10-08). No issue.

## Verification

- Live movement has no automated coverage (decision recorded in #134). #140, #146 and #150 (any change touching `annotateMovement` or the descriptor's movement value) need the hand check from the `verify` skill on a scratch Tracker copy.
- #135's maintenance path has no e2e coverage (see #29). Check by hand via `dbQuiesceActive` in `data/maintenance-state.json`.
- #139 prod check: `curl -sI "https://destinyfarmfinder.qzz.io/api/leaderboard?hours=168&fullClearsOnly=true&mode=individual&limit=6" | grep -iE "cache-control|cf-cache-status|age"`, then watch two consecutive polls in devtools for a disk-cache hit followed by a background revalidation.
- After any multi-file change: `npm run lint`, `npm run build`, `npm test`, and `npm run e2e` where the browser suite applies.
