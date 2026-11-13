# Codebase scan: lens prompts (2026-11-13)

One lens per session, run one at a time. Each session = **shared preamble + one lens prompt**.
Findings files go in this folder (`docs/26-11-13-scan/`). Suggested order: 3, 1, 2, 4, 7, 5, 6.

Open-issue snapshot taken 2026-11-13 from `agrorithms/destiny-public` (`gh issue list --state open`). Re-run it if the scan is started later.

---

## Shared preamble (paste first in every session)

```
This is a read-only audit of one lens. Do not edit code, create branches, commit, or run mutating commands. The only file you may write is your findings file (path given below); I authorize that one write.

Before looking at code, read CLAUDE.md, CONTEXT.md, and every ADR in docs/adr/ plus docs/decisions.md. Treat decided things as decided: if a finding contradicts an ADR, say which one and whether you'd amend it; if it hardens one, say so. Don't re-propose what an ADR already settled.

Already-recognized issues: the lens prompt lists open GitHub issues relevant to it. Read each with `gh issue view <n> --comments` before auditing. Do NOT re-report them as new findings. For each one, say in a "Known issues" section whether your evidence confirms it, shows it is worse/broader than filed, or shows it is already fixed or stale. A genuinely new finding that overlaps an issue should cite the issue number. You may also run `gh issue list --state open` yourself and search for anything the list missed.

Known ADR discrepancies already filed (don't rediscover, but do check for siblings of the same kind):
- #248 ADR 0006: two passages still describe the pre-#204 client-side toggle
- #247 ADR 0004: active-sessions maintenance stubs vs the rule (and the "Two specs use it" count is wrong, it's three)
- #207 crawler cleanup max-age default is 48 in start-crawler.ts vs 720 in crawler/index.ts (ADR 0009 related)
- #151 docs/e2e-coverage.md and CLAUDE.md's e2e flow list drift

Never read or grep .env. Don't kill or collide with running servers (hooks will tell you); use `ss`/`fuser` for ports, not lsof.

Evidence rules: every finding needs file:line and the command/query/output that supports it. Run the check and show raw output rather than asserting. If something is a hypothesis, label it and name the command that would confirm or kill it. Prefer 10 verified findings over 40 plausible ones. Explicitly list what you checked and found fine, so I can see coverage.

Findings file format, ranked most severe first. For each: ID, title, severity (high/med/low), effort (S/M/L), evidence, why it matters in THIS app (prod: Oracle A1 ARM, 2 OCPU/12GB, PM2 cluster x2, 5.5 GB SQLite, ~5 visitors/day, behind Cloudflare), suggested fix in 2-3 lines, ADR impact. End with "Known issues (status)", "Checked, no issue" and "Couldn't verify, and what I'd need".

Be calibrated to scale: ~5 visitors/day means don't recommend infrastructure for traffic that doesn't exist.
```

---

## 1. Security
**Findings file:** `docs/26-11-13-scan/01-security.md`
**Skills:** skip `/security-review`; it reviews only the pending diff, not the whole tree. The prompt below does the same job over everything.
**Known open issues:** #66 (client-write POSTs rate-limited under the players-read bucket), #173 (e2e: Next server fetches external icons through the image optimizer; check the production `images` config too), #217 (commit gate skips checks when files are edited in the same Bash command as `git commit`; a process weakness, note only).

```
Lens: security. Audit the whole repo.

Known issues to read first: #66, #173, #217 (see preamble rules).

Focus areas:
1. Client-write endpoints (active-session-update, players/identity, queue-crawl) and src/lib/http/request-auth.ts: the same-origin check, the optional HMAC page-token layer (what's the real exposure when PAGE_TOKEN_SECRET is unset?), replay, header spoofing behind Cloudflare/tunnel (which headers can a client forge?), and whether these endpoints can be abused to burn Bungie API quota or fill the DB. #66 is already filed on the rate-limit bucket; look beyond it.
2. Input handling on every API route and server component: query params (difficulty, range, raids, board, etc.), SQL built by string concatenation anywhere in src/lib/db/queries.ts and src/lib/db/archive/queries.ts, ReDoS, unbounded limits/pagination, and resource-exhaustion via expensive queries on the 5.5 GB DB.
3. Admin stats basic auth: timing-safe comparison, brute-force exposure, whether it leaks on error paths.
4. Secrets: NEXT_PUBLIC_* exposure (only the public Bungie key should be there), keys logged or returned in errors, scripts that print config. Don't open .env.
5. Dependencies: `npm audit`, and a quick look at anything unmaintained or install-script-heavy.
6. Output encoding: Name#Code and other Bungie-sourced strings rendered into HTML, OG images, metadata, and tooltips. Any dangerouslySetInnerHTML.
7. Response headers: CSP, CORS, caching of anything user-specific (note the Cloudflare cache-rule caveat in CLAUDE.md).

Findings file: docs/26-11-13-scan/01-security.md
```

