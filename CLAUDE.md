# Destiny Farm Finder

Real-time Destiny 2 raid completion tracker. SQLite database fed by background crawlers against the Bungie API; Next.js app reads from the DB and serves live leaderboards + active fireteam sessions.

**Two databases, and the distinction qualifies nearly every rule below.** The **Tracker** is the
live system — `data/raid-tracker.db`, the crawlers, the leaderboards, the active sessions — and is
what an unqualified rule here means. An **Archive** is a frozen, complete, read-only historical
dataset served alongside it and never joined to it; the **GoS 10k** (`data/gos-10k.db`,
`src/lib/db/archive/`) is the first. See `CONTEXT.md` and
[ADR 0007](docs/adr/0007-the-archive-is-a-second-read-only-database.md).

## Note

- NEVER overwrite files in ~/.claude/plans/ 

## Workflow

**Discussion is the default; implementation is opt-in.**

When I ask a question — anything phrased as "why", "how does", "explain", "what are the options", "is this a concern", "should we", "validate this note" — answer it and stop. Do not write files, create a plan, edit code, or run mutating commands. Read-only investigation to ground the answer is expected and welcome.

Implementation starts only when I say so explicitly: "implement it", "go ahead", "execute the plan". Absent those words, assume we are still talking. If you think you have enough to start building, say so and wait rather than starting.

**Before proposing a root cause, gather evidence first.**

State your top 2–3 hypotheses and, for each, the specific command, query, log, or header that would confirm or kill it. Run those checks and show the raw output before recommending a fix. If I contradict a hypothesis with data, drop it — do not refine it into a new version of the same theory. My most recent change is not a privileged suspect: rule out the alternatives before blaming it.

**Checkpoint long builds.**

For anything touching more than ~8 files, write a progress file listing each file with a checkbox, update it as you go, and make a WIP commit per logical chunk. I review diffs before they land, and one 20-file blob is not reviewable. Do not commit unless the change is on a branch.

**Verification.**

The `verify` skill (`.claude/skills/verify/SKILL.md`) is the build/launch/drive recipe — read it before verifying anything by hand. After a multi-file change run `npm run lint`, then `npm run build`, then `npm test`, and report the real output. Never report a change as working without it.

Chromium **is** installed (Playwright). If a change affects client-side request sequencing or rendering, `npm run e2e` can actually verify it — but only for the flows listed under **Current browser coverage** at the top of [`docs/e2e-coverage.md`](docs/e2e-coverage.md). Outside those, browser behaviour is unverified; say so plainly rather than implying the server-side checks covered it.