---

## 2. Query and database performance
**Findings file:** `docs/26-11-13-scan/02-db-performance.md`
**Skills:** none. Use `/verify` only if you want it to launch the app and time real requests.
**Known open issues:** #189 (difficulty-filtered leaderboard queries scan every raid; Epic computes one board twice), #206 (drop redundant `idx_pgcrs_ended`), #227 (widen the `pgcrs.ended_at` index with scope flags; ready-for-agent), #238 (30d raid stats under All Attempts / Fresh Runs: denormalised KDA index vs worker thread), #242 (keep the 30-day Raid Activity value warm), #245 (Raid Stats tab prefetch), #53 (leaderboard cache warming for filtered combos), #47 (daily rollup table), #136 (leaderboard SQL lives in the cache layer, outside queries.ts), #124 (/gos10k overview runs a discarded helper count), #125 (/gos10k one bucketed read for three chart surfaces), #139 (leaderboard 60s refresh serves the previous tick's data).

```
Lens: SQLite query and database performance. Audit src/lib/db/queries.ts and src/lib/db/archive/queries.ts and everything that opens a connection.

Known issues to read first: #189, #206, #227, #238, #242, #245, #53, #47, #136, #124, #125, #139. Many of these are already scoped; your job is to confirm with plan output, size them, and find what they missed.

Method: for each query behind a page or API route (leaderboards, fastest clears, active sessions, /activity, /gos10k boards), run EXPLAIN QUERY PLAN against a COPY of the DB (never the live data/raid-tracker.db; if only the live file exists, open it readonly and say so). Show the plan output. Flag full scans, temp b-trees for ORDER BY/GROUP BY, missing or unused indexes, and queries that scale with total history instead of the window they display.

Also check: pragmas (WAL, synchronous, cache_size, mmap_size, busy_timeout), connection lifetime under PM2 cluster x2, N+1 patterns in server components, work repeated per request that could be cached (and how that interacts with the Cloudflare cache caveat), write-lock hold times in the crawler/scanner (see CRAWLER_CLEANUP_BATCH_SIZE reasoning), and index bloat or missing indexes on the biggest tables (report row counts and sizes).

Rank by (cost per request x how often it runs). Suggest index DDL where relevant, with the write-amplification cost on the crawler's inserts.

Findings file: docs/26-11-13-scan/02-db-performance.md
```

---

## 3. Concurrency and resilience
**Findings file:** `docs/26-11-13-scan/03-resilience.md`
**Skills:** none. ADR 0005 and ADR 0001 are the context.
**Known open issues:** #174 (discovery's scanner-position jump can leave a permanently unscanned gap), #178 (watch: retry pass may fire rarely), #235 (scanner restart forgets every Missed Id), #236 (scanner totalRaidsFound undercounts), #207 (crawler cleanup max-age default mismatch 48 vs 720), #177 (e2e:maintenance doesn't point PGCR requests at its mock Bungie), #154 (active-sessions overlapping fetches can overwrite newer data).

```
Lens: concurrency and failure modes of the background processes: crawler, scanner, discovery, the active-session poll loop, rate limiter, key pool, and PM2 config (ecosystem.config.js).

Known issues to read first: #174, #178, #235, #236, #207, #177, #154. #174, #235 and #207 are the most likely to matter in prod; check whether they are worse than filed.

Read ADR 0005 first; the four guards there must not be weakened. Hunt for the next stall of the same class: any await on the network or the DB without a timeout or watchdog, any reschedule not in a finally, any heartbeat that can stay green while work is parked, any place a timeout is conflated with "offline"/"not found" and causes deletion or a skipped range.

Also check: SQLITE_BUSY behaviour across processes (busy_timeout blocks the event loop; who holds long write locks?), scanner position/Id Hole logic and retry pass edge cases (Missed Ids), crash/restart idempotency (what happens if a process dies mid-transaction or mid-batch?), unbounded in-memory queues or maps, memory growth over days, backoff behaviour under Bungie outages and 1672 throttles, key-pool rotation edge cases, graceful shutdown, and the logging you'd actually need at 3am to diagnose a stall.

For each finding, describe the concrete sequence of events that triggers it. Where practical, confirm with a small read-only script or a reading of the existing mock-Bungie e2e:maintenance setup. Don't run it without telling me.

Findings file: docs/26-11-13-scan/03-resilience.md
```