**Bite proofs are automated.** `npm run mutate:diff` is the bite proof for logic Vitest reaches; Playwright specs need a recorded red run or one deliberate break; UI tickets run `npm run visual:check` and its overflow gate must pass. The full rules (survivors, the 62.5% threshold, disable comments, the three-loop limit) are in [`tests/README.md` → Bite proofs: the rules](tests/README.md#bite-proofs-the-rules) — read them before running a bite proof. Every `// Stryker disable` comment and every survivor of the third loop is **my decision**, not yours.

**Environment.**

Port and build-lock hygiene is enforced by hooks in `.claude/hooks/` — a dev server or build already running will be reported to you rather than silently collided with. When you do stop a dev server, kill the actual `next dev`/`next-server` PID, not just the `npm` wrapper. Never kill a server you did not start without asking. `lsof` cannot see network sockets under WSL2 — use `ss` or `fuser` for port checks.

Every `git commit` you make passes a gate (`.claude/hooks/guard-commit.sh`, about 30s): lint, tsc for the app and for `scripts/`, and vitest. A red-first TDD commit is spelled `WIP #NNN: red — <what>` and skips vitest only. A tree whose only changes are `*.md` skips the gate. It does not build: `npm run build` belongs to whoever needs `.next`, because `e2e:nobuild` reuses it.

**Worktrees (not in use yet).** `.claude/` is committed and every hook resolves paths from the checkout it runs in, so the config works in any worktree. Two things don't carry over: `docs/handoffs/` is gitignored, so a ticket's `/ship-ticket` state file exists only in the worktree that started it (resume it there); and `npm run e2e` always serves on port 3100, so run it in one worktree at a time. Vitest is already safe in parallel: every test file gets its own temp database.

## Commands

`package.json` has the full list. The non-obvious ones:

- `npm run start` — **web app only.** The crawler/scanner/discovery are separate PM2 processes (`ecosystem.config.js`) and must be started independently.
- `npm run build-gos10k` — rebuilds `data/gos-10k.db` (the Archive serving copy) from the master under `gos10k/`, **including the derived `clear_number`** and the committed manifest `getArchiveDb()` checks at open. Skipping it after a master change gives wrong *analytics*, not just stale counts (ADR 0008), and `getArchiveDb()` will refuse the file. Re-run and re-`scp` after any master change.
- `npm run extract-archive-fixture` — regenerates the committed `tests/fixtures/archive-seed.json` from the master, through the same derivation as `build-gos10k`. Needs the master present.
- `npm run setup-manifest` — writes `data/manifest-cache.json` for a human to read. Changes nothing about runtime behaviour; see the raid-detection convention below.
- `npm run e2e` — Playwright. Builds, then serves on **port 3100** against a throwaway seeded Tracker and a fixture Archive, each proved by a canary. Not in `npm test`; CI runs it via `e2e.yml` on PRs only. It bakes a dummy `NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY` into the build. `npm run e2e:nobuild` skips the build — wrong if `.next` is stale, and it keeps whatever key the last build baked in.
- `npm run mutate:diff -- [range]` — Stryker over changed lines of `.ts` under `src/` (default `main...HEAD`). `.tsx` and `src/hooks/` are listed, not mutated. Usage and reading the report: `tests/README.md`.
- `npm run visual:check` — builds, then screenshots every page at 360/768/1280px × light/dark into `visual-check/`, failing on any clipped or off-screen element. `--nobuild` reuses `.next` (same staleness caveat). Not in `npm run e2e` or CI.
- `npm run e2e:maintenance` — slow, spawns real crawler/scanner processes against a mock Bungie server. Deliberately outside `npm test` and CI. Unrelated to `npm run e2e` despite the name.

Scripts run via `tsx` using `tsconfig.scripts.json`. Next.js app and scripts compile separately.

## Conventions that will burn you if missed

- **Player identity is `Name#Code`.** Always store and display `bungie_global_display_name` in full. Partial names were a real bug — see recent commits.
- **Raid detection is a hardcoded table, not a runtime cache lookup.** `RAID_DEFINITIONS` in `src/lib/bungie/manifest.ts` is a literal map of raid key → name/slug/activity hashes, flattened into a hash→key `Map` at import time. Nothing reads `data/manifest-cache.json` at runtime. Adding a new raid means **editing `manifest.ts`** — `npm run setup-manifest` only writes the cache file for a human to read. Each hash in that table is also tagged with its Difficulty (`normal` / `master` / `epic`), and every Difficulty filter reads that tag through `activity_hash`. `pgcrs.difficulty_tier` records Feats, and no filter reads it. Retagging a hash is an edit to `manifest.ts` plus `manifest.test.ts`.
- **Dedicated scanner key pool** (`BUNGIE_SCANNER_API_KEY`, `_2`, `_3`, `_4`) — the scanner rotates only within its own keys, and each key gets its own RPS budget. The code supports up to four, but one or two are enough at current traffic; `_3`/`_4` are headroom for a popularity spike and usually unset. Don't share scanner keys across other processes.
- **All SQL the app serves lives in one query module per database.** The Tracker's is `src/lib/db/queries.ts`; the GoS 10k Archive's is `src/lib/db/archive/queries.ts`. API routes and server components call them directly — no ORM, no service layer. The rule is per-database, not one file overall: `queries.ts` runs over an implicit `getDb()`, and mixing a second connection into it would make the database ambiguous per function. **Build-time SQL is outside the rule and deliberately so**: `src/lib/db/archive/derive-clear-number.ts` writes the Archive's derived columns (ADR 0008) and runs only from `scripts/`, never against a database the app has open — the request path still has exactly one query module per database. The Archive's full-clear predicates live in `src/lib/db/archive/predicates.ts` so both callers can import them without a connection, and `queries.ts` re-exports them.
- **The Archive's full-clear rules are named functions, and each one already includes "and the subject finished it."** Dropping that conjunct returns a plausible-looking wrong number — 34% high for the disjunctive rule, and only 40 runs high for the pinned one, which is the harder of the two to notice. Two of the four things this codebase calls a full clear are the Tracker's (`FULL_CLEAR`, `COMPLETION`); two are the Archive's. See `CONTEXT.md`'s `Full Clear` entry and issue #70.
- **`gos10k/` is how the Archive's data was *collected*; `scripts/` and `src/` are how it is *served*.** `gos10k/` is finished, keeps its own pinned `vitest.config.ts`, has no npm scripts and is deliberately outside CI. Anything ongoing — the serving-copy build, the fixture extract — belongs in `scripts/` where `tsconfig.scripts.json` and CI cover it.
- **API cache headers are only half the story** — Cloudflare cache rules (not in this repo) rewrite them, and a rule with no Browser TTL falls back to a 4h zone default. Check `cf-cache-status` and the header prod actually returns before touching `src/lib/http/cache.ts`. See `docs/decisions.md`. The Cloudflare settings the app's behaviour depends on — cache rules, Pseudo IPv4, HSTS, and the headers prod returns — are recorded in `docs/cloudflare.md`; read it before a change that assumes edge behaviour, and update it when the dashboard changes.

## Env vars

Core: `BUNGIE_API_KEY`, `BUNGIE_SCANNER_API_KEY`, `BUNGIE_SCANNER_API_KEY_2`, `BUNGIE_SCANNER_API_KEY_3`, `BUNGIE_SCANNER_API_KEY_4`, `BUNGIE_DISCOVERY_API_KEY`, `ADMIN_STATS_USERNAME` / `ADMIN_STATS_PASSWORD`, `SEED_PLAYERS`.

Archive: `GOS10K_ARCHIVE_DB_PATH` (default `data/gos-10k.db`) — the serving copy, opened `readonly` + `fileMustExist`. A missing or mismatched file 500s `/gos10k` on first access and nothing else; that is deliberate (ADR 0007).

Web: `NEXT_PUBLIC_SITE_URL` (default `https://destinyfarmfinder.qzz.io`) — sets `metadataBase` for social-share unfurls **and** the same-origin allowlist for the client-write guard. `NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY` — public key used by browser-side Bungie calls (profile + LinkedProfiles resolution). `PAGE_TOKEN_SECRET` (optional, server-only) — when set, enables the short-lived HMAC page-token check on the one client-write endpoint, `profile-viewed`, which takes ids and two flags only (`poll`, `history`): a browser never writes session or identity data, ADR 0010); when unset, it still enforces the same-origin check but skips the token layer. See `src/lib/http/request-auth.ts`. `ACTIVITY_MIN_RAID_RUNS` (default 5000) — runs a raid needs in the past week's training steps before Raid Activity gives it a Provisional estimate of its own; the e2e server sets 6 (`playwright.config.ts`: Salvation's Edge has 9 or 10 seeded runs there, King's Fall 4).