---

## 4. Correctness and data integrity
**Findings file:** `docs/26-11-13-scan/04-correctness.md`
**Skills:** `/domain-modeling` only if you want it to also propose CONTEXT.md term fixes. Otherwise skip.
**Known open issues:** #201 (StatsBar "N fireteams raiding now" reads ~25x below Raids in Progress; ADR 0002 related), #225 (per-raid estimates biased for days after weekly reset), #222 (no-estimate note can name the wrong cause), #165 (member not in players table can show without #Code), #163 (raid filter hides unlisted/null-key raids when any filter is set), #74 (RaidMultiSelect "All Raids" means two things), #185 (maintenance snapshot ignores every filter), #135 (Fastest Clears serves cached board during maintenance), #131 (implausibly fast Clear Times), #184 (rename difficulty_tier to feats_tier), #110 (/gos10k unfurl prose asserts stale numbers), #188 / #187 (leaderboard Difficulty filter lists/empty states), #153 (tile view status dot).

```
Lens: logical correctness of what the app computes and stores.

Known issues to read first: #201, #225, #222, #165, #163, #74, #185, #135, #131, #184, #110. #201 is a number that is visibly wrong on every page; confirm the cause with data.

Targets: the four "Full Clear" definitions (Tracker FULL_CLEAR/COMPLETION; Archive predicates in src/lib/db/archive/predicates.ts), derive-clear-number.ts and ADR 0008, Difficulty tagging via activity_hash in RAID_DEFINITIONS (manifest.ts) vs how every filter reads it, leaderboard ranking/ties/Clear Time, the Activity page's Provisional estimate maths and the 15-minute shade, active-session dedupe by fireteam (membership_id keyed rows -> fireteams), the Name#Code identity rule everywhere it's stored or displayed (look for any path that truncates or recomputes it), timezone/UTC handling, off-by-one at range edges (24h/7d/30d), and integer/float rounding in medians and percentages.

Method: for each computation, read the SQL/TS, state the intended rule from CONTEXT.md, then run a read-only query against a DB copy that would expose a discrepancy (duplicates, orphans, nulls, impossible values, clears counted twice, runs attributed to the wrong raid or Difficulty). Show the output. Only report discrepancies you've demonstrated with data or a concrete input.

Findings file: docs/26-11-13-scan/04-correctness.md
```

---

## 5. UI, accessibility and phone width
**Findings file:** `docs/26-11-13-scan/05-ui.md`
**Skills:** project `/verify` (read it before launching anything). `npm run visual:check` is the main tool. `/browse` is optional for poking at interactions the screenshots don't show.
**Known open issues:** #58 (accessibility audit, investigation idea; this lens is effectively that), #168 (list rows lose keyboard focus when Roster changes), #218 (second refused sixth raid not re-announced to screen readers), #169 (Tailwind gray borders instead of input-border token), #164 / #138 (View toggle highlights wrong option after reload / hydration mismatch), #139 / #140 (leaderboard refresh and movement baseline), #153 (tile view status dot), #210 / #219 (Raid Activity phone label and axis cleanups), #243 (small multiples to show every raid), #162 (raid option list duplicated in three pages), #29 (remaining e2e coverage: error states, maintenance, accessibility).

```
Lens: UI, accessibility, and responsive behaviour. Read .claude/skills/verify/SKILL.md and docs/e2e-coverage.md first; note the UI rules in CLAUDE.md/memory: warm carbon-terracotta theme tokens (ui-list-item-hover, --ui-accent), no Tailwind blue/gray, row names not bold.

Known issues to read first: #58, #168, #218, #169, #164, #138, #139, #140, #153, #210, #219, #243, #162, #29.

Run `npm run visual:check` (check first that no dev server or build is running, and report rather than collide). Review the screenshots at 360/768/1280 x light/dark for every route, including /gos10k, /activity, /active-sessions (list and tile views), and the leaderboard tabs. Then audit the code for: keyboard operability and focus order, visible focus states, ARIA on custom controls (chips, toggles, tabs, tooltips, expandable rows, collapsible sections), colour contrast in both themes (compute ratios for the actual token values), tap target sizes, chart accessibility without a mouse, reduced-motion, JS-off behaviour, empty/error/loading states, and any token or theme violations.

Cross-reference docs/e2e-coverage.md: list the interactions that have NO browser coverage and rank them by how likely they are to be broken.

Findings file: docs/26-11-13-scan/05-ui.md
```

---

## 6. Test gaps
**Findings file:** `docs/26-11-13-scan/06-test-gaps.md`
**Skills:** none. Read `tests/README.md` first, since the prompt requires it.
**Known open issues:** #30 (Vitest gaps for active-session, player, query, dedupe), #166 (unit tests for dedupeActiveSessions), #181 (mutation gaps in #172's active-session logic: roster.ts survivors, dedupe.ts no coverage), #29 (remaining e2e coverage), #25 (@live Bungie contract tests), #27 (full Sentry suppression in e2e), #28 (guard port 3100 against orphaned e2e servers), #171 (e2e specs share one rate-limit bucket), #173 (e2e hits real internet for icons), #177 (e2e:maintenance PGCR requests), #180 (seed wide Bungie Names into e2e), #224 (e2e not.toHaveText reads the wrong line), #211 (mutate:diff --incremental counts stale results), #145 (assert the e2e seed-fixture invariant), #247 (maintenance stubs vs ADR 0004), #151 (e2e-coverage doc rewrite).

```
Lens: where the tests would NOT catch a real break. Read tests/README.md and ADRs 0003/0004 first.

Known issues to read first: #30, #166, #181, #29, #25, #27, #28, #171, #173, #177, #180, #224, #211, #145, #247, #151. A lot of the test-side backlog is already filed; focus on gaps that aren't.

Method: (1) Map src/ modules to tests: which logic-bearing .ts files have no or thin tests? (2) Run `npm run mutate:diff` against a wide range (e.g. the root commit...HEAD, or per-directory if it's too slow; tell me the cost before running) and report survivors and no-coverage mutants grouped by module. Do not add Stryker disable comments; those are my decision. (3) Look for tests that assert implementation detail (call counts, exact wording), tests that could never fail, over-mocking beyond `fetch`, and flaky-by-construction patterns (time, ordering, shared state). (4) List behaviours with prod incident history (ADRs 0001/0005, Id Hole, retry pass) and say whether a test would go red if each were reintroduced.

For each gap, say what test to write in one line, and whether it belongs in Vitest or Playwright.

Findings file: docs/26-11-13-scan/06-test-gaps.md
```

---

## 7. Architecture and codebase health
**Findings file:** `docs/26-11-13-scan/07-architecture.md`
**Skills:** `/improve-codebase-architecture` if it's installed (it wasn't in the session's skill list, so check first), and `/codebase-design` for the vocabulary. If neither is available, the prompt below works on its own.
**Known open issues (ADR/doc discrepancies):** #248, #247, #207, #151. **Cleanup and duplication backlog:** #209 (shared URL-choice link strip and searchParams parser), #167 (one player-page link builder instead of five), #162 (raid option list duplicated), #136 (leaderboard SQL outside queries.ts), #141 with #143-#150 (leaderboard cleanups series), #215, #213, #221, #219, #223, #241, #246, #239 (simplify-pass cleanups), #125 / #124 (/gos10k reads), #184 (rename difficulty_tier), #208 (agent worktrees vs lint and CLAUDE.md), #217 (commit gate bypass).

```
Lens: architecture and maintainability, in the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality). Invoke /improve-codebase-architecture if available; otherwise use /codebase-design's vocabulary directly.

Known issues to read first: the ADR/doc discrepancies #248, #247, #207, #151, then the cleanup backlog #209, #167, #162, #136, #141 and its children #143-#150, #215, #213, #221, #219, #223, #241, #246, #239, #125, #124, #184, #208, #217. Much of the shallow-module and duplication work is already filed. Your value is the cross-cutting view: which of these share a root cause, which should be done together, and what is missing.

Targets: queries.ts at ~1,700 lines (what's the natural split that doesn't break the "one query module per database" rule or make the connection ambiguous?), duplicated logic between Tracker and Archive code, shallow modules and pass-through layers, scripts/ vs src/ boundaries, components whose props mirror their internals, dead code and unused exports (verify with tooling, not by eye), CONTEXT.md terms the code doesn't use or code concepts CONTEXT.md lacks, and doc drift (CLAUDE.md claims vs reality; e.g. check the e2e flow list and env var docs). Also look for further ADR-vs-code discrepancies of the kind #247 and #248 describe, across all nine ADRs.

Respect ADRs: propose amendments, not new ADRs, and say up front whether each proposal contradicts or hardens each relevant one. Only propose deepenings with a clear payoff: testability, locality, or fewer places to change per feature. Skip taste-only refactors.

Findings file: docs/26-11-13-scan/07-architecture.md
```

---

## Triage afterwards

When the findings files exist, triage in `/grill-with-docs`, then `/to-spec` and `/to-tickets` for the big ones, and run tickets through `/ship-ticket` with a cheaper `implementer=` model. Findings that match an existing issue should become a comment on it, not a new issue.