Tuning knobs (SQLite busy timeout, crawler concurrency, Bungie backoff, cleanup batching, scanner hole crossing, active-session display/poll/backoff limits, history-crawl limits) are in [`docs/env-vars.md`](docs/env-vars.md) with the reason each value matters. Read it before changing one. The one that burns people: `ACTIVE_SESSION_DISPLAY_LIMIT` counts **fireteams**, `ACTIVE_SESSION_ROW_SCAN_LIMIT` counts **rows**, and the two must stay separate ([ADR 0001](docs/adr/0001-fireteam-denominated-display-cap.md)).

## Active-session loop resilience

Four guards keep the active-session poll loop from stalling silently: a per-poll watchdog, a `finally`-anchored reschedule, a completion-anchored `session_heartbeat`, and a timeout treated as distinct from "offline". Don't remove one without reading [ADR 0005](docs/adr/0005-active-session-loop-resilience.md).

## Backups

No continuous replication: Tracker backups are manual snapshots (`npx tsx scripts/backup-db.ts`), tolerable because crawled data is re-crawlable. **The Archive is not re-crawlable** — treat the GoS 10k master (`gos10k/destiny_pgcrs.db`) as irreplaceable. Snapshot, restore and copy runbooks: `docs/decisions.md` ("Backups" at the top, and the 2026-09-04 copy runbook).

## Testing

Vitest. **`tests/README.md` is the how-to** — read it before writing or changing a test; it covers the two ground rules (mock `fetch` and only `fetch`; `npm test` stays hermetic), the layout, colocate-vs-`tests/`, fixtures-vs-builders, and the naming conventions. The rationale is in [ADR 0003](docs/adr/0003-tests-run-against-a-real-sqlite-file.md) and [ADR 0004](docs/adr/0004-mock-only-at-the-network-boundary.md); the build-out is in `docs/handoffs/testing-framework-handoff.md`. CI runs `npm test` (plus lint and `tsc`) on every push and PR via `test.yml`; the browser suite has its own `e2e.yml` on `pull_request` and manual dispatch only. `mutation.yml` runs `mutate:diff --typecheck` on PRs that touch `.ts` under `src/` and reports the score in its job summary and a Checks-tab notice; it never blocks a PR.

**Never reorder `setupFiles` in `vitest.config.ts`** — `tests/setup/test-db-path.ts` must stay first or the suite binds to the live dev database and `resetTestDb()` deletes from it. `getDb()` enforces this; `tests/README.md` explains why.

**Two runners, kept apart by file naming.** `.test.ts` is Vitest, `.spec.ts` under `e2e/` is Playwright. `tests/helpers/` is shared by both, so it must never import from `vitest` and must use relative imports rather than the `@/` alias — Playwright's loader doesn't apply tsconfig `paths` to `globalSetup`. The e2e suite points at its own throwaway Tracker **and** its own fixture Archive, and proves each one with a per-run canary checked through the running server before any spec runs; see [ADR 0003](docs/adr/0003-tests-run-against-a-real-sqlite-file.md).

Application code was not changed to make anything testable — if a test seems to require that, question it first.

## Agent skills

### Shipping a ticket

`/ship-ticket #NNN [implementer=<model>] [simplifier=<model>] [reviewer=<model>] [fixer=<model>]` delivers one `ready-for-agent` ticket, a GitHub issue or a gitignored local file under `docs/tickets/` (a local ticket is never looked up, commented on or referenced on GitHub) (implement → simplify → review → fix → handoff) with decision stops, checkpointed in `docs/handoffs/NNN-state.json`. Run it again after a usage limit or `/clear` to resume. `.claude/skills/ship-ticket/SKILL.md` is the protocol.

### Issue tracker

Issues are tracked in GitHub Issues on `agrorithms/destiny-public`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (labels match canonical role names). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
