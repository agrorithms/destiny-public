> Moved from `docs/handoffs/260803-playwright-e2e.md` on 2026-10-08 (#137), which is gitignored.
> This file is a dated journal, oldest entry first: the first section is the 2026-08-03 handoff,
> and each later entry records what one ticket covered and what it didn't. References to
> `.claude/plans/` point at a local-only file. Rewriting it into a coverage list is tracked in #151.

# Playwright e2e — what landed, what didn't

**Date:** 2026-08-03
**Branch:** `playwright-testing` (not merged, not pushed)
**Plan:** `.claude/plans/260803-playwright-e2e-plan.md` — the decision record.
Every decision below has a `D`-number there with its rejected alternatives.
Gitignored, so local to this machine only.

Browser testing now exists. Four flows, 15 Playwright tests (~8s) plus 40 new
Vitest tests. The scope was deliberately reduced mid-session; §3 lists everything
knowingly left undone, and it is longer than what landed.

## State at handoff

| | |
|---|---|
| Working tree | Clean |
| `npm run lint` | Pass |
| `npx tsc --noEmit` | Pass (also typechecks `e2e/**`) |
| `npm run build` | Pass |
| `npm test` | 149 tests, 13 files |
| `npm run e2e` | 15 tests, 5 files |
| CI | Unchanged — runs `npm test` only. e2e is **not** in CI by choice (§3.5) |

Six commits, oldest first:

```
afbaa54  WIP: cover request-auth + rate-limit, extend DB guard to e2e
8295217  WIP: Playwright harness — fixture DB, canary, network guard
77524fb  WIP: the four baseline e2e specs
9e30c6b  Document the e2e suite: handoff, ADR amendments, CLAUDE.md
ed86c40  Lock @playwright/test
c1c2c55  Apply review findings
```

The commit messages carry the reasoning for each chunk, including two places
where evidence killed an approach mid-flight. Read them before changing the
harness — `git log main..HEAD`.

## If you are picking this up cold

1. `npm run e2e` — confirm 15 green before touching anything. If it fails at the
   **canary**, the server is not on the fixture database; do not "fix" the specs,
   fix the wiring (§2).
2. Read `.claude/plans/260803-playwright-e2e-plan.md` §2 for why the harness is
   shaped this way. Most of the non-obvious choices have a rejected alternative
   that looks more attractive than it is.
3. Read `tests/README.md` before writing any test — it now covers both runners.
4. Pick from §3. Items 1 and 2 are the high-value ones and are designed to be
   done together.

---

## 1. Running it

```bash
npm run e2e            # build, then run. Always correct.
npm run e2e:nobuild    # skip the build. Fast, and wrong if .next is stale.
npx playwright test e2e/theme.spec.ts     # one file
npx playwright test --headed              # watch it happen
npx playwright test --ui                  # time-travel debugger
```

`npm test` (Vitest) and `npm run e2e` never see each other's files: Vitest owns
`**/*.test.ts` and explicitly excludes `e2e/**`; Playwright owns `**/*.spec.ts`
under `e2e/` only. Keep that naming or both runners start failing in ways that
read like broken tests rather than misconfiguration.

Runs against a **production build on port 3100**, never `next dev`. React
StrictMode double-invokes effects in development and both pages under test fetch
from `useEffect`, so a dev server would double every request and make the
leaderboard refetch assertion meaningless. Port 3100 keeps it clear of the dev
server on 3000; the same-origin guard accepts it automatically because
`allowedHosts()` adds the request's own `Host` header.

### When something fails

The run prints the fixture database path on startup:

```
[e2e] fixture database seeded at /tmp/dff-e2e-XXXXXX/e2e.db
```

That directory is left in place on purpose — open it with `sqlite3` and look. The
OS clears the temp dir eventually. Screenshots and traces land in
`test-results/` (gitignored); traces are captured on first retry only, and
retries are 0 locally, so use `--trace on` when you want one.

---

## 2. How it is wired

| File | Does |
|---|---|
| `playwright.config.ts` | Mints the fixture DB path at config load, fails fast if that didn't work, builds `webServer.env` |
| `e2e/support/fixture-db.ts` | `mkdtemp` + the four env vars. Imports nothing that reaches `src/lib/db` |
| `e2e/support/seed-world.ts` | The fixture world. Seeds through `tests/helpers/`, shared with Vitest |
| `e2e/support/global-setup.ts` | Seeds once, before any spec. Does no HTTP |
| `e2e/support/canary.setup.ts` | Asks the running server which database it opened |
| `e2e/support/test-fixtures.ts` | The `page.route` network guard. Import `test` from here, not `@playwright/test` |
| `e2e/support/server.ts` | Port + base URL. One definition, shared with `playwright.config.ts` (added 2026-08-26) |
| `e2e/support/write-request.ts` | Client-write headers for `APIRequestContext` (added 2026-08-26) |

### Three layers protect the live database

1. `assertDbPathAllowed()` — `src/lib/db/index.ts`, now fires under `DFF_E2E`
2. Fail-fast at config load — `playwright.config.ts`
3. The canary — `e2e/support/canary.setup.ts`

**Why three, why that order, and why the first two are insufficient on their own:
[ADR 0003](../adr/0003-tests-run-against-a-real-sqlite-file.md), the 2026-08-03
amendment.** It also covers the per-run nonce, `reuseExistingServer: false`, and
why `tests/setup/test-db-path.ts` could not be reused. Not repeated here.

The operational part: **if the canary fails, the problem is never the specs.** It
means the running server is not reading this run's fixture database — either the
env did not reach the `next start` child, or a server is up from an earlier run.
Both are wiring, and both would otherwise end with test fixtures written into the
live 5.5 GB database, which has no continuous replication and only manual
snapshots. Do not disable it to get a green run.

### Seeding is two-tier

Static world (players, historical runs) once in `globalSetup`; active sessions
per spec file in a `beforeAll`. The reason is the 900-second freshness window —
spelled out in the `seedFireteams` docblock in `e2e/support/seed-world.ts`.

### Conventions to keep

- **One fixture player namespace per spec file *that seeds*.** Specs which seed
  active sessions own a numeric prefix (`81` = active-sessions-cap, `82` =
  player-names, `83` = client-write-verify, `84` = client-write-resolve,
  `85` = client-write-guard, `86` = active-sessions-order, `87` = active-sessions-list, `88` = active-sessions-expand, `89` = active-sessions-collapse, `90` = active-sessions-copy, `91` = active-sessions-size; `92` is the seed world's own activity runs, for `/activity`) applied to both membership ids and display names, so no two specs
  can collide on the `active_sessions` primary key or produce two players with the
  same rendered `Name#Code`. Read-only specs (`leaderboard`, `theme`) share the
  static world deliberately — there is nothing to collide on, and duplicating the
  leaderboard fixture per file would make the seeded world harder to hold in your
  head for no gain. Assertions on shared counts are raid-scoped so file execution
  order never matters.
  The reason the convention exists at all: the client-write rate limiters in
  `src/lib/http/rate-limit.ts` are per-process singletons in the *server*, so two
  specs touching the same player within 30–120s would see each other's cooldowns
  through state no database isolation can reach. Serial execution (`workers: 1`)
  makes that moot today; the convention exists so raising `workers` later stays a
  config change rather than a rewrite.
- **`tests/helpers/` must not import from `vitest`,** and must use relative
  imports rather than the `@/` alias. Playwright's loader does not apply tsconfig
  `paths` when loading `globalSetup` (adding `baseUrl` does not change this — both
  were tried). Relative imports resolve under both runners.

---

## 3. Deferred — ordered by value

Nothing here was attempted. It was scoped out, not found to be hard.

> **Items 1–2 picked up:** grilled and ticketed in
> `docs/handoffs/260824-client-write-tests.md` (2026-08-24). Four implementation
> tickets: [#61](https://github.com/agrorithms/destiny-public/issues/61),
> [#62](https://github.com/agrorithms/destiny-public/issues/62),
> [#63](https://github.com/agrorithms/destiny-public/issues/63),
> [#64](https://github.com/agrorithms/destiny-public/issues/64), parent
> [#23](https://github.com/agrorithms/destiny-public/issues/23).

1. **The four player-profile client-write flows.**
   `PlayerProfileClient.tsx` runs four browser→server write paths:
   `verifyActiveSessionLive` (:881), `resolveUnknownMembersAndRefresh` (:903),
   `resolveFireteamActivity` (:959), `queueCrawlOnce` (:187). All echo
   `x-page-token`, all are `void`-chained and conditional on the previous
   response. These are the highest-value e2e targets in the app: only a browser
   can prove that `mintPageToken()` survives the RSC boundary into a real header,
   that the four calls fire in the right order and conditionally, and that the
   `?enrich=1` re-read repaints raw membership ids as `Name#Code`. The harness
   already stubs Bungie for them.

2. **Route-handler Vitest tests for the three client-write endpoints**
   (`queue-crawl`, `identity`, `active-session-update`): validation, 403/400/429,
   cooldown, `backing_off`, maintenance 503. **These branches are currently
   covered by nothing — the largest known gap in the repo's test coverage.** The
   pure-unit layer beneath them (`request-auth`, `rate-limit`) did land.

3. **Cross-origin / page-token negative test** — via `APIRequestContext` with a
   spoofed `Origin`; no browser page needed. `request-auth.test.ts` covers the
   logic; this would cover the wiring.
   > **Done:** grilled on
   > [#24](https://github.com/agrorithms/destiny-public/issues/24) and landed as
   > `e2e/client-write-guard.spec.ts` (2026-08-26). Spun off
   > [#66](https://github.com/agrorithms/destiny-public/issues/66). See the
   > 2026-08-26 addendum.

4. **`@live` Bungie contract tests.** Proof that Bungie still returns the shape
   `linked-profiles.ts` parses — something mocks can never provide. Design agreed:
   tagged `@live`, `--grep-invert`ed out of the default run, and `test.skip`ped
   when `BUNGIE_E2E_API_KEY` is unset, so a Bungie maintenance window can never
   redden a normal run. Three independent layers, deliberately.

5. **CI.** Not wired up, on purpose. A separate `e2e.yml` on `pull_request` only
   (not `push`, which would run it twice), `retries: 2` in CI and `0` locally,
   and only once the suite has been stable locally for a while. Deliberately not
   added to `test.yml`, whose contract is "fast, hermetic, per-push". Given ~5
   visitors/day and a deploy-to-prod-to-test workflow, this is arguably more
   valuable as a pre-deploy ritual than as a bot gate.
   > **Done:** grilled on
   > [#26](https://github.com/agrorithms/destiny-public/issues/26) and landed as
   > `.github/workflows/e2e.yml` (2026-08-26). See the second 2026-08-26
   > addendum. The shape above survived the grilling; what it did not anticipate
   > was the build-time Bungie key.

6. **Full Sentry suppression.** Currently the browser side is stubbed and the
   server side is tagged `SENTRY_ENVIRONMENT=e2e`, so ~5% of traces plus any real
   error still reach the production Sentry project, filterable but present. The
   complete fix is one line — `dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "…"` in
   the three configs — but that is an application change made for testability, so
   it needs a decision rather than a drive-by.

7. **Port 3100 is unguarded.** `.claude/hooks/guard-dev-server.sh` only matches
   `npm run dev`/`next dev` on port 3000. A crashed Playwright run can orphan a
   `next start` on 3100 and nothing will report it.

8. **Everything else from the session's shortlist**: API error and empty states,
   `BungieMaintenanceAlert`, freshness timestamps re-rendering (via Playwright's
   clock API), calm updates on `/active-sessions`, `PlayerSearch` debounce, admin
   auth, a mobile-viewport pass, the OG image route, an accessibility smoke pass
   (`RaidMultiSelect` is a known first finding — see §4).

   Two notes so these are not misread:
   - The OG *count* property is already covered — `active-sessions-cap.spec.ts`
     asserts `total` vs `shown`, which is the ADR 0002 tie-in. What is missing is
     the image route itself.
   - The client-write guard's **logic** landed in `src/lib/http/request-auth.test.ts`
     (28 tests). Only the browser-level wiring is outstanding, and that is item 3
     above, not a separate job.

### Dropped, not deferred

**Filter state ↔ URL deep-linking.** Proposed early in the session, then
withdrawn: no leaderboard preference touches the URL. `useRaidFilter.ts`,
`useLeaderboardPrefs.ts` and `src/app/leaderboard/page.tsx` contain no
`searchParams`, `useSearchParams`, `pushState` or `router.replace` — raid, hours,
mode and page size are all `localStorage`. There is nothing to deep-link and
nothing to assert. The nearest real behaviour is covered by
`leaderboard.spec.ts` → "keeps the selected filter across a reload".

Recorded here so it is not re-added as an oversight. Making filters shareable via
the URL would be a **feature change**, not a missing test.

---

## 4. Bugs found, not fixed

**`/active-sessions` breaks if `ACTIVE_SESSION_DISPLAY_LIMIT` is lowered below
600.** `src/app/active-sessions/page.tsx:58` requests `?limit=600` as a hardcoded
literal. `src/app/api/active-sessions/route.ts:78` rejects any `limit` greater
than the configured cap with a 400. The page catches the failure and renders an
empty list with no error surfaced — so the symptom is "no active sessions",
which is indistinguishable from a genuinely quiet night.

Found while trying to make the display cap bite with a small seeded world. The
plan had called for setting the limit to 5 in `webServer.env`; that produced an
empty page instead of a trimmed one. The spec now proves the fireteam
denomination through the page and the cap through the API's own `limit`
parameter, and the env var is left alone — see the comment in
`playwright.config.ts`.

Worth fixing by deriving the client's limit from the server rather than
hardcoding it, but that is application behaviour and was outside this session's
scope.

**`RaidMultiSelect` has no ARIA roles.** Its options are `div`s with `onClick`,
so they are not keyboard reachable and there is no `listbox`/`option` semantic to
target. `e2e/leaderboard.spec.ts` works around it by matching the option's `span`
to disambiguate from a same-named `h3` elsewhere on the page. A real
accessibility fix would also make that locator obvious.

---

## 5. Files changed

`git diff main...HEAD` for the real thing. 25 files, +1461/−39.

**New — the suite**

```
playwright.config.ts              config, fixture-DB minting, webServer env
e2e/support/fixture-db.ts         mkdtemp + env vars; imports nothing db-reaching
e2e/support/seed-world.ts         the fixture world; seeds via tests/helpers/
e2e/support/global-setup.ts       seeds once; does no HTTP
e2e/support/canary.setup.ts       the observing guard layer
e2e/support/test-fixtures.ts      page.route network guard; import `test` from here
e2e/leaderboard.spec.ts           flow 1
e2e/active-sessions-cap.spec.ts   flow 2  (ADR 0001 + 0002)
e2e/player-names.spec.ts          flow 3
e2e/theme.spec.ts                 flow 4
```

**New — Vitest tranche**

```
src/lib/http/request-auth.test.ts   28 tests; both token layers + same-origin
src/lib/http/rate-limit.test.ts     12 tests; both limiter classes
```

**Edited — application code (one file, one function)**

```
src/lib/db/index.ts    assertDbPathAllowed() fires under VITEST || DFF_E2E
```

That is the *only* `src/` change in the whole branch. It is a precondition check,
not behaviour — see ADR 0004's position on why that is permitted where a mock
would not be.

**Edited — config and shared helpers**

```
vitest.config.ts                exclude: ['e2e/**']
package.json                    e2e, e2e:nobuild scripts
package-lock.json               @playwright/test
.gitignore, eslint.config.mjs   Playwright output dirs
tests/helpers/{seed,db,pgcr-builder}.ts   @/ alias -> relative imports
```

The helper import change is not cosmetic — see §2's conventions. It is what lets
both runners share one seeding vocabulary.

**Edited — docs**

```
docs/adr/0003-...  amended (guard extended to e2e)
docs/adr/0004-...  amended (page.route as the browser-side boundary)
tests/README.md    both runners, shared-helper constraints
CLAUDE.md          removed the false "no headless browser is installed"
```

---

## 6. Suggested skills for the next session

- **`/verify`** — before and after any change here. It is the repo's build /
  launch / drive recipe and it now has a browser suite to lean on.
- **`/tdd`** — for §3 items 1 and 2. Both are test-writing work against code that
  already exists and already has agreed seams; red-green is the natural shape.
- **`/grill-with-docs`** — before starting §3 item 4 (`@live` tests), 5 (CI), or
  6 (Sentry). Each carries a decision the user has explicitly reserved:
  contract-test cadence, CI cost/flake tolerance, and whether application code may
  change for testability. Do not decide these unilaterally.
- **`/two-axes-code-review`** — this branch was reviewed that way and it caught
  four real defects, including a glossary breach and a doc reference pointing at
  the wrong file. Worth repeating.
- **`/simplify`** — deliberately *not* run on `e2e/support/`. The comment density
  there is high on purpose, because the harness encodes several
  non-obvious-and-dangerous constraints (import ordering, the nonce, the
  `NEXT_PUBLIC_*` build-time inlining trap). Read the plan's §2 before trimming
  anything as redundant.

## 7. Working agreements observed this session

Carry these forward; they are the user's stated preferences, not local habit.

- **Discussion is the default, implementation is opt-in.** This work was designed
  across an 8-question interview and only started on an explicit "implement".
- **Evidence before root cause.** Three proposed approaches were killed by
  evidence mid-session (see the plan's E6, E13, E14). State the check, run it,
  show the output — do not refine a theory the data contradicted.
- **Say up front whether a change contradicts or hardens each relevant ADR**, and
  amend an existing ADR rather than adding a new one.
- **Local verification steps, not "deploy and see".** The user deploys to prod to
  test; give explicit local commands instead.
- **Never read or grep `.env`** in this repo, even for variable names.

---

## Addendum — 2026-08-25

Nothing above has been edited. This section records what changed between the
2026-08-03 handoff and today, so the counts and the "not fixed" claims above can
be read as the historical record they are rather than as current state.

**Branch:** `playwright-testing` (still the working branch).

### Counts, then and now

| | 2026-08-03 | 2026-08-25 |
|---|---|---|
| `npm run e2e` | 15 tests, 5 files | 20 tests, 7 files |
| `npm test` | 149 tests, 13 files | 246 tests, 21 files |
| Browser flows | 4 | 6 |
| CI | `npm test` only | unchanged — e2e still out, by choice |

The header line "Four flows, 15 Playwright tests" is therefore accurate as of
2026-08-03 and stale after it. `CLAUDE.md` now carries the current figure.

### §3 items 1 and 2 — done

Grilled and ticketed in `docs/handoffs/260824-client-write-tests.md`, then
implemented across four commits:

| Ticket | Commit | What it added |
|---|---|---|
| [#61](https://github.com/agrorithms/destiny-public/issues/61) | `26459d4`, `e60a22f` | `tests/routes/identity.test.ts` (7), `tests/routes/queue-crawl.test.ts` (8), `tests/helpers/build-write-request.ts` |
| [#62](https://github.com/agrorithms/destiny-public/issues/62) | `24d1572` | `tests/routes/active-session-update.test.ts` (13), `tests/helpers/bungie-profile-builder.ts` |
| [#63](https://github.com/agrorithms/destiny-public/issues/63) | `2093a51` | `e2e/client-write-verify.spec.ts` (2) — happy path + private account |
| [#64](https://github.com/agrorithms/destiny-public/issues/64) | `328a9b7` | `e2e/client-write-resolve.spec.ts` (1) — the `Name#Code` enrichment round-trip |

Item 2's "largest known gap in the repo's test coverage" is closed: all three
client-write route handlers now have validation, 403/400/429, cooldown,
`backing_off` and maintenance-503 coverage.

Item 1 is closed for three of the four write paths. `verifyActiveSessionLive`,
`resolveUnknownMembersAndRefresh` and `queueCrawlOnce` are proven in a browser,
including the `?enrich=1` repaint. **`resolveFireteamActivity` (:959) is still
unproven** — scenario 4 in the #23 design, deliberately deferred there too.

New e2e support since this handoff: `e2e/support/network-log.ts`
(`interceptApiCalls`, `NetworkEntry`, `callIndex`/`callIndexes`),
`seedPlayerWithSession` + its `extraMembers` option in `seed-world.ts`, and
`isExternalAsset()` in `test-fixtures.ts` for the profile page's third-party
favicons.

### §4 — both bugs are fixed

Both were fixed on 2026-08-23 in `e43e0f7`, with e2e coverage added in
`4a78431`:

- **`/active-sessions` hardcoded `?limit=600`** — the query param was dropped
  entirely, so the server's own `ACTIVE_SESSION_DISPLAY_LIMIT` applies. A
  "Showing X of Y active fireteams" note appears when the cap bites, and fetch
  failures now surface as "Could not load active sessions" instead of an empty
  list. Covered by `active-sessions-cap.spec.ts` → "shows an error message when
  the API fails, not the empty state".
- **`RaidMultiSelect` had no ARIA roles** — it now has `role="listbox"` /
  `role="option"`, `aria-selected`, `aria-haspopup`, `aria-expanded`,
  `aria-activedescendant`, and arrow/space/escape keyboard handling. The
  `leaderboard.spec.ts` `span` workaround described in §4 is gone, replaced by
  `getByRole('option')`. Covered by "raid filter is keyboard-navigable".

**Consequence worth knowing:** the long comment in `playwright.config.ts` that
explains why `ACTIVE_SESSION_DISPLAY_LIMIT` is *not* overridden in
`webServer.env` still says the page "requests `?limit=600` as a hardcoded
literal". That is no longer true. The comment is stale, not wrong in effect —
nothing depends on it — but a future session that lowers the cap for a spec
should re-derive the behaviour rather than trust it.

### Cleanup pass over the #24 commit — 2026-08-26, later

A `/simplify` review of `ec3ce7c` (quality only, no bug hunt: reuse,
simplification, efficiency, altitude). Behaviour is unchanged and the six tests
are the same six tests; what moved is where the contract lives and how much
prose surrounds it.

**The header contract is no longer written twice.** New
`tests/helpers/write-headers.ts` holds the four headers `isTrustedClientWrite`
checks (`content-type`, `origin`, `x-forwarded-for`, `PAGE_TOKEN_HEADER`).
The original justification for the split was about the *return type* —
`build-write-request.ts` constructs a `NextRequest` — which argues against
reusing that function, not against extracting the header map from it. Both sides
now call the shared builder: the Vitest helper spreads it and adds `host`;
`e2e/support/write-request.ts` shrinks to `SPOOFED_ORIGIN` plus the origin
default. The two had already drifted (`ip` required on the e2e side, optional on
the Vitest side). `tests/helpers/` is the right home per the constraint in
`tests/README.md` — no `vitest` import, relative paths only.

**`pinPageTokenSecret()` is gone**, inlined to
`process.env.PAGE_TOKEN_SECRET = E2E_PAGE_TOKEN_SECRET` at the same call site in
`playwright.config.ts`. It was a one-line wrapper around one assignment, called
once, under a ten-line docblock. This is safe only because `getSecret()`
(`src/lib/http/request-auth.ts:51`) reads `process.env` per call rather than
freezing it at module load — checked, not assumed, since an import-time read
would make the ordering load-bearing.

**`writeHeaders`' `token` option is now `omitToken?: boolean`.** It was
tri-state (`undefined` = mint, `null` = omit, `string` = verbatim) and the string
branch had no caller. Worth knowing: a *malformed*-token test would need that
branch back. No coverage moved — token logic is covered at the unit level in
`src/lib/http/request-auth.test.ts`.

**Alias shims deleted** — `const PORT = E2E_PORT`, `const BASE_URL =
E2E_BASE_URL`, and `TRUSTED_ORIGIN = E2E_BASE_URL` were renames of imports.

**A bug the cleanup introduced, then fixed.** Removing `TRUSTED_ORIGIN` first
replaced a destructuring default with a spread — `buildHeaders({ origin:
E2E_BASE_URL, ...options })` — so an explicit `origin: undefined` would spread
*over* the default and send `undefined` as a header value instead of falling
back to the trusted origin. `Partial<WriteHeaderOptions>` type-checks that. No
caller does it, so the suite stayed green throughout. Now a destructured default,
with a comment saying `null` is the way to omit the header.

**The two installation smokes are one table-driven loop**; a third endpoint is
one line rather than nine. Reported test names are unchanged.

**Comment trim.** The `PAGE_TOKEN_SECRET` rationale appeared five times,
near-verbatim from the commit message. The full story now lives once at
`E2E_PAGE_TOKEN_SECRET`; the other four sites are pointers. It also now leads
with the accurate reason: keeping runner and server in lockstep and overriding
`.env`, with fail-open as the CI / fresh-clone case rather than the headline.
`e2e/support/server.ts` claimed "three things have to agree" and then listed two;
it now says two, and notes that the `localhost:3100` literals in `tests/helpers/`
and `src/lib/http/` are independent stand-ins that never open a socket, so nobody
"fixes" the wrong file.

**Re-verified by the same mutation**, since the refactor touched the pin: with
the pin removed from *both* places, `valid origin and token: the write lands`
still fails 403. Note what that run also showed — `valid origin with no page
token is rejected` **passed** under the mutation, because the server still had
a real `.env` secret. Fail-open is the CI / fresh-clone story only; locally the
failure mode is the lockstep one.

**Deliberately not done.** Each of these is a real finding that was judged not
worth the churn:

- Six tests each build a browser context and page they never use — the
  `blockExternalRequests` fixture is `auto` and destructures `page`, and
  Playwright resolves fixture deps from the parameter list, so only a page-free
  `test` export would avoid it. Measured at ~263 ms across the spec, against a
  suite that spends ~60 s on build and boot, and the fix trades away the
  suite-wide "no spec imports `@playwright/test` directly" rule.
- Unifying the runner and server env into one `fixtureRunEnv()` — the right
  shape (the hand-copy into `webServer.env` is a drift risk, and
  `PAGE_TOKEN_SECRET` skips the `FIXTURE_DB_ENV_KEYS` fail-fast loop), but the
  hand-copy predates #24 and the refactor is outside that diff.
- Sharing one secret constant between `E2E_PAGE_TOKEN_SECRET` and
  `tests/routes/write-route-setup.ts` — would couple two suites that never share
  a process. The constraint is "non-empty and consistent within one run", not
  "the same value in both".
- No parallelism gain is available: `workers: 1` is deliberate (per-process rate
  limiters in the server), and each test is one local round trip.

Verification: `npm run lint` clean, `tsc --noEmit` clean, `npm test` 248 passed,
`npm run e2e` 26 passed.

### Still open from §3

Items 3–8 are untouched, with one clarification each where the ground moved:

- **3. Cross-origin / page-token negative test.** **Done** — see the 2026-08-26
  addendum below.
- **4. `@live` Bungie contract tests.** Unchanged. Note that
  `tests/helpers/bungie-profile-builder.ts` now encodes the assumed shapes for
  `GetProfile` *and* `GetLinkedProfiles`, which raises the value of this item:
  there is now more mocked contract to drift.
- **5. CI.** **Done** — see the second 2026-08-26 addendum below.
- **6. Sentry suppression**, **7. Port 3100 unguarded**, **8. the shortlist** —
  all unchanged. `.claude/hooks/` still has no matcher for 3100.

### Other work on this branch since 2026-08-03

Substantial non-e2e work landed on the branch and is not described anywhere in
this document: the analytics data pipeline (`#33`–`#39` — session snapshots,
raid-stats and session-history endpoints, leaderboard difficulty/player-count
filters, player profile performance stats) and the agent-skills setup. Those have
their own handoffs under `docs/handoffs/2608*`. Mentioned here only so a reader
does not assume `git log main..HEAD` on this branch is all e2e.

---

## Addendum — 2026-08-26

### Counts

| | 2026-08-25 | 2026-08-26 |
|---|---|---|
| `npm run e2e` | 20 tests, 7 files | 26 tests, 8 files |
| `npm test` | 246 tests, 21 files | 248 tests, 21 files |

(The `npm test` movement is not from this work — no Vitest test was added or
changed here. It is drift from other commits on the branch.)

### §3 item 3 — done

Grilled on [#24](https://github.com/agrorithms/destiny-public/issues/24) (the
decision record is a comment on that issue) and implemented as
`e2e/client-write-guard.spec.ts`: six tests driving the client-write guard over
real HTTP through `APIRequestContext`, no browser page. A positive control
(valid origin + valid token → `200 {stored:true}`), three negatives on
`/api/players/identity` (spoofed origin, no origin *and* no referer, no page
token), and an installation smoke on `queue-crawl` and `active-session-update`.

New support file `e2e/support/write-request.ts` (`writeHeaders`,
`SPOOFED_ORIGIN`). It cannot reuse `tests/helpers/build-write-request.ts`, which
builds a `NextRequest` — the wrong object when the request goes over the wire.
(As landed it also exported `TRUSTED_ORIGIN`; the cleanup pass below removed
that and moved the shared part of the header contract into `tests/helpers/`.) Fixture namespace **85** is now
claimed (81 active-sessions-cap, 82 player-names, 83 client-write-verify,
84 client-write-resolve).

Every negative asserts the response **body** (`{error:'Forbidden'}`), not just
the 403. That is deliberate, for the reason below.

### `PAGE_TOKEN_SECRET` is now pinned for the run

`playwright.config.ts` used to pass the secret through only when the invoking
shell had it. That was silently doing nothing useful: `next start` loads `.env`,
so the *server* took the developer's real secret while the runner had whatever
was exported — and `verifyPageToken()` fails **open** when a secret is missing
entirely. Both processes now use `E2E_PAGE_TOKEN_SECRET` from
`e2e/support/fixture-db.ts`.

Verified by mutation, not by reasoning: with the pin removed from both places, a
valid-origin, valid-token POST returns 403, because the server verifies against
`.env` while the runner mints against nothing. Removing it from `webServer.env`
*alone* changes nothing — Playwright merges `process.env` into `webServer.env`,
so the runner's value reaches the child anyway. The explicit line is what
overrides `.env`.

Consequence for #63/#64: they now mint real tokens on every run rather than
sometimes an empty string. Both still pass.

### Middleware finding — filed, not fixed

`middleware.ts` matches `/api/players/:path*`, which covers **all three**
client-write endpoints, so every real POST to them passes through the
`players-read` bucket (60/60s per IP) *before* the route's guard and its own
limiters. The route-handler tests call the exported `POST` directly and cannot
see this. Whether writes should share a read bucket is application behaviour, so
it is [#66](https://github.com/agrorithms/destiny-public/issues/66) rather than
part of #24. The new spec pins current behaviour by asserting 403-with-body,
which fails if middleware ever shadows the guard.

### Cleanup pass over the #24 commit — 2026-08-26, later

A `/simplify` review of `ec3ce7c` (quality only, no bug hunt: reuse,
simplification, efficiency, altitude). Behaviour is unchanged and the six tests
are the same six tests; what moved is where the contract lives and how much
prose surrounds it.

**The header contract is no longer written twice.** New
`tests/helpers/write-headers.ts` holds the four headers `isTrustedClientWrite`
checks (`content-type`, `origin`, `x-forwarded-for`, `PAGE_TOKEN_HEADER`).
The original justification for the split was about the *return type* —
`build-write-request.ts` constructs a `NextRequest` — which argues against
reusing that function, not against extracting the header map from it. Both sides
now call the shared builder: the Vitest helper spreads it and adds `host`;
`e2e/support/write-request.ts` shrinks to `SPOOFED_ORIGIN` plus the origin
default. The two had already drifted (`ip` required on the e2e side, optional on
the Vitest side). `tests/helpers/` is the right home per the constraint in
`tests/README.md` — no `vitest` import, relative paths only.

**`pinPageTokenSecret()` is gone**, inlined to
`process.env.PAGE_TOKEN_SECRET = E2E_PAGE_TOKEN_SECRET` at the same call site in
`playwright.config.ts`. It was a one-line wrapper around one assignment, called
once, under a ten-line docblock. This is safe only because `getSecret()`
(`src/lib/http/request-auth.ts:51`) reads `process.env` per call rather than
freezing it at module load — checked, not assumed, since an import-time read
would make the ordering load-bearing.

**`writeHeaders`' `token` option is now `omitToken?: boolean`.** It was
tri-state (`undefined` = mint, `null` = omit, `string` = verbatim) and the string
branch had no caller. Worth knowing: a *malformed*-token test would need that
branch back. No coverage moved — token logic is covered at the unit level in
`src/lib/http/request-auth.test.ts`.

**Alias shims deleted** — `const PORT = E2E_PORT`, `const BASE_URL =
E2E_BASE_URL`, and `TRUSTED_ORIGIN = E2E_BASE_URL` were renames of imports.

**A bug the cleanup introduced, then fixed.** Removing `TRUSTED_ORIGIN` first
replaced a destructuring default with a spread — `buildHeaders({ origin:
E2E_BASE_URL, ...options })` — so an explicit `origin: undefined` would spread
*over* the default and send `undefined` as a header value instead of falling
back to the trusted origin. `Partial<WriteHeaderOptions>` type-checks that. No
caller does it, so the suite stayed green throughout. Now a destructured default,
with a comment saying `null` is the way to omit the header.

**The two installation smokes are one table-driven loop**; a third endpoint is
one line rather than nine. Reported test names are unchanged.

**Comment trim.** The `PAGE_TOKEN_SECRET` rationale appeared five times,
near-verbatim from the commit message. The full story now lives once at
`E2E_PAGE_TOKEN_SECRET`; the other four sites are pointers. It also now leads
with the accurate reason: keeping runner and server in lockstep and overriding
`.env`, with fail-open as the CI / fresh-clone case rather than the headline.
`e2e/support/server.ts` claimed "three things have to agree" and then listed two;
it now says two, and notes that the `localhost:3100` literals in `tests/helpers/`
and `src/lib/http/` are independent stand-ins that never open a socket, so nobody
"fixes" the wrong file.

**Re-verified by the same mutation**, since the refactor touched the pin: with
the pin removed from *both* places, `valid origin and token: the write lands`
still fails 403. Note what that run also showed — `valid origin with no page
token is rejected` **passed** under the mutation, because the server still had
a real `.env` secret. Fail-open is the CI / fresh-clone story only; locally the
failure mode is the lockstep one.

**Deliberately not done.** Each of these is a real finding that was judged not
worth the churn:

- Six tests each build a browser context and page they never use — the
  `blockExternalRequests` fixture is `auto` and destructures `page`, and
  Playwright resolves fixture deps from the parameter list, so only a page-free
  `test` export would avoid it. Measured at ~263 ms across the spec, against a
  suite that spends ~60 s on build and boot, and the fix trades away the
  suite-wide "no spec imports `@playwright/test` directly" rule.
- Unifying the runner and server env into one `fixtureRunEnv()` — the right
  shape (the hand-copy into `webServer.env` is a drift risk, and
  `PAGE_TOKEN_SECRET` skips the `FIXTURE_DB_ENV_KEYS` fail-fast loop), but the
  hand-copy predates #24 and the refactor is outside that diff.
- Sharing one secret constant between `E2E_PAGE_TOKEN_SECRET` and
  `tests/routes/write-route-setup.ts` — would couple two suites that never share
  a process. The constraint is "non-empty and consistent within one run", not
  "the same value in both".
- No parallelism gain is available: `workers: 1` is deliberate (per-process rate
  limiters in the server), and each test is one local round trip.

Verification: `npm run lint` clean, `tsc --noEmit` clean, `npm test` 248 passed,
`npm run e2e` 26 passed.

### Still open from §3

Items 4–8 unchanged.

---

## Addendum — 2026-08-26, CI

### §3 item 5 — done

Grilled on [#26](https://github.com/agrorithms/destiny-public/issues/26) (the
decision record is a comment on that issue) and landed as
`.github/workflows/e2e.yml`.

**Deliberately ahead of [#25](https://github.com/agrorithms/destiny-public/issues/25)
(item 4).** Item 4 is not a prerequisite: no `@live` spec exists, so there was
nothing for CI to trip over. The only real coupling — that item 4's design
`--grep-invert`s `@live` out of the default run — is closed by putting
`grepInvert: /@live/` in `playwright.config.ts` rather than in the CI command.
The exclusion now holds for every invocation, and landing the first `@live` spec
cannot start making network calls from a GitHub runner or require touching the
workflow. Doing 5 first also makes 4's own reserved question — is a contract-test
failure informational or blocking — answerable against a job that exists.

### The job

`pull_request` + `workflow_dispatch`, never `push` (on a PR branch both fire and
the suite would run twice for one change). `workflow_dispatch` is the pre-deploy
ritual §3.5 argued was the more valuable half.

**Intended to report, not to gate.** Checked during review: `main` has no branch
protection at all (`404 Branch not protected`), so this holds trivially today.
The corollary is worth knowing — promoting this to a required check later means
creating a ruleset from scratch, not flipping a toggle on an existing one.

Two operational notes, neither contradicting a decision:

- `workflow_dispatch` is not dispatchable until the file is on the default
  branch, so the pre-deploy-ritual half of the trigger choice is inert until
  this branch merges.
- `retries: 2` applies to the `canary` project too, so a failure of the
  fixture-database guard is retried twice before reporting. The canary is
  deterministic, so a retry cannot turn a real failure green.

`npm ci` → `playwright install --with-deps chromium` → build → `npx playwright
test`. No `lint`/`tsc --noEmit`: `test.yml` already runs both on
`pull_request`, so a red job here means a browser flow broke, unambiguously.
Build and test are separate steps so a build failure reads as a build failure
rather than as a server that failed to start. `concurrency` +
`cancel-in-progress` keeps rapid pushes from stacking a minutes-long job;
`timeout-minutes: 15` is the ceiling `webServer.timeout` does not provide for a
run that hangs *after* boot — the CI counterpart of the missing port-3100 guard
in item 7 / [#28](https://github.com/agrorithms/destiny-public/issues/28).

`retries: process.env.CI ? 2 : 0`, with `test-results/` uploaded on failure.
These are one decision, not two: `trace: 'on-first-retry'` means the retry is
what *produces* the diagnostic, and without the upload it dies with the runner.
Known and accepted cost: a genuinely flaky test goes green on retry and is
silent unless someone reads the run summary.

### The one thing the §3.5 design did not anticipate

**`NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY` has to be set at build time, or two specs
fail for a reason unrelated to the code under test.** `client-write-verify` and
`client-write-resolve` both carry a docblock saying so; `getPublicApiKey()`
(`src/lib/bungie/client-api.ts:69`) throws on a missing key *before* `fetch`, so
the Bungie stub never fires. There is no `.env` on a runner, and this is equally
true of a fresh local clone.

It could not be fixed the way `PAGE_TOKEN_SECRET` was. Next inlines
`NEXT_PUBLIC_*` at **build** time and `npm run e2e` is
`next-build && playwright test` — the build finishes before Playwright's config
is ever loaded, so a constant in `e2e/support/fixture-db.ts` would be set too
late to reach the bundle. It is therefore an env prefix on the `e2e` script
itself, and `env:` on the workflow's build step.

**Pinned unconditionally, not `${VAR:-default}`.** A conditional pin is exactly
the shape that hid the `PAGE_TOKEN_SECRET` bug for weeks: a machine with a real
key in `.env` would test a different configuration than CI does. A fake value is
correct here — every `bungie.net` request is answered by the single
`page.route('**/*')` interceptor in `e2e/support/test-fixtures.ts`, which
`fulfill`s from the runner process and never opens a socket, so only
non-emptiness is load-bearing. That is also why the literal appearing in both
`package.json` and `e2e.yml` is a convenience rather than a constraint: they
cannot meaningfully drift.

Consequence for `npm run e2e:nobuild`: it does not rebuild, so it inherits
whatever key the last build baked in. Noted in `tests/README.md` and `CLAUDE.md`.

### Deliberately not done

**Full Sentry suppression** (item 6 / [#27](https://github.com/agrorithms/destiny-public/issues/27)).
The DSN is hardcoded in `sentry.server.config.ts:8`, so a CI run ships
server-side traces to the production Sentry project, tagged
`SENTRY_ENVIRONMENT=e2e` and therefore filterable. The one-line fix is an
application change made for testability, which ADR 0004 and §3.6 both say needs
its own decision — dragging it into a CI ticket is the drive-by §3.6 warns
against. What *has* changed is the volume argument: this was one developer's
machine, and is now every PR run. Recorded as a comment on #27.

### Not verifiable locally

Everything below was checked on this machine, including the fresh-clone case by
moving `.env` aside so the build genuinely lacked the key — the specific failure
the dummy exists to fix. What that cannot prove is the runner itself: x86_64
`better-sqlite3` (the architecture caveat `test.yml` already documents), and
whether 26 serial round-trips are as stable on shared CI hardware. First real
signal is the pull request that merges this branch.

### No ADR

Tested against the three criteria and it fails the first: deleting a workflow
file is a one-line PR. The CI-as-report-not-gate choice is a real trade-off and
mildly surprising, but that is one leg of three. §3.5's own prose is the
rationale; it needed marking resolved, not a new decision document.

---

## Addendum — 2026-08-31: iOS utility-button regression test

`e2e/leaderboard.spec.ts` gains "utility buttons still act when the listbox blurs to
nothing". **Flow count is unchanged at six** — this sits inside flow 1 (leaderboard
filtering), the same flow as the keyboard-nav test added in `e43e0f7`.

What it covers: `RaidMultiSelect`'s `focusout` dismissal path when focus leaves with a
null `relatedTarget`. Select All and Clear Filter must both apply their change and
leave the dropdown open.

**What it does NOT cover, and this is the point:** iOS. The bug is WebKit-specific —
WebKit does not focus a `<button>` on tap, so the tap produced a `focusout` with no
`relatedTarget`. Chromium focuses buttons on mousedown and therefore cannot reproduce
the tap. The test drives a real `blur()` to produce the same *event*, which is a proxy
for WebKit's focus semantics, not a reproduction of them.

**Only a webkit project would close this gap.** Not installed:
`~/.cache/ms-playwright` holds chromium only, and `playwright.config.ts` defines just
`canary` + `chromium`. Adding one needs `npx playwright install webkit`, a project
entry, and an install step in `e2e.yml`. Until then, no browser test in this repo has
ever executed against the engine every iOS browser uses — treat any mobile-Safari
claim as unverified. See `docs/handoffs/260831-ios-raid-filter-utility-buttons.md`.


---

## 2026-09-07 — the GoS 10k Archive gets a harness, and one smoke spec

Issue [#96](https://github.com/agrorithms/destiny-public/issues/96), split out of
[#80](https://github.com/agrorithms/destiny-public/issues/80). First browser coverage of
the second database.

### What is now covered

**The Archive is bound to a throwaway file and that binding is proved.** ADR 0007's
consequence that "the e2e suite mints its own Tracker database and knows nothing about
`data/gos-10k.db`" is **no longer true** — the suite mints both. ADR 0007's text still
says otherwise; updating it is #80's Wave 4 job, deliberately, because the sentence that
replaces it depends on what #87/#88/#90 end up asserting.

- `e2e/support/archive-world.ts` builds the fixture Archive from the committed seed via
  the **unmodified** shared loader (`tests/helpers/archive-seed.ts`), then adds one canary
  helper carrying the run's nonce.
- `e2e/support/archive-canary.setup.ts` asks the running server for `/gos10k` and requires
  that helper in the HTML. It joins the existing `canary` project by filename, so it is a
  project dependency of `chromium` and a failure aborts the run before any spec.
- `e2e/gos10k-smoke.spec.ts` loads the page in Chromium: heading renders, canary visible,
  no console errors and no page errors.

**Flow count: six → seven.** `npm run e2e` is 29 tests over 9 files (2 canary + 27 specs).

### The read-only wrinkle, resolved rather than worked around

#96 flagged that a read-only file cannot carry a written canary row and expected an
adaptation. It needed less than that: `readonly` is a property of `getArchiveDb()`'s
connection, not of the file, and the harness mints the file read-write before the server
boots — `buildFixtureArchive()` already did. So the Tracker's mechanism transferred
unchanged, nonce included. The Archive's posture is untouched: the app's connection is
still `readonly` + `fileMustExist`.

The rejected alternative is worth keeping visible, because it is the one that looks
adequate: proving the binding by asserting a fixture-only *magnitude* ("9 runs entered"
against production's 13,420). It has no nonce, so a server left running from an earlier
e2e run holds an equally valid 9-run fixture and the check passes against the wrong file.

### Verified, not assumed

- **The canary catches a stale-but-legal Archive.** Pointing `webServer`'s
  `GOS10K_ARCHIVE_DB_PATH` and sentinel at a *previous run's* fixture file — every guard
  satisfied, only the nonce wrong — fails with
  "the running server is not reading this run's fixture Archive". This is the failure the
  env-var layers structurally cannot see.
- **`webServer.env` merges with the runner's environment, it does not replace it.**
  Deleting the two Archive entries from `webServer.env` does *not* repoint the server: the
  `next start` child inherits them from the runner, where `mintFixtureDbPath()` set them.
  The explicit entries are readability and override protection, not the carrier — the same
  is true of the Tracker's two, which read as load-bearing and are not. What *is*
  load-bearing is `FIXTURE_DB_ENV_KEYS`: if the mint never sets them, nothing downstream
  does.

### What is still NOT covered

- **Nothing about `/gos10k`'s behaviour.** By design — #96 builds the harness and one
  smoke test; which behaviours earn assertions is #80 decisions 2 and 4, answered while
  building #87, #88 and #90. The panels those tickets add are unbuilt as of this entry.
  *(Superseded in part by the 2026-09-07 entry below: #86 added three shell specs. The
  panels are still uncovered.)*
- **Still chromium only.** The webkit gap above applies here too.
- **The fixture Archive is 9 Runs and 40 helpers.** #85 widens it. Nothing in this harness
  changes when it does — same loader, same seed file.

## 2026-09-07 — the page shell gets three specs (#86)

`e2e/gos10k-shell.spec.ts` — **new**, three specs, the first assertions about `/gos10k`'s
*behaviour* rather than about the harness.

They cover exactly the two acceptance criteria in #86 that have no other seam:

- **the methodology disclosure is closed by default** — a rendered-DOM property. The spec
  asserts the copy is hidden, clicks the summary, asserts it is visible. Located by the
  summary's words and by a sentence that only exists inside the disclosure, not by
  `details[open]`, so a re-implementation as a linked help section still passes.
- **the shell survives a 360 px viewport** — `documentElement.scrollWidth` against
  `clientWidth` for the page, and the headline element's own `scrollWidth` against its
  `clientWidth` for the clipping half. `test.use({ viewport })` inside a nested describe;
  the other specs stay on Desktop Chrome.

Plus one structural assertion (the headline figure exists and its label names the
population) which exists so the two above have a stable anchor to hang on.

**Two `data-testid`s were added to the page for this** — `archive-headline-figure` and
`archive-headline-population`. Deliberate: the figure is a bare number with no role and no
accessible name, and locating it by its *value* is what #85 is about to break when it
widens the fixture. Everything else in this file is still located by role or by text.

**Verified red first.** All three fail against the pre-#86 page (`git stash` the page,
rebuild, run the file): two on the missing testids, one on the missing headline element.

### Still NOT covered by this entry

- **No counts and no dates.** #85 widens the fixture Archive immediately after #86, and
  every count assertion written now would break for no benefit.
- The panels below the shell. They are #87–#94 and are still the unfiltered placeholders.

---

## 2026-09-08 — `/simplify` pass: the headline's locator changed (#86, #96)

Cleanup pass over the four commits behind #96 and #86. **Spec count is unchanged at 32 and all are
green.** What changed is *how* two things are located, which matters to this file because it is the
record of what the browser suite actually asserts.

**The 2026-09-07 entry above is corrected in two places:**

1. **There is now one `data-testid` on `/gos10k`, not two.** `archive-headline-population` is gone.
   The headline renders as a `<figure>` with a `<figcaption>`, so `e2e/gos10k-shell.spec.ts`'s
   first spec locates it as `page.getByRole('figure', { name: 'Pinned Full Clears' })` — the figure
   takes its accessible name from the figcaption. That spec is now a genuine accessible-name
   assertion rather than a structural anchor, which is a stronger claim than the `toContainText` it
   replaced.

   `archive-headline-figure` **stays**, and the justification in the entry above still holds for it
   alone: the value moves when #85 widens the fixture, so the phone-clipping measurement cannot use
   a text locator. The rest of the suite remains role- or text-located.

   The entry above also says the red-first run failed "two on the missing testids". Re-read that as
   two on the missing headline structure — the mechanism it describes (stash the page, rebuild,
   `e2e:nobuild -- e2e/gos10k-shell.spec.ts`) is unchanged and still the right recipe.

2. **The Archive canary cache-busts by URL, not by a request header.** `archive-canary.setup.ts`
   now requests `/gos10k?canary=<runId>` instead of sending `Cache-Control: no-cache`. The header
   could not have survived #95's cache-lifetime change — Next's route cache and Cloudflare are
   keyed on the URL and neither revalidates because a client asked. **When #87 puts real range
   parameters in this URL, confirm `?canary=` still degrades to the unfiltered view** rather than
   assuming it; #87's own criterion says it should.

Nothing else about coverage moved: still no counts, no dates, no panels, and no seam for the OG
route.

## 2026-09-09 — the range filter gets six specs (#87)

`e2e/gos10k-range-filter.spec.ts` — **new**, six specs. The suite is now nine flows.

The split with Vitest is deliberate and worth keeping: every *number* the filter produces —
which clears a date range contains, which dates a Clear Number range spans, what a malformed
or out-of-range link resolves to — is asserted against the fixture Archive in
`tests/db/archive-range.test.ts` with specific dates and specific Clear Numbers. These specs
assert only what a browser can see:

- **applying one mode drops the other mode's parameters.** The control is two GET forms and a
  browser submits only the form it submitted, so mutual exclusion is a *form-submission*
  property rather than page code. Nothing below the browser can check it.
- the URL round-trip (`?clearFrom=103&clearTo=143` reproduces the view, and the forms write
  those parameters), the "Show the whole Archive" affordance appearing only when filtered,
  a hand-edited link rendering the whole Archive with its note, a preset link, and the
  control at 360 px with no horizontal page scroll.

Asserts **no fixture counts.** The headline is compared filtered-vs-unfiltered rather than to
a number, and 103/143 are typed in by the spec — so #85-style fixture widening leaves this
file alone.

## 2026-09-10 — the fastest-clears panel gets one spec (#91)

`e2e/gos10k-fastest-clears.spec.ts` — **new**, one spec. The suite is now ten flows.

Deliberately *one*. #91 has ten acceptance criteria and nine of them are numbers — the ranking,
the durations, the participant lists, the range scoping — all asserted against the fixture
Archive in `tests/db/archive-fastest-clears.test.ts` with specific instances and specific names.
Exactly one criterion has no other seam:

- **the participant chips wrap rather than overflow at 360 px.** `flex-wrap` is a
  computed-layout fact: the server-rendered DOM carries the class either way, and JSDOM
  reports every element as zero-wide. The spec asserts the chips occupy more than one
  distinct top offset, and that neither the chip row nor the page scrolls sideways.

An earlier draft carried a second spec asserting every row had a non-empty participant list. It
was dropped in review: that is Vitest's fact, and #81 rules browser coverage out of Phase 1
except where a behaviour has no other seam.

Asserts **no fixture counts, no names and no dates**, per #85's lesson.

### One trap this panel introduced

`e2e/support/archive-world.ts` joins the canary helper to **every Run in the seed**, so it now
renders as a chip in all ten fastest-clear rows as well as in its Helper board row. That made
`gos10k-smoke.spec.ts`'s unscoped `getByText(archiveCanaryDisplayName())` strict-mode ambiguous —
eleven matches. It is now scoped to the Helper board **by testid** —
`page.getByTestId('archive-top-helpers').getByText(archiveCanaryDisplayName(), { exact: true })` —
which is where `mintCanariedArchive()` documents the canary as ranking first. (It was briefly
`getByRole('cell', …)`; see the cleanup entry below for why naming the panel beat the role.)

**Any future panel that names players inherits this.** Match the canary by the panel you mean,
never bare text, and never `.first()` — `.first()` would quietly start passing on whichever panel
happened to render first, which is the opposite of what the canary is for.

### What is still NOT covered

- The panels #88–#94 add. Unbuilt.
- Still chromium only.

---

## 2026-09-10 — cleanup pass over #91 (`b84a1fd`)

**Spec count unchanged at 39, all green.** Two things in this file's remit changed.

**1. The canary locator is named, not role-based.** The trap entry above is corrected: the
Helper board carries `data-testid="archive-top-helpers"` and the smoke spec matches inside it.
`getByRole('cell', …)` had the same failure mode as `.first()`, one step slower — it binds to
"whatever is in a `<table>`", so the first panel among #88–#94 to ship as a table would silently
capture the assertion. Naming the panel you mean is the rule; the role was a proxy for it.

**2. `expectNoHorizontalPageOverflow(page)` is now in `e2e/support/viewport.ts`.** The
`documentElement.scrollWidth - clientWidth` probe had been hand-rolled three times — the shell,
the range filter and the fastest-clears panel — each with its own copy of the expression and the
message. How page overflow is *measured* is one decision (does a scrollbar count?), and three
specs drifting apart on it silently is the failure the extraction prevents. **Any new phone
spec asserts the criterion through this helper rather than re-deriving it.** It is Playwright-only
and lives in `e2e/support/`, so unlike `tests/helpers/` it may import from `@playwright/test`.

Note the assertion message lost its viewport: it now reads "the page scrolls horizontally"
rather than "…at 360px", since the helper does not know the viewport its caller set.

---

## 2026-09-12 — the median speed board gets one spec (#92)

`e2e/gos10k-median-speed.spec.ts` — **new**, two specs (one as first landed; the Spec review
added the second, see below). The suite is now **eleven flows, 41 specs, all green.**

Same rule #91 settled on and #80's decision 2 records: *assert only what no other seam can
see.* The medians, the 15-clear floor, the tie-break on the fifteenth row and the empty state
are arithmetic over the fixture Archive and are pinned in `tests/db/archive-median-speed.test.ts`
with named Helpers and specific durations. What is left is the phone criterion — the board is a
three-column table whose first column carries `Name#Code` in full, which is the likeliest thing
on `/gos10k` to push past 360px, and the server-rendered DOM is byte-identical whether it does
or not. The spec measures the table's own box and then the page, through
`expectNoHorizontalPageOverflow()`. It asserts no counts, no names and no durations, so a
fixture re-extraction cannot break it.

**The board is located by `data-testid="archive-median-speed"`**, following the corrected rule
above rather than `getByRole('table')` — there are now two tables on this page and a role
locator would bind to whichever rendered first.

**The canary is on this board too.** `archive-world.ts` joins it to every Run in the seed, so in
the browser fixture it has 346 clears and a median of 974.5 — well past the floor. Nothing
asserts against it here, but a future spec that wants to must scope to the testid above: the
same strict-mode ambiguity #91 hit is now one panel wider.

**Second spec, added by review: the empty state.** #92's criterion is that a range too narrow for
anyone to reach the floor "renders an intelligible empty state rather than a blank panel or an
error", **asserted in a test** — and the Vitest seam can only prove the *query* returns nothing.
This app has no component-test harness (Vitest runs in `node`, no jsdom), and adding one for a
single branch is more machinery than the branch is worth, so the render half is a browser
assertion: `/gos10k?clearFrom=103&clearTo=104` — two clears, so even the canary, which is joined
to every Run in the seed, cannot reach fifteen. It asserts the heading is still there, the table
is *not*, and the reason is stated; heading-plus-reason rather than just "no table", because a
panel that vanished would pass a bare absence check while being the blank panel the criterion
rules out.

---

## 2026-09-12 — cleanup pass over #92 (`8a3d718`)

**Spec count unchanged at 41, all green.** One thing in this file's remit changed.

**`expectNoElementOverflow(locator, what)` joins `expectNoHorizontalPageOverflow(page)` in
`e2e/support/viewport.ts`.** The page-level helper extracted on 2026-09-10 only sees the
document, and an ancestor with its own `overflow` absorbs a too-wide child — so the page can
measure clean while the panel itself is the thing a reader has to drag sideways. That
element-level `scrollWidth - clientWidth` probe had been hand-rolled three times: the shell's
headline figure, the fastest-clears chip row and #92's table, each with its own arithmetic and
its own failure wording. **Any new phone spec asserts the element and then the page, through
these two helpers, rather than re-deriving either.** Note the element helper's message is
viewport-agnostic ("… scrolls sideways at this viewport") for the same reason its sibling's is:
the helper does not know the viewport its caller set.

Outside this file's remit but worth knowing here, because both runners share it:
`tests/helpers/archive-range.ts` now holds `resolveArchiveRangeFromParams()`, the
parse-then-resolve shorthand three DB test files had each written privately. It obeys the
`tests/helpers/` rules — relative imports, no `vitest` — so a Playwright-side caller is possible
if an Archive spec ever needs a resolved range.

---

## 2026-09-12 — the timeline gets three specs, and #80's decision 4 (#88)

`e2e/gos10k-timeline.spec.ts` — **new**, three specs. The suite is now **twelve flows, 44 specs,
all green.**

**This file supersedes #88's own acceptance criterion, deliberately.** That criterion reads
"browser-only behaviour — the shading as the range changes — is verified by hand and recorded as
unverified by automated tests", and it was written when the Archive had no harness at all. #96
built one; #80 calls the timeline's shading "the item with real regression risk". So the shading
is asserted rather than recorded as debt, the hand verification still happened (desktop and 360px
against the production `data/gos-10k.db`), and the choice is written on #80 rather than only here.

**Decision 4 — the assertion style — is: structural, and only about geometry no other seam can
see.** The monthly bucket counts, the empty months and the cumulative total are arithmetic over
the fixture Archive (`tests/db/archive-timeline.test.ts`), and the band's *position on the axis* is
pure arithmetic too (`src/app/gos10k/timeline-geometry.test.ts`). Neither is repeated here. What
the browser asserts is what rendering the band **twice** can get wrong:

- no band at all on the unfiltered page (a band covering everything would read as a selection);
- exactly two bands when a range is active, one per chart;
- the two agree on `x` and `width` to within a pixel — the ticket's "the shading reads across both
  charts because they share an axis", which is a claim about two independently laid-out, non-
  uniformly stretched SVGs and is invisible to Vitest, which sees one geometry object used twice;
- the band is a band and not the whole chart, and sits inside it.

It asserts no counts, no dates and no durations, so a fixture re-extraction cannot break it.

**The phone spec caught a real bug on its first run.** `expectNoElementOverflow` reported 13px of
overflow on the timeline: the last year label starts at ~97% of the axis and four digits at 360px
ran off the right-hand edge. Labels past 90% now end at their boundary instead of starting at it.
That is the second time the element-level probe has found something the page-level one could not.

**Addendum, same day (`c262568`).** The band is now positioned in percentage units straight onto
the `rect`, which SVG resolves against the `viewBox` width, rather than being converted into user
units from an `AXIS_WIDTH` prop. Nothing in the specs changed — and that is the point: the
two-charts-agree assertion is the only thing in the repo that can tell you the two SVGs still
resolve those percentages to the same pixels. A unit change under a chart is exactly the class of
edit that looks right in a diff and renders wrong.

**The timeline is located by `data-testid="archive-timeline"`, the bands by
`data-testid="archive-timeline-band"`** — the latter on *both* copies on purpose, because the
property under test is that there are two of them and they match. Locating an `<svg>` by role is
possible (`role="img"` with an `aria-label` is on both charts) and is how the accessible names are
reachable, but the rects inside have no role of their own.

---

## 2026-09-13 — the Helper board gets five specs, and #80's decision 2 (#90)

`e2e/gos10k-helper-board.spec.ts` — **new**, five specs. The suite is now **thirteen flows, 49
specs, all green.**

**This file supersedes #90's own acceptance criterion, as #88's did.** That criterion reads
"browser-only behaviour — the time-column toggle, the show-all expansion — is verified by hand and
recorded as unverified by automated tests", and it was written assuming both controls would be
client state. They shipped as `<Link>`s into the same URL (`?helperTime=inRun&helperRows=all`, see
`src/app/gos10k/helper-board-view.ts`), so they are server renders this harness already knows how
to drive. "Unverified" is a claim worth making only when it is true; it is not true here, so the
specs exist and the substitution is written on #80 rather than only in a commit message.

**What the specs assert, and what they deliberately do not.** No names, no counts, no durations —
the ranking, the overlap arithmetic and the `Name#Code` fallback are Vitest's
(`tests/db/archive-helper-board.test.ts`), and the URL grammar behind both controls is
`src/app/gos10k/helper-board-view.test.ts`'s. What is left is four things with no other seam: the
default page is **25 rows** and the header reads `Time with him`; the toggle swaps the column
**while `clearFrom`/`clearTo` survive** (a toggle that dropped the range would still swap the
column, and the board under it would silently become the whole Archive's); show-all expands **and
reverses**; and the 360px probe.

**The expand spec failed on its first run for a reason worth writing down.** It read
`board.locator('tbody tr').count()` straight after `click()` and got 25 — a bare `count()` does
not retry, so it measured the pre-navigation DOM. It now waits on the link's own label
(`/^Show the top /`) and then uses `expect.poll`. **Any spec here that clicks a `<Link>` and then
counts something needs a retrying assertion between the two**; `toHaveCount`/`toHaveText` are fine,
`count()` and `textContent()` are not.

**The phone probe found a real bug — but in the hand verification, not in this suite.** Measuring
the *production* Archive at 360px, `?helperRows=all` overflowed the page by 11px while
`expectNoElementOverflow` on the table reported clean: a 31-character unbreakable name (Bungie caps
a name at 26 characters, plus `#dddd`) had made the `w-full` auto-layout table *grow* rather than
scroll, which only `expectNoHorizontalPageOverflow` can see. The name cell is `wrap-anywhere` now —
`overflow-wrap: anywhere` rather than Tailwind's `break-words`, because only the former shrinks a
cell's min-content width, which is what a table sizes its columns from.

This suite would **not** have caught it, and the spec says so in a comment rather than implying
otherwise. The fixture's longest name is `DayMan,Champion of the Sun`, which contains spaces and
wraps on its own; the run-scoped canary in row one is unbreakable but shorter than 31 characters.
The show-all viewport case is in the file as a **guard against regression**, not as a reproduction.
**A future fixture re-extraction that pulls in a long space-free name would turn it into one** — and
if the seed ever wants a deliberate one, `tests/db/archive-fixture-shape.test.ts` is where a cohort
gets widened.

**The canary locator moved with the testid rename**: `archive-top-helpers` is now
`archive-helper-board`. The canary still ranks first — #90 ranks on **clears** present, where its
346 is the fixture maximum and `0000000000000000001` wins the tie — and `archive-world.ts` now
records that its time columns render `0 h`, because the seeded rows leave `start_seconds` and
`time_played_seconds` at 0. **No spec should ever assert a duration on the canary row.**

**Testids added:** `archive-helper-board` (the table), `archive-helper-time-header` and
`archive-helper-board-expand` (their *text* is what changes with the view, so no text locator can
hold them), `archive-helper-time-toggle` (the pill row, for the element-level phone probe). The
pills themselves are located by role and name inside it.

### What is still NOT covered

- The panels #89 and #93–#94 add. Unbuilt.
- Still chromium only.

## 2026-09-14 — the presence strip gets two specs (#89)

`e2e/gos10k-presence.spec.ts`, asserting no figures. The share, both totals, the late-join count and
the envelope over his two characters are Vitest (`tests/db/archive-presence.test.ts`). What is left
for a browser:

1. **The empty state renders.** November 2020 (one Run, no clears) shows "no presence to measure",
   no `archive-presence-strip`, and no `NaN` anywhere in the section. Vitest proves the query
   returns zeroes; only a page proves the panel does not divide them.
2. **Phone width.** `expectNoElementOverflow` on the strip and `expectNoHorizontalPageOverflow`,
   both, per #90's lesson.

Located by `getByRole('region', { name: 'How much of each clear he was there for' })`: the section
is `aria-labelledby` its heading, which makes it a named region. **Testid added:**
`archive-presence-strip` (the figures card, absent in the empty state).

**Checked by hand against the production Archive at 360px** with a `.probe.ts` at the repo root
(since deleted): unfiltered, clears 9,001–10,000 and 2023-08-09 all fit (strip 326/326, page
360/360). Two traps from doing it:

- **`page.goto` timing out is not necessarily a slow sub-resource.** Here it was the server's event
  loop blocked by a synchronous SQLite query that never finished (the first draft of
  `getSubjectPresence`). Symptom: `curl` connects and gets zero bytes, `next-server` at 100% CPU,
  and an unrelated static route like `/faq` hangs too. `kill` (SIGTERM) did nothing while it was
  blocked. The fixture cannot reproduce it, so the suite passed throughout.
- **An element screenshot of a panel below the range filter captures the filter.** The control is
  sticky, and `locator.screenshot()` scrolls the element to the top of the viewport, under it. Use
  a full-page screenshot or scroll the element to the centre first. The bar's colours were not
  visually confirmed for that reason.

### What is still NOT covered

- The participants panel's bar widths and the class split's bars (inline styles from counts Vitest
  pins; nothing asserts they agree visually).
- The presence bar's rendering (colour, fill width). Its width is an inline style from the same share
  the text states; nothing asserts they agree visually.
- Still chromium only.

## 2026-09-15 — #93 Resets panel

`e2e/gos10k-resets.spec.ts`, 2 specs, no figures (the populations and their partition are Vitest's,
`tests/db/archive-resets.test.ts`):

1. **The empty state renders.** `clearFrom=102&clearTo=102` holds one Run and it is a clear: "nothing
   to report", no `archive-resets` card, no `NaN`.
2. **Phone width.** `expectNoElementOverflow` on the card and `expectNoHorizontalPageOverflow`.

Located by `getByRole('region', { name: 'The runs that did not become clears' })`. **Testid added:**
`archive-resets` (the figures card, absent in the empty state).

**Checked by hand against the production Archive at 360px** (a throwaway Playwright script at the repo
root, since deleted; server on :3200, stopped): unfiltered, clears 9,001–10,000, April 2022, clear
5,000 alone and 2023-08-09 all fit (section 328/328, page 360/360). Unfiltered reconciles to #81:
3,352 averaging 7:47, 40 averaging 1:01:02, 20, 8, summing to 13,420. The screenshot was taken with
the panel scrolled to the centre, clear of the sticky filter.


## 2026-09-15 — #94 Participants panel + class split

`e2e/gos10k-participants.spec.ts`, 3 specs, no figures (buckets, the distinct-membership rule, the
duos and the class counts are Vitest's, `tests/db/archive-composition.test.ts`):

1. **The empty state renders.** November 2020 holds one Run and no clear: "nobody to count", no
   `archive-participants` block, no `NaN`.
2. **The column is labelled "People who entered"** and the trio `figure` renders. The label is #94's
   visitor-facing-copy criterion; asserted by role so a header rewording to "fireteam size" fails.
3. **Phone width.** `expectNoElementOverflow` on both panels and `expectNoHorizontalPageOverflow`.

Located by `getByRole('region', { name: 'How many people were in each clear' })`. **Testids added:**
`archive-participants` (the headline + table, absent in the empty state) and `archive-class-split`
(the class list). The old inline class sentence in `page.tsx` is gone.


## 2026-09-24 — #108 the range filter's collapsed bar and `xl` rail

`e2e/gos10k-range-filter.spec.ts`, **five new specs** alongside #87's six, no figures:

1. **Phone (360×780): stuck below the nav and within budget.** Scrolled past the header, the bar's
   top sits flush against the site nav's bottom (±1px) and its height is ≤15% of the viewport. The
   summary and "Show the whole Archive" are visible and the forms are not.
2. **Phone: expand, apply, collapsed again.** "Change range" reveals both fieldsets and the presets
   with no page overflow. Applying a Clear Number range is a full navigation that lands collapsed,
   with the new range in the summary.
3. **Phone: degraded, collapsed.** The notice is visible with the forms hidden, and the bar is
   *still* stuck and within the 15% budget. That is why the notice is now one short line: "Invalid
   range — showing the whole Archive." The old two-sentence notice took the bar to ~126px (16%).
4. **1024×768: stuck below the one-row nav.** The only width that exercises the `lg` offset.
5. **1280×900: the rail.** No visible toggle, both fieldsets and the presets visible, the rail ends
   left of the column, and the pair (rail left edge to column right edge) is centred in `main` to
   within 1px. Scrolled, the rail is stuck 24px (1.5rem) below the nav.

`gos10k-shell.spec.ts`'s #111 centring spec moved from 1280 to **1024**: from `xl` the column is off
centre by design, and the pair-centring above replaces it there.

**Found while doing it: the filter had always stuck *under* the site nav.** `body > nav` is itself
`sticky top-0 z-50`, so #87's `sticky top-0 z-10` control slid underneath it. At 360px the nav is
132px tall, and the heading, summary and clear link were hidden once stuck. Nothing asserted a
sticky element's position before this. The filter's `top` is now the nav's height, hardcoded per
breakpoint (8.25rem below `lg`, 5.75rem from `lg`, 7.25rem in the rail), and specs 1, 4 and 5 are
what notice if the nav's height changes.

**The rail is the same `<details>` as the bar.** `.archive-range-disclosure` in `globals.css`
overrides `::details-content` to `content-visibility: visible` and hides the `<summary>` from `xl`,
behind `@supports selector(::details-content)`. Existing specs at the default Desktop Chrome
viewport (1280×720) therefore reach the forms without expanding anything. A spec at a narrower
width must click "Change range" first.

**Shared helper added:** `boxOf(locator)` in `e2e/support/viewport.ts`, a `boundingBox()` that fails
loudly on an unrendered element. Adopted by the range-filter and shell specs. The timeline spec still
has its own null checks, left alone because #113 rewrites that geometry.

### What is still NOT covered

- Browsers without `::details-content` (Safari < 18.4, Firefox < 143). There the rail keeps its toggle
  and loads collapsed. Still chromium only.
- The summary line truncates at 360px. Nothing asserts how much of the date half survives.


## 2026-09-24 — #112 Overview / Rankings / Participants tabs

`e2e/gos10k-tabs.spec.ts`, **new**, five specs, no figures. The suite is now **seventeen flows,
68 tests including the two canary setups**.

1. **Opens on Overview**, with the headline, the filter and the timeline above the strip. The
   Overview link has `aria-current="page"`, and it is the only link that does.
2. **Each tab renders exactly its own panels.** Located by `h2` name (`exact`). A tab's own headings
   are visible and every other tab's have count 0. `?tab=helpers` renders Overview.
3. **Range and tab survive each other.** At 1280×720, so the rail's forms are open. Under a Clear
   Number range, click Rankings: the range is kept. Apply a date range: `tab=rankings` is kept and the
   Clear Number pair is still dropped. Switch to Participants, then apply a Clear Number range, a
   preset and "Show the whole Archive": `tab=participants` survives each. URLs are matched to `$`, so
   a stray parameter fails.
4. **Leaving Rankings drops the Helper board's view.** Start on `helperTime=inRun&helperRows=all`,
   click Participants: only range + tab remain. Back on Rankings, the board is 25 rows with
   "Time with him".
5. **Phone (360×780): the strip is one row**, with no element or page overflow.

**Moved to `?tab=`:** the helper-board, fastest-clears, median-speed and participants specs, and
**the smoke spec and the Archive canary.** The canary Helper renders only in the Helper board and
Fastest clears, which are both on Rankings now. On the first run the canary setup failed with "not
reading this run's fixture Archive" and all 66 specs were skipped. The server was fine; Overview
simply names nobody. `archive-canary.setup.ts` now requests `/gos10k?tab=rankings&canary=<runId>`.

**`expectStuckBelowNav` in the range-filter spec** scrolled to "Fastest clears", which is on Rankings
now. It scrolls to Overview's last panel ("The runs that did not become clears") instead.

**The shell spec's no-"Pinned" test** loops over all three tab URLs, since each renders only its own
panels.

### What is still NOT covered

- That only the active tab's queries run. That is structural: each tab is a component in `page.tsx`
  that reads its own data, and the page renders one of them. No spec observes SQL.
- The range forms carrying `tab` below `xl`. Spec 3 runs at 1280, and the forms are the same markup
  at every width.


## 2026-09-24 — #113 the timeline zooms to the range, and the band moves to an overview strip

`e2e/gos10k-timeline.spec.ts`, **rewritten**, five specs where there were three, no figures. The
suite is still **seventeen flows**, now **71 tests including the two canary setups** (as counted by the 2026-09-24 run). The flow is
now "the timeline's zoom to the range with its shaded whole-Archive overview strip". It used to be
"the shaded band across both charts".

1. **Unfiltered:** `archive-timeline` is visible, and there is no `archive-timeline-overview` and no
   `archive-timeline-band`.
2. **Under a range (clears 103–143):** `archive-timeline-zoomed` and `archive-timeline-overview`
   are both visible. There is exactly **one** band, inside the overview strip. The strip sits below
   the zoomed chart. The band is narrower than a quarter of the strip and lies inside it.
3. **A range with Runs but no Full Clears (2–5 Apr 2022):** `archive-timeline-no-clears` is
   visible. There is no zoomed chart, and the strip and its band are still there.
4. **Phone (360×780), clears 103–143:** no element or page overflow, and the band is at least 3px
   wide.
5. **Phone, one range per bucket size:** days, weeks (12 Jan – 3 May 2022, where the widest
   `Mar 2022` labels are) and months (15 Jul 2020 – 2 Aug 2022). No element or page overflow at
   any of them.

**On `boxOf()` now**, the deferred #108 finding. The spec's own null checks are gone.

**Test IDs:** `archive-timeline` is still on the chart block in both states, which the tabs spec
relies on. `archive-timeline-band` is on the strip's one band only. `archive-timeline-zoomed`,
`archive-timeline-overview` and `archive-timeline-no-clears` are new.

**Found by looking, not by a spec:** on the strip, the band drawn *under* the bars was a
one-pixel sliver beside February's bar, because a busy month's bar fills 70% of its slot. It is
now drawn over the bars at a higher opacity. No spec asserts how visible the band is. The 3px
width check can't see colour, so this was checked by screenshot in light and dark.

### What is still NOT covered

- Where the zoomed chart's labels actually land. Positions and thinning are Vitest
  (`timeline-geometry.test.ts`). The browser only checks for overflow.
- Whether the band stands out from the bars it covers (see above).

## 2026-09-24 — #114 the timeline's hover and tap tooltips

`e2e/gos10k-timeline.spec.ts` gains a `the timeline's tooltips (#114)` block: seven specs, twelve in
the file. The suite is now **eighteen flows**, **78 tests including the two canary setups** (as
counted by the 2026-09-24 run). The new flow is "the timeline's hover and tap tooltips, with the
chart still drawn when JavaScript is off".

Tooltip text is matched **by shape, never by figure**, under the same no-counts rule as the rest
of the file: `LINE_TOOLTIP` is `Clear N · <bucket>` or `No clears yet · <bucket>`, `BAR_TOOLTIP`
is `<bucket> · no clears | 1 clear · #N | N clears · #N–#N`. The exact copy is Vitest's:
`src/app/gos10k/timeline-tooltips.test.ts` on hand-built buckets, and a block in
`tests/db/archive-timeline.test.ts` over the real fixture reads.

1. **Line hover, unfiltered:** no tooltip before the pointer arrives; hovering halfway across the
   line shows a line-shaped tooltip; moving to the heading removes it.
2. **Bar hover, clears 103–143:** the line and then the bar are hovered at the same x (a tenth of
   the way across, inside the third day). The bar tooltip is bar-shaped, and its bucket name equals
   the line tooltip's — the "slot under the pointer, not the nearest vertex" decision.
3. **The overview strip is inert:** hovering it shows nothing.
4. **Phone (360×780), both ends:** unfiltered, weeks (12 Jan – 3 May 2022, the longest names) and
   months (15 Jul 2020 – 2 Aug 2022); line and bar; 0.1% and 99.9% across. The tooltip box lies
   inside the timeline's box and inside 360px, and the page does not overflow. Mutation-checked:
   with the clamp removed it fails at `/gos10k, line, 0.001` (left edge −37.6px).
5. **Touch (360×780, `hasTouch`):** `tap()` on the bars shows a bar tooltip; a tap on the line
   switches it to the line's; a tap on the heading dismisses it; the URL is unchanged throughout.
6. **Touch, the chart changes width:** a tooltip tapped open near the right-hand end closes when
   the viewport goes from 360 to 320px, and the page does not overflow. Added in review; red
   against the pre-fix build.
7. **JavaScript disabled:** at `/gos10k` and clears 103–143 both chart SVGs are visible *by their
   accessible names* (`Cumulative Full Clears…`, `Full Clears per month|day…`), and hovering the
   bars shows no tooltip.

**Test hooks:** `data-timeline-part="line" | "bar"` on the main chart's two SVGs (never the
strip's) — the client wrapper reads it to tell the halves apart, and the specs locate by it.
`archive-timeline-tooltip` (also `role="tooltip"`) exists only while a tooltip is showing.

**Tried and dropped:** asserting the hover makes no network request, for #81's no-client-fetch
rule. Next's `<Link>` prefetches (`?_rsc=`) for the page's other links land in the same window
and cannot be told apart from a fetch the timeline might make without depending on timing. The
rule is kept by construction instead: `TimelineHover.tsx` has no fetch and receives its strings as
props (moved to src/components/chart/ChartHover.tsx by #193).

**Tried and dropped (review round):** a touch tap in the 4px gap between the two SVGs, meant to
prove it dismisses. Chromium's touch adjustment retargets a finger tap there onto the nearer SVG
(`elementFromPoint` says the wrapper div; the `pointerdown` target is an `svg`), so a finger
cannot land in the gap and the spec could not fail. The dismiss-in-the-gap code stays for pens,
which Playwright cannot emulate. Also found there: `touchscreen.tap()` takes viewport coordinates,
so boxes measured before a locator `tap()` scrolled the chart into view point elsewhere — the
first draft of that spec passed against the pre-fix build for exactly that reason.

**Found by looking:** an element screenshot taken *after* a hover scrolls the section into view,
and Chrome re-hit-tests the mouse after a scroll, so the tooltip correctly disappears. Scroll
first, then hover, then screenshot.

### What is still NOT covered

- Keyboard-reachable tooltips — out of scope, #58.
- Real touch hardware. `hasTouch` + `tap()` drives Chromium's touch emulation, which produces
  `pointerType: 'touch'` events; iOS Safari's own quirks are not exercised.
- A finger that starts a scroll on the chart (should get `pointercancel` and no tooltip).
- Pen input, including a pen tap in the gap between the line and the bars.
- Whether the tooltip reads well against the chart in each theme — checked by screenshot at
  1280/360 in light and dark, not asserted.


## 2026-09-24 — #115 drag across the timeline to set the range

`e2e/gos10k-timeline.spec.ts` gains a `dragging across the timeline (#115)` block: ten specs, twenty-two
in the file. The suite is now **nineteen flows**, **88 tests including the two canary setups** (as
counted by the 2026-09-24 run). The new flow is "the timeline's mouse drag setting the range from
the main chart or the overview strip, with a touch swipe still scrolling the page".

**Dates are named here, unlike the rest of the file.** Which dates a drag writes *is* the
behaviour, so each spec expects exact outer bucket edges on the fixture's axis. The Archive runs
4 July 2020 – 23 February 2026: 68 monthly slots. `WEEKS` (12 Jan – 3 May 2022) is 17 weekly slots
from Monday 10 January. The pointer is put in the *middle* of a slot (`slotFraction()`), never on a
boundary.

1. **Main chart, weeks:** press in week 1 and move to week 3. The selection overlay
   (`archive-timeline-drag-span`) is visible, starts at the bars' left edge and is 3/17 of their
   width. The hover tooltip is hidden and **no navigation yet**. On release the URL is
   `?from=2022-01-10&to=2022-01-30`: outward past the range's own 12 January, and `to` is Sunday
   the 30th, an inclusive day. The heading becomes "The range, day by day", and only *then* is the
   navigation list checked to be exactly that one URL, so a late second push would be counted.
2. **Right to left on the line:** week 9 back to week 4 gives `2022-01-31` → `2022-03-13`.
3. **Overview strip:** July 2020 to May 2023 gives `?from=2020-07-04&to=2023-05-31`, wider than the
   range and clamped to the Archive's first day. One navigation, counted after the strip's caption
   reads `Shaded: 4 Jul 2020 – 31 May 2023.`
4. **Under a Clear Number range** (clears 103–143, 21 daily slots): the 3rd to the 7th gives
   `?from=2022-02-03&to=2022-02-07`, with no `clearFrom`/`clearTo`.
5. **Tab kept, Helper params dropped:** from `?tab=rankings&helperTime=inRun&helperRows=all`,
   unfiltered monthly, March to June 2022 gives `?from=2022-03-01&to=2022-06-30&tab=rankings`.
6. **Sub-threshold press:** 3px sideways shows no overlay and doesn't navigate. Absence is proved
   by what comes next: a real drag afterwards must be the **only** navigation recorded.
7. **Escape:** mid-drag, the overlay goes. Releasing afterwards doesn't navigate (proved the same
   way).
8. **Lost pointer capture** (added in review): mid-drag, the capture is released by hand
   (`releasePointerCapture(1)`, Chromium's mouse) and the mouse moves on over the chart. The drag
   span goes, and the release doesn't navigate.
9. **A drag onto the range already showing** (added in review): all seven days of
   `?from=2022-01-31&to=2022-02-06` write that same URL, so nothing navigates. The next drag must be
   the only navigation.
10. **Touch (360×780, `hasTouch`):** a thumb swipe up and across the bars, sent as raw CDP
    `Input.dispatchTouchEvent` points, scrolls the page with no overlay. Absence of a navigation is
    proved by tapping the Rankings tab afterwards: it must be the only navigation, under the range
    as it was.

**Mutation-checked:**
- `touch-none` on the drag wrapper fails 10.
- A 0px threshold fails 6.
- A removed Escape listener fails 7.
- A removed `onLostPointerCapture` fails 8.
- A removed same-URL check fails 9.

**Traps found writing these:**
- At 1280×720 the main chart's bars sit across the viewport's bottom edge (y 696–744).
  `page.mouse` presses at viewport coordinates, so a spec that measures the bars without
  `scrollIntoViewIfNeeded()` presses on `<html>`. `hover()` scrolled for the #114 specs.
- CDP `Input.synthesizeScrollGesture` with `gestureSourceType: 'touch'` scrolled nothing, not
  even over a heading. `Input.dispatchTouchEvent` does: `pointerdown` then `pointercancel`, and the
  page scrolls.
- **Next rewrites the loaded page's history entry at hydration**, which Playwright reports as a
  `framenavigated` to the same URL. Record navigations only after the page's script is running
  (`waitForTimelineScript()`); the first draft of the touch spec counted it.
- **`lostpointercapture` is not delivered when `releasePointerCapture()` is called.** It waits
  for the next pointer event. A spec that asserts straight after the release sees the drag still
  drawn; move the mouse first.
- `npx playwright test` (and `npm run e2e:nobuild`) serves whatever `.next` holds. After a
  mutation run, rebuild before any scratch spec, or it tests the mutation. That cost one false
  "Escape doesn't cancel off-chart" chase.

**Test hooks:**
- `archive-timeline-drag-span` exists only while a drag is drawn. It was `…-selection` until the
  review: CONTEXT.md reserves "selection" against the Shaded Band, which sits beside it on the strip.
- The drag wrapper carries `data-dragging` while dragging. The tooltip hides under it through a
  Tailwind `group/drag` variant; that's how the two client components stay apart.

### What is still NOT covered

- A drag released outside the browser window (pointer capture should end it; not driven).
- A real context menu or window switch mid-drag: spec 8 stands in for them by releasing the
  capture by hand.
- Pen input: a pen never drags, by `pointerType !== 'mouse'`, which Playwright can't emulate.
- Whether a *horizontal* finger swipe on a real phone drags: emulation cancels the pointer as
  soon as the page takes the gesture, so spec 8 would pass even if touch were allowed to drag.
  The mouse-only check in `TimelineDrag.tsx` is what keeps it out.
- The selection overlay's look in each theme: checked by screenshot at 1280 in light and dark,
  not asserted.

## 2026-10-03 — #132 the leaderboard's Fastest Clears tab

`e2e/leaderboard-fastest.spec.ts`, **new**, five specs. The suite is now **twenty flows, 94 tests
including the two canary setups**.

**Seed world:** every `LEADERBOARD_PLAYERS` entry now carries `clearTimes`, one per run. They're
chosen so each raid's Fastest Clears order is the reverse of its Full Clears order, and so Alpha's
and Echo's fastest run is not their first. The expected boards are exported as `FASTEST_CLEARS`.
Counts are unchanged, so the existing leaderboard and player-name specs are unaffected.

1. **`?board=fastest` opens the tab, and switching writes the URL without a reload.** `aria-current`
   on exactly one link, the subtitle and the Clear Time column follow the tab. A `window` mark set
   before the first click must survive both switches, one by click and one by keyboard (focus + Enter).
   Back returns to Full Clears.
2. **An unknown `?board=` is Full Clears**, with the Clears column.
3. **The View toggle is hidden, and a stored Total Clears is left for Full Clears.** Storage still
   reads `aggregate` while on Fastest Clears; returning sends `mode=aggregate` and the toggle is active.
4. **The request sends `board=fastest` and no `mode`, and both raid boards render in Clear Time
   order.** Total Clears is pre-stored, so a route that didn't force per-raid would return one
   aggregate board with no raid headings. This is the route's only coverage (#130 left out route tests).
5. **Phone (360×780):** the strip is one row, and neither the board's table, the Clear Time heading,
   nor the page scrolls sideways.

**Mutation-checked (each rebuilt):**
- A route that ignores `board` fails 1, 3, 4 and 5.
- Plain `<a>` tabs (full reload) fail 1 and 3.
- Sending `mode` on Fastest Clears fails 4.

### What is still NOT covered

- The maintenance message on Fastest Clears. It needs the database in maintenance, which the e2e
  server can't be put into. The route returns `{ board: 'fastest', maintenance: true, leaderboards: {} }`
  and the page swaps the board for "Fastest Clears are unavailable during maintenance"; neither is driven.
- The Fastest Clears empty state ("No Completions match these filters"). It's visible on every
  unseeded raid in a screenshot, but not asserted.
- Ties on the rendered board. Rank sharing is pinned in `tests/db/fastest-clears.test.ts` only.

## 2026-10-04 — #133 the Fastest Clears Clear Time link and date tooltip

`e2e/leaderboard-fastest.spec.ts` gains one test, so it now holds **six**. The suite is **95 tests,
including the two canary setups**.

6. **The Clear Time links to raid.report and shows the run's date.** Echo's `21:00` on Crota's End
   links to `https://raid.report/pgcr/900011` (her second, fastest run) with
   `target="_blank" rel="noopener noreferrer"`. Under `timezoneId: 'Asia/Kathmandu'` and
   `locale: 'en-GB'`, its accessible description and its `role="tooltip"` both show that run's local
   day, year and HH:MM, worked out by hand from `endedAt` in the page's own response. The tooltip is
   hidden at rest, shown on hover, hidden on mouse-out, and shown again when Tab moves focus from
   the player name to the time.

`expectBoardRows` now reads the player from the first link in the row and the time from the last
cell's link, because the cell also holds the tooltip text.

**Mutation-checked (each rebuilt):** formatting the date in UTC fails the description; dropping
`peer-focus-visible:block` fails the focus step.

### Still NOT covered

- Touch: tapping the time opens raid.report. No tap tooltip exists, and none was asked for.
- Whether raid.report's page itself loads. The test checks only the `href`; the format comes from
  raid.report's route table (`/pgcr/:activityId`).

## 2026-10-14 — #156 the active-sessions raid sections' fixed order

`e2e/active-sessions-order.spec.ts`, **new**, three specs. The suite is now **twenty-one flows, 98
tests including the two canary setups**.

Raid sections on `/active-sessions` are grouped by `raidKey` and sit in the page's `AVAILABLE_RAIDS`
order (the raid filter's), with any key the list doesn't know last. They used to be grouped by display
name and sorted busiest-first.

**Seed world:** `seedFireteams` takes any `FixtureRaid`, not only `RAID_A`/`RAID_B`. Four new raids,
under fixture namespace **86** with one sub-prefix each (`861`–`864`) so their rosters can't share a
membership id:
- `ORDER_EARLIER_RAID` (Vault of Glass, 1 fireteam) and `ORDER_LATER_RAID` (Deep Stone Crypt, 3).
  No other spec seeds them, so the counts hold whatever other files leave live on `RAID_A`/`RAID_B`.
- `UNLISTED_RAID` (key `e2e_unlisted_raid`, 4 fireteams) and `UNLISTED_NAMESAKE_RAID`
  (`e2e_unlisted_namesake_raid`, 1). Their hashes (1 and 2) are in no raid definition, so the API
  names both after activity mode 4 and both headings read **"Raid"**.

1. **Sections follow the raid list, not fireteam counts.** Deep Stone Crypt has more fireteams than
   Vault of Glass and still renders below it.
2. **An unlisted raid key renders after every listed raid**, though it is the busiest seeded raid.
3. **Two raid keys with one display name stay two sections**: two "Raid" headings, not one.

The assertions compare positions among `h2`s, the page's only section headings, so they don't depend
on which sections other spec files have left live.

**Verified red first:** with the pre-#156 `page.tsx` all three fail. The page rendered
`Raid, Deep Stone Crypt, Vault of Glass` (busiest first) and merged the two "Raid" sections into one.

### What is still NOT covered

- Order stability *across a refresh* as counts change. The specs check one render; the order no longer
  depends on counts, so a second render can't differ, but no spec changes counts between polls.
- A `null` `raidKey` (a raid-mode activity whose hash no raid definition knows). The page groups it
  under `''`, which sorts with the unknown keys. Seeded keys are always strings.
- Tile view loses its e2e coverage under #157, when list view becomes the default (tracked on #153).

## 2026-10-14 — #157 list view by default, the List | Tiles toggle, Fireteam Leader rows

`e2e/active-sessions-list.spec.ts`, **new**, eight specs (the eighth added after the #157
review); `active-sessions-cap.spec.ts` and `player-names.spec.ts` changed. The suite is now
**twenty-two flows, 106 tests including the two canary setups**.

`/active-sessions` opens in list view: one row per fireteam, "`<Fireteam Leader Name#Code>`'s
fireteam", with `N/6` and the elapsed time. A List | Tiles toggle switches views, and the choice is
kept in localStorage. Each raid section is now a `<section>` labelled by its `h2`, so specs find a
section's rows with `getByRole('region', { name })`; the `h2` text is unchanged, so the #156 order
spec's `sectionHeadings()` didn't need to change.

**Seed world:** `seedFireteams` takes `leaderSeat`, which seeds that member with status 9
(FireteamMember 1 + PartyLeader 8). Without it every member is status 1 and the fireteam has no
leader. `LIST_RAID` (Garden of Salvation) is a raid only this spec seeds. Fixture namespace **87**:
`871` for two six-player fireteams with the leader in seat 2, `872` for one solo player with no
leader, who started most recently and has a 26-character name, the longest a Bungie Name can be.

1. **List view on a first visit**: three rows in the section, no tile headings, "List view" pressed.
2. **The toggle's halves** carry the tooltips "List view" / "Tile view", an `aria-label` and `aria-pressed`.
3. **Tile view survives a reload**, `aria-pressed` included, and List switches back.
4. **A row is titled after its Fireteam Leader** (seat 2, so not the first member or the tracked
   player by accident), links to their player page, and shows `6/6` and `1h Nm`.
5. **No flagged leader → the tracked player** (the solo row), with `1/6` and `3Nm`.
6. **Rows keep the API's order**: both six-player fireteams, newest first, then the solo player,
   who started last.
7. **At 360px**, the toggle and the long-named solo row sit inside the viewport, the row doesn't
   scroll sideways and neither does the page, and the row's title is one line tall. Before the
   #157 review it measured the first row, whose name is short. With both `min-w-0` and `truncate`
   dropped from the title, that version passed and this one fails (the row scrolls sideways by
   78px). The one-line check is what catches `truncate` dropped alone: the title then wraps
   (40px tall against a 20px line), so nothing scrolls sideways, but the unbreakable `Name#Code`
   spills over the player count. `min-w-0` dropped alone still passes, correctly: `truncate`'s
   `overflow: hidden` already lets the title shrink.
8. **The toggle when saving fails**: the first save of the view throws `QuotaExceededError` (other
   keys save normally). Tiles is still pressed after the click, and a later List click, whose save
   works, wins. Added after the #157 review: the in-memory fallback once kept the failed pick for
   the rest of the visit, and this spec fails with the line that clears it removed.

**Changed:**
- `active-sessions-cap.spec.ts` proves ADR 0001 by counting **list rows**: 8 fireteams of 6 render 8
  rows, not 48. It counts only rows inside the Salvation's Edge region whose title is one of its own
  `81` players. The client-write specs leave sessions live on the same raid, so a section-wide count
  would depend on file order or a retry.
- `player-names.spec.ts` seeds its fireteam's leader in seat 3 and checks that leader's full
  `Name#Code` in the row title (a link). Before #157 it checked seat 0's name on a tile.

Which member leads, the tracked-player fallback and "Unknown player" for a raw membership ID are
Roster rules in `src/lib/active-session/roster.ts`, covered by Vitest
(`roster.test.ts`), not here.

**Verified red first:** against the tile-only page (commit `958bfcd`), 9 of the 22 active-session
tests failed: all seven list specs, the cap spec's row count and the player-names row title. The
toggle's hook was also checked against the `useState`-initializer pattern the leaderboard's prefs
use. With it, after a reload in tile view, "Tile view" kept the prerendered `aria-pressed="false"`,
and spec 3 failed.

### What is still NOT covered

- **Tile view lost its per-fireteam e2e coverage.** The cap spec's "one per fireteam" count and the
  player-names roster check now run in list view only. Spec 3 shows tiles render, three per section,
  and nothing more. Restoring tile coverage is tracked on **#153**.
- "Unknown player" with the ID in a tooltip, in a browser: it is covered by Vitest only. Seeded
  names always resolve.
- The toggle when localStorage can't even be read (`getItem` throws too, as in some private
  modes). Spec 8 covers a failed save only; the read-failure path was checked once by hand with a
  throwaway spec during the #157 review.
- A row's other cells overlapping each other. Spec 7 checks only that the title stays one line,
  which is the overlap a long name causes; nothing measures the count against the elapsed time.
- Rows on refresh: the 30-second poll and Refresh re-render the rows, but no spec changes data
  between polls. Open rows across refreshes are #158.

## 2026-10-15 — #158 expandable list rows that stay open across refreshes

`e2e/active-sessions-expand.spec.ts`, **new**, eight specs; `player-names.spec.ts` gains one, and
the cap, list and player-names specs read rows through a narrower locator. The suite is now
**twenty-three flows, 115 tests including the two canary setups**.

A list row on `/active-sessions` expands to show the rest of its Roster: every member except the
one the row is titled after (the leader, else the tracked player, "Unknown player" included), each
once, as a `Name#Code` link to their player page. A click anywhere on the row toggles it, except on
a link or button inside it; the chevron is a real button with `aria-expanded` and `aria-controls`.
The page keeps the open rows by **session identity** (raid + member set, one Roster containing the
other counting as the same fireteam) and re-anchors them to each poll, so they stay open across
Refresh and the 30-second poll.

**Locators:** an open row's member list is a nested `<ul>`, and its items are `listitem`s too.
`e2e/support/fireteam-rows.ts` (`fireteamRows(section)`) reads only the section's own `ul > li`,
and the cap, list and player-names specs use it, so ADR 0001's "8 rows, not 48" can't pick up
member items. No existing spec opens a row, so the old locator would still have passed today; the
helper keeps it that way once one does.

**Seed world:** `EXPAND_RAID` (Last Wish), a raid only this spec seeds, because the growth spec
reseeds a fireteam partway through. Fixture namespace **88**: `881` for two six-player fireteams
with the leader in seat 2, `882` for a five-player fireteam (leader in seat 0) that grows to six,
`883` for a tracked player with no leader and five other members, all with 26-character names,
and `884` for a fireteam of one (added by the review fixes below).

1. **A click on the row opens and closes it** (on the player count, then the elapsed time), the
   chevron's `aria-expanded` follows, and the open row lists the five non-leader members, in Roster
   order, as links to `/player/3/<id>`.
2. **The chevron works from the keyboard**: Enter opens the row, and `aria-controls` names the list.
3. **Clicking the title link doesn't toggle the row.** The spec cancels the navigation itself, so
   it can check the row afterwards.
4. **The title link still navigates** to the leader's player page. The player page is answered with
   a stub, because the real one calls the client-write endpoints for this spec's players on load.
5. **Several rows open at once.**
6. **An open row stays open after Refresh**, and a closed one stays closed.
7. **An open row stays open when a member joins** between refreshes: `882` is reseeded as six, the
   row shows `6/6`, is still open, and lists the newcomer.
8. **At 360px**, the open `883` row (five 26-character names) doesn't scroll sideways, nor does the
   page, every member ends inside the viewport **and shows its whole name**, and the row's title is
   still one line tall. The whole-name check came from a break that got past the first version:
   members laid out in one line overflow nothing, because each name truncates into a stub (211px of
   name cut off). Moving the member list inside the truncated title is caught the same way (160px).

`player-names.spec.ts`: a new test opens its row and checks seat 0's full `Name#Code` link in the
member list. Seat 0 isn't the leader, so it reaches the screen only through that list.

Which member is left out, session identity under growth, shrinkage and a tracked-player change,
and re-anchoring across polls are Roster rules in `src/lib/active-session/roster.ts`, covered by
Vitest (`roster.test.ts`), not here.

**Verified red first:** against the collapsed-only rows (commit `d70253c`), 8 tests failed: seven of
the eight expand specs and player-names' expanded member. Spec 4 passed, as it should: the link
already navigated, so it guards against the row's click handler swallowing it. Each spec was then
also shown failing against a targeted break of the finished code (the #158 progress notes list
them), for example spec 7 alone with open rows matched on the exact member set, and spec 8 with
the member list moved inside the truncated title or laid out in one line.

### What is still NOT covered

- The 30-second poll itself. Refresh runs the same fetch, so spec 6 stands in for it; no spec
  waits out or fast-forwards the timer.
- A Roster that **shrinks** between refreshes, in a browser. Vitest covers the rule, and spec 7
  covers the same page path for growth; no spec reseeds a smaller Roster.
- An open row whose fireteam leaves the page and comes back: it comes back closed, by design
  (`followOpenSessions` forgets it). Not asserted anywhere.
- A raw-ID member in the open list. It renders the ID, as tiles do; seeded names always resolve.
- Tile view, still (#153). Only its React key changed.

### Review fixes (same day)

Two more expand specs, so the file has **ten** and the suite **117 tests including the two canary
setups**, still twenty-three flows.

9. **An open row survives a maintenance response.** The next `/api/active-sessions` answer is
   stubbed with `page.route` as a maintenance response (no sessions, `maintenance: true`), then the
   route is lifted and Refresh brings the fireteam back still open. Red before the fix: the row came
   back closed (`aria-expanded` "false").
10. **A fireteam of one (`884`) offers nothing to open**: no chevron, a click on the row opens no
   list, and its elapsed time ends at the same x as on a row with a chevron (a placeholder keeps the
   columns aligned). Red before the fix: the chevron was there. The alignment check was also shown
   red with the placeholder's width removed (1219 against 1195).

Not covered: a row opened as two players that shrinks to one. The page still holds it open, and
the row hides the list because it has nobody to list; no spec reseeds that.

## 2026-10-15 — #159 collapsible raid sections, Collapse all / Expand all

`e2e/active-sessions-collapse.spec.ts`, **new**, thirteen specs; `e2e/support/fireteam-rows.ts`
changed. The suite is now **twenty-four flows, 130 tests including the two canary setups**.

Each raid section's `h2` on `/active-sessions` holds a `<button type="button">` with
`aria-expanded` and `aria-controls`, so the section collapses and expands, in list view and tile
view. A click anywhere on the header row (the count included) toggles it too, like a list row. The
`h2`'s text is still the bare raid name (the chevron is an `aria-hidden` SVG, and the count sits
outside the `h2`), so the #156 order spec passes unchanged. `aria-controls` names the section's
content wrapper, `raid-section-<raidKey>-content`, which stays in the page with `hidden` while
collapsed; its rows or tiles are unmounted. A **Collapse all** button beside Refresh reads
**Expand all** only when every visible section is collapsed, and is disabled when no section is
visible. Collapse state is in memory, by `raidKey`: it survives Refresh and a maintenance response,
not a reload, and a section that leaves the page (its raid has no sessions, or the raid filter hides
it) is forgotten, so it comes back expanded.

**Locators:** the list now sits one level deeper, inside the content wrapper, so `fireteamRows` is
`:scope > div > ul > li`, still the section's own list and nothing nested in a row. The old
`:scope > ul > li` fails loudly (the cap spec: "Expected: 8, Received: 0"). A descendant `:scope ul
li` is caught by spec 12, which counts rows with one open ("Expected: 2, Received: 7"). The cap spec
alone would not catch it, because none of its rows is open.

**Seed world:** `COLLAPSE_RAID` (Root of Nightmares) and `COLLAPSE_OTHER_RAID` (King's Fall), two
raids only this spec seeds, and `UNSEEDED_RAID` (Vow of the Disciple), which **no spec may ever
seed**: spec 11 filters to it to get a page with no sections. Fixture namespace **89**: `891` for
two six-player fireteams on Root of Nightmares with the leader in seat 2, and `892` for one
four-player fireteam on King's Fall. Since the review fixes below, also `893` for one three-player
fireteam on `REAPPEAR_RAID` (The Desert Perpetual), a third raid only this spec seeds, which
spec 14 ends and reseeds. The specs about "every visible section" first filter the page
to this file's two raids through the raid filter's own dropdown, because other files leave their
sections live.

1. **A header click collapses and expands a section in list view**; while collapsed, the `h2` and
   "2 sessions" are still visible. The second click lands on the count, so the whole header is
   the target.
2. **The same in tile view**: two tiles (`h3`s), then none, then two.
3. **A collapsed section stays collapsed after Refresh**, and the other one stays expanded.
4. **A reload expands every section again.**
5. **Collapse all collapses every visible section** and then reads Expand all, which reverses it.
6. **The button reads Collapse all while any visible section is expanded**, Expand all once the
   last is collapsed, and Collapse all again once one is reopened.
7. **A section the raid filter brings in starts expanded** (after Collapse all), the button goes
   back to Collapse all, and the already-collapsed section stays collapsed.
8. **A section the filter hides and shows again comes back expanded.**
9. **The header from the keyboard**: Enter collapses, Space expands, and `aria-controls` resolves to
   one element, hidden while collapsed.
10. **Collapse state survives a maintenance response** (stubbed with `page.route`, as in the expand
    spec), like open rows do.
11. **No visible section → Collapse all, disabled**, not Expand all.
12. **An open row is still open when its section expands again**, and the section still has 2
    rows, not 2 plus the open row's 5 members.
13. **At 360px** the control bar wraps: the raid filter, Refresh, Collapse all and the View toggle
    each sit inside the viewport and overlap none of the others; Collapse all is on Refresh's line,
    after it; a collapsed header's name and count end inside the viewport; the page doesn't scroll
    sideways.

**Verified red first:** against the page at `c88ef31`, all thirteen failed, each on the missing
header button or the missing Collapse all button (the raid-filter helper and the open-row step ran).
Then each spec was shown failing against a targeted break of the finished page, in three batches
whose failing sets matched the predictions exactly:
- the header row not clickable → 1;
- tiles rendered outside the hidden wrapper → 2 ("Expected: 0, Received: 2");
- every fetch forgetting collapse → 3 and 10;
- collapse kept in `sessionStorage` → 4;
- the button that only ever collapses → 5;
- Expand all when *any* section is collapsed → 6 and 7;
- Collapse all acting on every raid with sessions, not only the visible ones → 7;
- no forgetting on a filter change → 8;
- the wrapper losing its id while collapsed → 9 ("Expected: 1, Received: 0");
- a maintenance response forgetting collapse → 10;
- the button not disabled → 11;
- collapsing a section closing every open row → 12;
- the control bar `flex-nowrap` → 13 (Refresh ends at 366px);
- Collapse all before Refresh → 13.

One break stayed green and was right to: tile view ignoring collapse *inside* the hidden wrapper
changes nothing on screen. It exposed that the spec's collapsed check counted rows with the CSS row
locator, which counts hidden elements and so tied the spec to unmounting. That check now counts
`listitem`s by role, which leaves hidden ones out.

### What is still NOT covered

- The 30-second poll itself; Refresh stands in for it, as in #158.
- ~~A section that leaves the page because its raid's last fireteam ended, then comes back.~~
  Covered by spec 14 in the review fixes below. This note used to say the rule was the same as for
  a filter change (spec 8). The outcome is the same, but the code path isn't: the page forgets a
  raid that left the response in its fetch, and one the filter hid in the filter's handler, so
  spec 8 never ran the fetch path. With that path deleted, every spec still passed.
- A failed fetch (an error response): collapse state isn't touched on that path at all, so it is
  kept, but no spec stubs one.
- Null-key raids collapsing together under `''`: seeded keys are always strings.
- Hover colours and the chevron's rotation. They were checked once in throwaway screenshots at
  1280px and 360px, light and dark, and are not asserted.
- Tile view beyond collapse: spec 2 counts tiles and checks the collapsed header and a switch to
  List and back, nothing more (#153).


### Support helpers extracted (same day)

**`expectInsideViewport(locator, what)` joins `e2e/support/viewport.ts`.** It checks the left edge
against 0 and the right edge against the page's own viewport width, with one wording: "<what>
starts / ends inside the viewport". It replaces five hand-written copies of the same check, with a
hard-coded 360: the list view's toggle and long-named row, the open row's members, #159's controls
and collapsed header (name and count), and the timeline's tooltip, whose separate edge checks
against the chart are unchanged. Three of them checked only the right edge before. The left edge
is now checked too, so the checks are now stronger, never weaker. Test count unchanged.
Shown biting: the Collapse all button at `min-w-[380px]` and the View toggle's wrapper at
`ml-[340px]`. The collapse spec failed on "collapseAll ends inside the viewport" (518 against 360)
and the list spec on "the view toggle ends inside the viewport" (471), both inside the helper.
The expand phone spec failed first on its page-overflow check. Restored, all fifteen phone specs
passed.

**`e2e/support/active-sessions-page.ts`, new: `refreshSessions(page)`, `serveMaintenance(page)` /
`endMaintenance(page)` and `MAINTENANCE_MESSAGE`.** They replace the word-for-word copies in the
expand and collapse specs:
- the Refresh-and-wait: the expand spec's "after Refresh" spec and the collapse spec's local
  `refresh()`, four calls;
- the `page.route` maintenance stub and its `unroute`, one copy in each spec's maintenance spec.

The stub still runs at the network layer, so the page's own fetch handles the response. The
expand spec's other Refresh clicks stay plain clicks, as before: "a member joins", and both
clicks in its maintenance spec. Swapping them would add a wait they don't have today. (The two
maintenance clicks moved to `refreshSessions` in the review fixes below.) A new file,
because `fireteam-rows.ts` only builds locators and `viewport.ts` only measures layout. Test
count unchanged.

Shown biting, then restored and green:
- Every fetch clearing open rows and collapse state: the five refresh and maintenance specs
  across the two files failed, each on the assertion right after the helper call. The maintenance
  banner check passed first, so the stub served maintenance.
- Only the `!data.maintenance` guard removed: exactly the two maintenance specs failed (collapse
  `:262` "Expected: \"false\", Received: \"true\""; expand `:198` "Expected: \"true\", Received:
  \"false\"").

### Review fixes (same day)

One more collapse spec, so the file has **fourteen** and the suite **131 tests including the two
canary setups**, still twenty-four flows. The numbers below continue the list above. Spec 14
sits after spec 8 in the file, because the two are the same rule on two paths.

14. **A section whose raid leaves the API response and comes back starts expanded.** Spec 14
    collapses the `893` fireteam's section, then calls `endFireteams` (new in
    `e2e/support/seed-world.ts`), which deletes that fireteam's `active_sessions` rows through
    `deleteActiveSessionForPlayer`, the query the crawler uses. After Refresh the section is
    gone. The spec then reseeds and refreshes, and the section is back, expanded. Nothing is
    stubbed: the e2e server really stops returning the raid. Only rows under prefix `893` are
    touched.

Spec 2 (tile view) gains two checks:
- While collapsed, the raid name is on screen as text, not only as the button's accessible name.
- After a switch to List and back, the section is still collapsed, because collapse state is
  by raid, not by view.

The expand spec's maintenance spec now uses `refreshSessions` for both of its Refresh clicks.
It waits for each response, which only makes it stricter. `active-sessions-page.ts` matches the
sessions request with one path predicate, for both the stub and the response wait. The
maintenance stub's docblock cites ADR 0004's 2026-10-15 amendment, the one exception to "our own
API routes are not stubbed". The page filters on `raidSectionKey(s)`, the same key that grouping
and forgetting use (no spec change: seeded keys are never null).

Shown biting, then restored and green. Each break was its own build, and the collapse file ran
against it:
- The fetch path's `liveRaids` / `keepCollapsed` lines deleted, together with the raid name
  hidden in tile view while collapsed (kept as an `aria-label` on the button). Exactly two specs
  failed:
  - spec 14 at its final `expectExpanded` ("Expected: \"true\", Received: \"false\""), after its
    section-gone check had passed;
  - spec 2 on the new name check ("Expected: visible, Received: hidden").

  The old spec 2 would have passed this break: its `headerOf` locator reads the accessible name,
  which the `aria-label` kept.
- Switching view clearing collapse state: only spec 2 failed, at the `expectCollapsed` after the
  switch to List ("Expected: \"false\", Received: \"true\"").

## 2026-10-15 — #160 the list rows' copy join code button

`e2e/active-sessions-copy.spec.ts`, **new**, eleven specs; `e2e/support/seed-world.ts` changed.
The suite is now **twenty-five flows, 142 tests including the two canary setups**.

Each list row on `/active-sessions` has an icon-only `<button type="button">` named and titled
"Copy join code", between the elapsed time and the chevron. It copies the fireteam's Join Command
(`/join Name#Code`) with the async Clipboard API. The target is `joinCommand` in
`src/lib/active-session/roster.ts`: the Fireteam Leader if their full `Name#Code` is known,
otherwise the first Roster member whose full name is, otherwise none (Vitest covers the rule,
`roster.test.ts`). On success the icon turns into a check mark and a `role="status"` tooltip reads
"Copied /join Name#Code" for two seconds. On failure the tooltip reads "Copy failed: /join
Name#Code", with the command selectable, and stays until Escape or a press outside it. At a
displayed 6/6 the button is disabled with the title "Fireteam full". With no target there is no
button, and an `aria-hidden` placeholder of its width keeps the columns aligned. A fireteam of one
keeps the chevron's placeholder to the button's right, so every row's button sits in one column.

**Seed world:** `COPY_RAID` (Pantheon: Calus Resplendent) and `COPY_EDGE_RAID` (Pantheon:
Insurrection Prime Revolutionary, seeded by its own hash `747671496`. `RAID_DEFINITIONS` also listed
`2530656885` under it, a hash that names Morgeth; fix/manifest-dupe-2530656885 removes that listing,
and seeding by `747671496` holds either way), two raids only this spec seeds. `seedFireteams` gains two options:
- `nameOnlySeats`: those seats' `players` rows have a name and no code, so the API sends the bare
  name;
- `unseenSeats`: those seats have no `players` row and no session row of their own, and the Roster
  names them by membership id, as Bungie does for a teammate it has no name for.

Both are seeded, not stubbed (ADR 0004). Fixture namespace **90**:
- `901`: a six-player fireteam (leader in seat 2), so 6/6;
- `902`: a five-player fireteam with the leader in seat 1 and every name full, so a full name sits
  ahead of the leader;
- `903`: a four-player fireteam whose leader (seat 0) has no code;
- `904`: a three-player fireteam whose leader has no code and whose other two seats are unseen;
- `905`: a tracked player alone, with a 26-character name;
- `906` (on `COPY_EDGE_RAID`): a tracked player named with 26 `M`s and one unseen teammate, so
  the section's first row;
- `907` (on `COPY_EDGE_RAID`): a tracked player alone, named with 26 `W`s, so its last row.

**The clipboard is real.** The specs that read it back run with `clipboard-read` and
`clipboard-write` granted on the context, and read it with `navigator.clipboard.readText()`. The
failure spec runs in a context granted neither, where headless Chromium itself refuses the write
("NotAllowedError: … Write permission denied"). That refusal was probed on a throwaway page before
the spec was written: no grant, and a CDP `Browser.setPermission` denial, both refuse; a grant
succeeds. So nothing in the browser is replaced, and no ADR 0004 exception is needed. If a
Chromium version ever allowed the write, the spec would fail rather than pass.

**The two-second revert uses Playwright's clock.** The spec installs `page.clock` before loading
the page and pauses it once loaded, then steps it 1.9s (still shown) and 0.2s more (gone). That
proves "about two seconds" from both sides without sleeping. The page's 30-second poll stays
frozen too, so nothing re-renders mid-spec.

1. **The leader's join code is copied** and read back: `/join Roster902F0S1#1000`, not seat 0's.
   The button's title is "Copy join code".
2. **A leader with no code falls back** to the next member with a full name (`903`).
3. **Copying doesn't toggle the row**, closed or open, and each click is shown to have copied.
4. **The check mark and "Copied /join …" show for about two seconds, then revert.** The icon is
   compared as markup before, during and after, so the spec doesn't know either icon's shape.
5. **At 6/6 the button is disabled**, with the title and accessible description "Fireteam full".
6. **No button when nobody has a full name** (`904`), and the row's elapsed time ends where it
   does on a row with a button.
7. **A fireteam of one has a button** in the same column as the others, and its elapsed time
   lines up.
8. **At 360px**, the solo row's button is inside the viewport and the row stays one line tall: its
   flex line's height is its padding plus one line-height, measured on the whole row rather than
   the `truncate` title cell, which is one line however the row breaks. The "Copied" tooltip is
   inside the viewport, and nothing clips it or is drawn over it: no ancestor that clips its
   overflow ends inside the tooltip, and a point just inside each of its edges hits the tooltip.
9. **A refused copy shows the command to copy by hand.** No check mark, still shown after 10s on
   the paused clock, one click on it selects exactly the command without toggling the row, and
   Escape or a click on the page's heading dismisses it.
10. **At 360px the failure tooltip fits** the same way as 8. Its wording is the longer of the two.
11. **At 360px the failure tooltip is whole on the list's first and last rows with the widest
    names** (`906` and `907`, on a section of just those two rows). Each tooltip is asserted taller
    than its row first, so the spec can't pass on one that never reached the list's edge. Then
    each is inside the viewport, the page doesn't scroll sideways, and nothing clips it or is
    drawn over it, as in 8.

**Review fixes (2026-10-15).** The review found two holes.
- Spec 8's one-line check measured the `truncate` title cell, which can't wrap. It now measures
  the row's flex line. Against a break that wraps the row (`flex-wrap` on the line, `basis-full`
  on the button), the new check fails with "the row is one line tall … Expected: 40, Received:
  80". The old check passed that assertion and failed only later, at "the feedback starts inside
  the viewport" (−159), because the moved button dragged the tooltip off-screen.
- A 26-letter name of `M`s, `W`s or CJK took three lines (54px) in the failure tooltip at
  360px, against a 40px row. On the list's last row it ended 6px below the list's clipped edge.
  Spec 11 was red against the list's `overflow-hidden` ("`<ul class="ui-card divide-y ui-divider
  overflow-hidden">` by 6.0px", on the first row). Then the clip moved off the list: #158's
  `overflow-hidden` on the `ul` (there so a hovered first or last row kept the card's rounded
  corners) is gone. The rows round their own hover instead: the first row's line at the top, and
  the last row's at the bottom while it is closed, both at the card's inner radius
  (`calc(0.5rem-1px)`). Checked once in a throwaway probe, light and dark: computed radii of 7px
  on those corners, 0 on an open last row's line, and clean corners in 4× screenshots. The
  tooltip's width cap, `break-all` and body font stay. The cap keeps it inside a 360px viewport;
  a Bungie Name has no space to break at; and monospace only makes it taller.

**Verified red first:** the first nine specs (all but 10, which came with the tooltip's phone
fixes) ran against the page at `1dff438`, and eight failed on the missing button. Spec 6 passed,
correctly: no row had a button yet, so "no button" and the alignment held trivially. The breaks
below are what give it teeth.

Then each spec was shown failing against a targeted break of the finished page, in seven batches.
Each batch was one build, and each failing set matched the prediction:
- no fallback (the leader or nobody) → 2, plus 7, 8 and 10, because the solo row has no leader;
- the 6/6 disable dropped → 5 ("Expected: disabled, Received: enabled");
- a press inside the failure tooltip dismissing it → 9 (the selection read "", not the command);
- the leader never preferred → 1, 3, 4 and 9 (the tooltip read `…F0S0#1000`);
- the no-button placeholder removed → 6 (elapsed time at 1195, not 1159);
- a button even with no target → 6 ("Expected: 0, Received: 1");
- no revert timer → 4;
- the solo row's button in the chevron's slot → 7 (button at 1207, not 1171);
- a click outside not dismissing the failure → 9;
- bare names accepted as full → 2 and 6;
- a failed copy left idle → 9 and 10;
- the row's click guard not excluding the copy button → 3 and 9;
- a 500ms revert → 4, at the 1.9s step;
- all-digit names accepted → 6;
- the tooltip's click not stopped → 9 (the row opened);
- the button hidden at 6/6, not disabled → 5 ("element(s) not found");
- Escape not dismissing → 9.

While the specs were being written, the phone checks were also red against two earlier versions of
the tooltip:
- at a `100vw-7rem` cap it started at x −5;
- with the command in monospace, wrapping at its space, it took three lines and ended 6px past the
  list.

The first version of spec 8 measured an empty status `<span>` around an absolutely positioned
tooltip and passed on a zero-size box. The `role="status"` element is now the tooltip itself, so
the specs measure what a visitor sees.

### What is still NOT covered

- A raw membership ID as long as Bungie's (16+ digits) in the browser. The `unseenSeats` IDs are
  seven digits (`9040001`), so the API's `isLikelyMembershipId` passes them through as names. The
  spec still proves they aren't used, because they have no `#code`. The 19-digit case is covered
  in Vitest.
- A platform name that itself ends in `#` and four digits. The browser can't tell it from a
  Bungie Name (see the open question on #160's report).
- A browser without `navigator.clipboard` (an insecure origin). The same `catch` handles it, but no
  spec loads the page over plain HTTP from a non-local host.
- Clicking the button again while "Copied" restarts the two seconds. It works by construction
  (each copy sets a new state object), but no spec steps the clock across a second click.
- The feedback lost when a section collapses (accepted, #168).
- A click on the disabled 6/6 button. A review probe found that Chromium dispatches no click at
  all, even at the icon inside the button: a capture listener on `document` saw none, and the row
  stayed closed. If one ever arrived, the row's click guard would still find the button and
  leave the row alone.
- Dismissing the failure tooltip by touch. A tap outside it fires the same `pointerdown` a mouse
  press does, and so does the start of a scroll gesture, so scrolling the page dismisses it too.
  No spec runs a touch context.
- Selecting the command by keyboard alone. The `<code>` in the failure tooltip isn't focusable,
  so only a pointer can select it. A screen reader still hears the command, since the tooltip is
  the `role="status"` region.
- Hover colours, the disabled look and the tooltip's look. They were checked once in throwaway
  screenshots at 1280px and 360px, light and dark, and are not asserted.
- Tile view has no button (#153).

## 2026-10-15 — #161 the fireteam-size filter chips

`e2e/active-sessions-size.spec.ts`, **new**, fourteen specs; `e2e/support/seed-world.ts` changed.
The suite is now **twenty-six flows, 156 tests including the two canary setups**.

The control bar on `/active-sessions` gains six toggle chips, `1`–`6`, between [Refresh + Collapse
all] and the View toggle. The group is `role="group"` named "Fireteam size", and each chip is a
`<button aria-pressed>` named and titled "Fireteams of N". All six are on by default. The
selection is kept in localStorage (`destiny-farm-finder-sessions-sizes`, a JSON array) by
`useSessionSizes`, a copy of #157's `useSyncExternalStore` hook with its failed-save handling,
and with no cross-tab sync (the user's decision, as for the view toggle). The filter runs in the
browser on the player count each row shows, after the server's display cap (ADR 0001, unchanged),
inside `filteredSessions` alongside the raid filter, so it applies in list and tile view alike.
A raid section with nothing left to show is gone. Every chip off shows nothing (the user's
decision): the empty state reads "Select at least one fireteam size", and a page the chips empty
inside the raid filter reads "Try selecting more fireteam sizes".

Which chip a count falls under is `rosterSizeChip` in `src/lib/active-session/roster.ts` (Vitest):
the count clamped to 1–6, so a count past 6 falls under chip 6, the same fireteams
`isFullRoster` calls full, whose copy button is disabled.

**Seed world:** `SIZE_RAID` (Pantheon: Morgeth Surpassing), which no other spec seeds, by hash
`2530656885`. The stored `raid_key` is Morgeth's, so the section groups there, and the heading
comes from the hash, which resolves to Morgeth. (`RAID_DEFINITIONS` also listed the hash under
Insurrection Prime, where Morgeth's later entry won; fix/manifest-dupe-2530656885 removes it.)
The first red run's page snapshot showed the section "Pantheon: Morgeth
Surpassing" with "6 sessions". Fixture namespace **91**:
- `911`–`916` (on `SIZE_RAID`): one fireteam of each size from 1 to 6, the leader in seat 0;
- `917` (on `RAID_B`): one two-player fireteam, for a second section. RAID_B's only other
  fireteam is player-names' six-player `82`, live or not depending on file order, so every spec
  that needs RAID_B's section gone switches off chips 2 **and** 6, and none counts RAID_B's rows;
- `918` (on `RAID_B`): ended, then seeded, inside spec 14, the file's last (since the review
  fixes below; it carried the retry number before).

**The file sends its own client address.** `middleware.ts` rate-limits `/api/active-sessions` to 60
requests a minute per client IP. No other spec sends a forwarding header, so every spec shares one
bucket, keyed `'unknown'`. Run alone, this file passed. In the first full run, the shared bucket went past 60 a
few specs in: the API answered 429 (seen with a temporary response listener), the page showed
"Could not load active sessions", and specs 3–8 failed until the window reset, and then 9–14
passed. Two full runs failed identically. The file now sets `extraHTTPHeaders: { 'x-forwarded-for':
'198.51.100.91' }` (a documentation range), which gives it a bucket of its own, as each visitor has in
production, and the full run is green. The other active-sessions files still share `'unknown'`, so
the next one to add page loads is likely to hit the same wall; see "still NOT covered".

1. **Six chips, all on, on a first visit**, each with its text, title and `aria-pressed`.
2. **Each chip toggles on its own**: 3 off, 5 off, 3 on leaves only 5 off.
3. **A chip switched off hides its size in list view**, and only its size (5 rows left, each
   named).
4. **The same in tile view**, counted per section by the tiles' `h3`s (6 → 4 with 1 and 6 off).
   No per-fireteam tile coverage; that is #153's to restore.
5. **A section with no match disappears** (chips 2 and 6 off empty RAID_B; SIZE_RAID keeps 4).
6. **Combined with the raid filter**, only fireteams passing both show.
7. **The selection survives a reload**, `aria-pressed` included, since the page is prerendered with
   every chip on.
8. **A stored value the page can't read is all six on**: not JSON, `null`, an object, `["3"]`,
   `[2.5]` and `[1,7]`.
9. **A failed save still filters, and the next successful save wins**, through a reload.
10. **The empty state** with every chip off (and Collapse all disabled, as in collapse spec 11),
    and the chips' own line inside a raid filter.
11. **A section the chips empty comes back expanded**; one they leave on the page stays collapsed.
12. **An open row a chip hides is still open** when its size is shown again.
13. **At 360px** every chip and the group are inside the viewport and overlap no other control,
    the page doesn't scroll sideways, and a row's flex line is one line tall (padding plus one
    line-height, never the `truncate` title cell; #160's S2).
14. **A section a refresh empties under the chips comes back expanded.** A collapsed raid's only
    shown fireteam grows from 5 to 6 while chip 6 is off: the API still sends the raid, so the
    fetch now forgets raids with nothing *shown*, not nothing sent. Kept last in the file, and its
    membership ids carry `testInfo.retry`, because a grown fireteam can't shrink back: each
    attempt seeds a fresh one, and an earlier attempt's, left at 6, stays hidden under chips 2 and 6.

**Proof that the specs bite.** All fourteen were red against the page before the chips (no chip to
find). Then twelve breaks of the finished code in five builds, each restored, never committed,
each failing exactly the predicted specs:
- `changeSizes` not forgetting sections → 11;
- a successful save not clearing the failed-save fallback → 9 (chip 5);
- any JSON array accepted as a selection → 8 (`["3"]`);
- the fetch forgetting only raids missing from the response → 14;
- a failed save keeping nothing in memory → 9 (chip 3);
- no "Try selecting more fireteam sizes" line → 10;
- a chip change closing every open row → 12;
- the size predicate always true → 3, 4, 5, 6, 7, 9, 10, 11, 12, 14;
- switching a chip on switching the others off → 2;
- the selection read in a `useState` initializer (#157's bug) → 7 and 9 (`aria-pressed` after
  the reload);
- the raid filter dropped from the combined predicate → 6 and 10;
- `getSnapshot` returning a new array on every call → all fourteen (the page crashed with
  "Application error: a client-side exception has occurred").

### What is still NOT covered

- A count above 6 or below 1 in the browser. Nothing seeded can produce one, and the API would
  pass the stored `player_count` through; the clamp is covered in Vitest.
- Cross-tab behaviour. There is none by design: another tab's change shows here only after a reload.
- The chips' look, their hover and the first and last rows' hover corners once rows are hidden.
  They were checked once in a throwaway probe at 1280px and 360px, light and dark, and are not
  asserted. With chips 1, 2 and 6 off, the new first row's line had 7px top corners and the new
  last row's 7px bottom corners, both hovering in `--ui-surface-card-muted` (#f7f6f1 light, #2a2a28
  dark). The review rechecked them with 26-letter `M`, `W` and CJK names and chips switched off
  to change the first row, the last row and both: the same 7px corners, at 3× scale, and no
  sideways scroll at 360px. The 360px layout itself is asserted since the review fixes below.
- The shared rate-limit bucket. Every active-sessions spec but this one sends no client address,
  so together they spend one 60-a-minute budget on `/api/active-sessions`. Nothing asserts how
  close a full run comes to it. A per-test or per-file address in `test-fixtures.ts` would remove
  the hazard suite-wide; that is a follow-up, not done here:
  [#171](https://github.com/agrorithms/destiny-public/issues/171).
- Tile view per fireteam (#153).

### Review fixes (same day)

Two more size specs, so the file has **sixteen** and the suite **158 tests including the two
canary setups**, still twenty-six flows. The numbers below continue the list above, not the file
order: spec 16 sits right after the 360px spec, and spec 15 sits just before spec 14, which stays
last.

15. **Collapsed sections survive a maintenance response the chips change under.** SIZE_RAID and
    RAID_B are collapsed, the maintenance stub answers (`serveMaintenance`, ADR 0004's
    2026-10-15 amendment), and chips 2 and 6 go off while the banner shows. Once the real API
    answers again, SIZE_RAID, which still has rows, is still collapsed, and RAID_B, which has
    none, is gone. Chips 2 and 6 back on bring RAID_B back expanded. Before the fix,
    `changeSizes` worked out which sections were on the page from the maintenance response's
    empty list, so any chip click forgot every collapse, breaking #159's rule. It now does
    nothing to collapse state while the banner shows; the first real response forgets what the
    chips emptied, through the fetch's own forgetting.
16. **At 375px the chips and the View toggle share one line**, below Refresh, with View flush
    with the control bar's right edge, and no sideways scroll.

Changed:
- **13** (360px) also asserts that one line: View on the chips' `y`, the chips below Refresh,
  Refresh below the raid filter, and View flush right. The overlap check alone can't see it,
  because View wrapping onto a line of its own overlaps nothing. Its chip-1 tap is now explained:
  Playwright's click fails if another control covers the chip. The layout change behind it is a
  styling commit of its own: the chips go from 32px to 28px wide, and the chips and View are one
  `flex-auto flex-wrap` item with an 8px gap, so they wrap together. That gives 170 + 8 + 82 =
  260px against the 262px control bar at 360px. Measured at 320–1280px: one line from 360 up,
  including 768, where View used to wrap alone; at 320 View still drops below the chips.
- **14** ends fireteam `918` (all six seats, `endFireteams`) before seeding it, instead of keying
  its ids on `testInfo.retry`. The retry key only covered an attempt that failed after the grow:
  one that failed before it left a five-player fireteam on RAID_B that chips 2 and 6 don't hide,
  so every retry failed. A probe seeding `9180` at five, then running spec 14's old steps as
  attempt 1, failed with "Expected: 0, Received: 1". With the fix, a probe that leaves `918` at
  five before spec 14 runs passes.

Shown biting, then restored and green. Each break was its own build:
- `changeSizes`'s maintenance guard removed: only spec 15 failed, at SIZE_RAID's first
  post-maintenance check ("Expected: \"false\", Received: \"true\"").
- The chips back at `w-8`: 13 and 16 failed on View's line ("Expected: 447, Received: 521" at
  360px; "Expected: 411, Received: 485" at 375px).
- The pair's gap at `gap-x-3` (12px, so 264px): 13 failed (447 against 521); 16 passed, as it
  should, since 375px's 277px bar holds it.
- The `filtersRef` sync effect removed, together with the "Select at least one fireteam size"
  branch: exactly 14 ("Expected: \"true\", Received: \"false\"") and 10 ("Expected: visible")
  failed. Neither was among the twelve breaks above.

## 2026-10-22 — #41 the leaderboard's Difficulty dropdown

`e2e/leaderboard-difficulty.spec.ts`, **new**, nine specs; `e2e/support/seed-world.ts` changed.
The suite is now **twenty-seven flows, 167 tests including the two canary setups**.

The Difficulty dropdown (All / Normal / Master / Epic) is back on `/leaderboard`, on both tabs,
after 8ea7ae8 hid it. Difficulty now comes from the run's activity hash, tagged in
`RAID_DEFINITIONS`; `difficulty_tier` records Feats and no filter reads it. The choice is kept in
localStorage (`destiny-farm-finder-difficulty-filter`, unchanged; `'epic'` is new and the old
`'normal'`/`'master'` still load). Under a Difficulty the API leaves out the board of every raid
with no version at it, and a raid that has the version but no clears in the window keeps its empty
card. The label is now tied to its `<select>` (`htmlFor`), which is how the spec finds it by name;
the Players and Rows labels still aren't.

What the runs count, and which boards the API leaves out on every path (all raids, one raid, a
subset, Total Clears), are pinned in Vitest: `src/lib/bungie/manifest.test.ts`,
`tests/db/{leaderboard,fastest-clears,raid-stats}.test.ts` and the new
`tests/routes/{leaderboard,raid-stats}.test.ts`.

**Seed world:** `DIFFICULTY_PLAYERS`, one run each, on raids no other spec gives PGCRs:
FixtureGolf#5555 on Vault of Glass: Standard with Feats on (`difficulty_tier` 2, the run the old
filter called Master), FixtureHotel#6666 on Vault of Glass: Master, FixtureIndia#7777 on The Desert
Perpetual (Epic): Standard. One clear each keeps them below FixtureAlpha on Total Clears, and the
existing leaderboard, Fastest Clears and player-name specs passed unchanged with them seeded.

1. **The dropdown offers All, Normal, Master, Epic, with All selected**, on `/leaderboard` and on
   `/leaderboard?board=fastest` (two tests).
2. **Master** sends `difficulty=master`. Vault of Glass shows Hotel and not Golf. Deep Stone Crypt
   and The Desert Perpetual have no card. Root of Nightmares, which has a Master version and no
   clears, shows "No completions found".
3. **Normal** shows Golf and not Hotel on Vault of Glass. Back on **All**, both are on the one
   Vault of Glass card and Deep Stone Crypt's card is back.
4. **Epic on Fastest Clears** sends `board=fastest&difficulty=epic`. The Desert Perpetual is the
   only card, with India on it.
5. **The choice survives a reload**: `epic` is selected again and the reload's request carries it.
6. **A value stored before Epic existed loads**, for `normal` and for `master` (two tests): it is
   selected and sent, Vault of Glass shows that Difficulty's player and not the other's, and Deep
   Stone Crypt has a card under `normal` only. The `normal` case was added in #41's review (P2)
   and passed on its first run: it covers a path that already worked, so its bite is the
   deliberate break below.
7. **An unreadable stored value reads as All**: nothing is sent and every card shows.
8. **Phone (360×780):** after choosing Master, `expectNoOverflow(page)` passes.

**Bite:** the red run, at `03ff690` before the dropdown came back. All nine specs failed. 1 failed on
`toHaveText`, 7 on `toHaveValue` and 8 on `toBeVisible`, because there was no select. 2–5 timed out
in `selectOption`. 6 timed out waiting for a `difficulty=master` request, because the page never
read the stored value. In the same run the existing leaderboard (5), Fastest
Clears (6) and player-name (6) specs passed with the new seed.

**Deliberate break** for 6's `normal` case, added after the red run (#41 review, S10). At 6465fac,
with `'normal'` dropped from `VALID_DIFFICULTY` in `src/hooks/useLeaderboardPrefs.ts`, the spec
file ran 1 failed, 11 passed (the two canaries included). Only the stored-`normal` case failed:
"Test timeout of 30000ms exceeded. Error: page.waitForRequest: Test timeout of 30000ms exceeded.",
at the wait for a `difficulty=normal` request, because the page read the stored value as All. The
stored-`master` case passed. Once the break was reverted, it was green again.

### Still NOT covered

- `/active-sessions` has no Difficulty filter (#183).
- The maintenance snapshot ignores every filter, Difficulty included (#185); the e2e world has no
  maintenance state.
- Master with only no-Master raids selected leaves zero boards. Full Clears shows "No leaderboards
  found" and Fastest shows "No Completions match these filters". Not asserted.

## 2026-10-21 — the viewport matrix (`npm run visual:check`)

Not one of the flows above, and not run by `npm run e2e` or CI. `e2e/visual.spec.ts` runs under
six projects (`visual-360-light` … `visual-1280-dark`) that `playwright.config.ts` defines only
when `scripts/visual-check.ts` sets `VISUAL_CHECK`; the `chromium` project ignores the file. It
uses the same fixture databases and canary as the suite.

For every page (`/admin/stats` aside, behind basic auth), at each width and theme:

- a full-page screenshot to `visual-check/<route>/<route>--<width>--<theme>.png` — for review,
  asserts nothing;
- the `.dark` class on `<html>` matching the theme, so a dark screenshot can't silently be light;
- `expectNoOverflow` (`e2e/support/viewport.ts`) — **the gate**: no element past the viewport's
  side edges (unless inside a sideways scroller, which is measured instead) and none clipped by
  its nearest `overflow: hidden`/`clip` ancestor, top and bottom included. `OVERFLOW_EXEMPT` in
  the same file holds named exceptions with reasons; it starts empty.

What it does **not** cover: anything after an interaction. It measures pages as they load
against the seed world, so #160's copy bubble — clipped only after a click, only with a
26-wide-glyph name on an end row — would not have been caught here. A spec that creates a state
calls `expectNoOverflow(page)` itself. `/admin/stats` (basic auth) is skipped; the player page
is FixtureAlpha#4242's.

Known gap, kept by the user's ruling (2026-10-22): an absolutely positioned element is checked
only against ancestors from its `offsetParent` up, and a fixed one against none. A `transform`ed
ancestor becomes the real containing block for both; if Chromium's `offsetParent` passes over it,
an ancestor that clips the popup is never checked, and a #160-style clipped popup inside a
transformed element would pass.

## 2026-10-23 — #194 the Raid Activity page (`/activity`)

`e2e/activity.spec.ts`, **new**, four specs. The suite is now **twenty-seven flows, 162 tests
including the two canary setups**.

**Seed world:** `seedActivityRuns` in `e2e/support/seed-world.ts` adds ten PGCRs on Salvation's
Edge, all well inside the chart's 7-day window: three runs covering exactly one clock hour two
days back (the peak, `ACTIVITY_PEAK_RAIDS` = 3), one run of two and a half hours four days back,
and one hour-long run a day for the six days before. Every leaderboard run starts an hour ago,
inside the two hours the chart leaves uncounted, so without these the chart was a flat line. They
are Checkpoint Runs nobody finished, by `92`-prefixed members with no `players` row, so no
leaderboard, Fastest Clears board, player page or player search sees them. The canary is
untouched.

1. **The nav links to it.** From `/leaderboard`, the nav shows Leaderboard and Active Sessions, and
   its Activity link goes to `/activity`, headed "Raid Activity".
2. **The total line is drawn from the seeded Tracker.** The SVG's accessible name says it peaks at
   3 raids in progress; the line's path has a vertex for every counted hour (at least 165); the
   caption reads "Busiest hour: 3 raids in progress, <Day> <date> <Mon>, HH:00–HH:00 UTC."; the
   not-yet-counted shade starts past 98.2% of the width and ends at 100%; at least six UTC day
   labels sit under the axis. No console errors. The hour itself is not pinned: it is two days
   before the seed ran, and the spec's clock may have crossed an hour since.
3. **With JavaScript off** (`javaScriptEnabled: false`), the same checks pass, and the copy says
   "Times are UTC."
4. **Phone (360×780):** the Activity link and the chart sit inside the viewport, the chart passes
   the same checks, and `expectNoOverflow(page)` finds nothing.

**Bite proof — one deliberate break per spec, batched into one build** (then restored and green):
- The nav link pointing at `/leaderboard`: only 1 failed ("Expected pattern: /\/activity$/,
  Received string: http://localhost:3100/leaderboard").
- The line drawn only after mount, by a client component that renders `d=""` on the server: only 3
  failed ("the line has a starting point"). 2 and 4, with JavaScript on, passed.
- The chart's figure at `min-w-[420px]`: only 4 failed ("the chart ends inside the viewport",
  436 against 360).
- Against that same build, `seedActivityRuns()` left out of the seed world (no rebuild needed:
  the seed is the runner's): 2 failed, its chart no longer named a peak of 3.

### What is still NOT covered

- Anything later tickets add: range presets (#195), the Provisional estimate (#196), hover and tap
  tooltips in local time (#197), the per-raid panel (#198, #199).
- The maintenance message ("Raid Activity is temporarily unavailable"). The e2e server can't be put
  into database maintenance, and stubbing our own page is not an exception ADR 0004 allows.
- The 300-second cache: every spec reads the series the first request computed. Nothing asserts
  that a later request within the window reuses it, or that one after it recomputes.
- The values themselves beyond the peak. Step averaging is pinned in
  `tests/db/raids-in-progress.test.ts`, the geometry in `src/app/activity/activity-geometry.test.ts`.

## 2026-10-23 — #195 the Raid Activity range presets (`?range=`)

`e2e/activity.spec.ts`, **five new specs** under "the range presets". The suite is now
**twenty-eight flows, 167 tests including the two canary setups**. `e2e/visual.spec.ts` also
screenshots `/activity?range=24h` and `/activity?range=30d` (slugs `activity-24h`, `activity-30d`),
so `npm run visual:check` gates their overflow at all six viewport/theme pairs too.

**Seed world:** `seedActivityRuns` now makes **thirteen** PGCRs, three more than #194's ten, all
still `92`-prefixed Checkpoint Runs nobody finished:
- two 20-minute runs six hours back (`ACTIVITY_RECENT_PEAK_RAIDS` = 2), the only counted runs in
  the last 24 hours, so the 24-hour chart's busiest 10 minutes is exactly 2;
- one hour-long run 20 days back (`ACTIVITY_OLDEST_DAYS`), the world's oldest PGCR. The query
  starts counting at the first step 6 hours after the oldest report (ADR 0009's #195 line), so the
  30-day chart shades its first ~10 days (34.0–34.6% of the width) as no data, while 24 hours and
  7 days are drawn whole, as #194's specs need.

Over 30 days the busiest 3 hours is the 7-day peak's: three hour-long runs inside one 3-hour step,
exactly 1 — which is also what shows the caption says "1 raid", not "1 raids".

`expectRangeDrawn(page, id)` is what "the chart is that range's" means, shared by every spec below:
the control marks that preset `aria-current="page"` and no other; the SVG's accessible name says
"per 10 minutes over the last 24 hours" / "per hour over the last 7 days" / "per 3 hours over the
last 30 days"; the line's vertex count is in range (131–132, 165–166, 150–160); the peak caption is
that range's; the not-yet-counted shade starts past 100 − its widest share of the window, and its
legend states that range's width ("the last 2 hours to 2 hours 10 minutes" / "2 to 3 hours" /
"2 to 5 hours"); hour labels (`HH:00`) under a 24-hour axis, day labels under the others; and the
data-start shade and its dated legend ("Shaded at the left: no data before <Day> <date> <Mon>,
HH:00 UTC. Older raid reports are no longer stored.") at 30 days only, absent at 24h and 7d.

1. **Each preset sets `?range=` and redraws.** From `/activity` (7d), clicking 24h, 30d then 7d
   sets `/activity?range=<id>` each time, 7d included, and the chart is that range's.
2. **A reload keeps the range.** 30d clicked, the page reloaded: still `?range=30d`, still 30d.
3. **An unreadable range shows 7 days.** `/activity?range=nonsense` draws the 7-day chart with 7d
   marked.
4. **With JavaScript off**, the 24h preset is a plain link the browser follows to `?range=24h` and
   the 24-hour chart.
5. **Phone (360×780):** the control sits inside the viewport on 7d, 30d and 24h, and
   `expectNoOverflow(page)` finds nothing after each switch.

**Bite proof — the red run, then one deliberate break.**
- Red at `2be05d1`, specs and seed committed before the control existed (the query's data start
  was already in the build): all 5 new specs failed, #194's four passed. 1 and 3 on "24h is not
  marked … element(s) not found"; 2 and 4 on `locator.click` timing out on the missing link; 5 on
  `locator.boundingBox` timing out on the missing control.
- With the control built, one cache key for every range (`raids-in-progress:7d` in `page.tsx`):
  1, 2, 4 and 5 failed, each showing the 7-day series under another range's label ("Busiest 10
  minutes: 3 raids in progress, … 03:00–04:00 UTC", "Busiest 3 hours: 3 raids in progress, …").
  3 passed, as it should: its range is 7d. Restored and green.
- Review fix S4 (2026-10-24): `rangeLink` now finds a preset's link by its `label` from
  `ACTIVITY_RANGES`, not its id, so renaming a label breaks no spec by itself. One deliberate
  break, the control rendering `label.toUpperCase()`: 8 of the spec's 11 tests failed on
  `rangeLink` finding no link (every test that touches the control); the 3 that never look at it
  passed. Restored and green.
- Review fixes S2 and S5 (2026-10-24): the chart (S2) and then the intro (S5) read their step
  and span off the series itself, so the one-cache-key break above no longer shows a series
  under another range's wording: the record above is of the code at the time. Rerun against
  `693ae4a`: the same 4 of the 11 failed (1, 2, 4 and 5 of the new specs), now on the chart's
  name — `expectRangeDrawn`'s marked-preset check passed, then "per 10 minutes over the last 24
  hours" was not found. The page at `?range=30d` read "averaged over every hour of the last 7
  days" in the intro and "Busiest hour" in the caption, with 30d still marked in the control.
  Restored and green. So the specs catch a series that isn't the URL's range, through the chart
  and the marked preset, which follows the URL on purpose (it is navigation). No spec reads the
  intro's step or span — only its "Times are UTC." — so an intro that disagreed with the chart
  drawn under it would pass; S5 removed the way they could disagree rather than adding a check.

### What is still NOT covered

- The data-start shade's position is checked within a band, not exactly: the exact arithmetic is
  pinned in `src/app/activity/activity-geometry.test.ts` and the bound itself in
  `tests/db/raids-in-progress.test.ts`, which runs the real cleanup before reading the 30-day window.
- The 30-day axis's label density is a human's call from the `activity-30d` screenshots; no spec
  asserts labels don't touch.
- The per-range cache's lifetime, as for #194.
- The intro sentence's step and span: no spec reads them. Since S5 they come off the same
  series as the chart's name, which `expectRangeDrawn` does check.
- Later tickets: the Provisional estimate (#196), tooltips in local time (#197), the per-raid
  panel (#198, #199).

## 2026-10-24 — #196 the Raid Activity Provisional estimate

`e2e/activity.spec.ts`, **two new specs** under "the Provisional estimate", and
`expectRangeDrawn` now also asserts the estimate for every range, so the JavaScript-off,
phone-width and preset specs inherit it. The suite is now **thirty flows, 179 tests including
the two canary setups**.

**Seed world:** `seedActivityRuns` makes **fourteen** PGCRs, one more than #195's thirteen: a
20-minute run that ended 40 minutes before the seed ran (from the clock, not the clock hour, so
it stays under 2 hours old, and so estimated, for the 80 minutes the suite needs). It is the only
run of the activity seed too recent to count, so the dashed line is the only place it can show.
The curve the estimate divides by needs no seed of its own: the existing runs of the last week
(outside the last 24 hours) are its training steps, and an hour of the day with none uses the
all-hours curve.

`expectRangeDrawn` now also checks, per range:
- the **too-recent shade** (`activity-too-recent`, replacing `activity-not-yet-counted`) ends at
  100% and is 15 minutes plus up to one step wide, and its legend (`activity-too-recent-legend`)
  is that range's: "the last 15 to 25 minutes" / "15 minutes to 1 hour 15 minutes" / "15 minutes
  to 3 hours 15 minutes", "too recent to estimate";
- the **dashed line** (`activity-provisional-line`) is present at 24h and 7d with 11–12 and 2–3
  vertices (the estimated steps plus the counted point it starts from), and at 30d is absent or
  has 2 (the 3-hour grid can leave no whole step between the counted boundary and the cutoff),
  with its legend (`activity-provisional-legend`, "Dashed: an estimate, from 2 hours to 2 hours
  10 minutes ago …" per range) present exactly when the line is;
- the solid line's vertex count is still the counted steps only (131–132, 165–166, 150–160).

1. **The dashed line continues the counted one and stops 15 minutes short of now.** At 24h and 7d:
   the dashed path's first vertex is the solid path's last; the dashed one has a `stroke-dasharray`
   and the accent stroke, the solid one none; the dashed one's last vertex is left of the shade
   and at least 15 minutes of the window short of the right-hand edge; `expectNoOverflow`.
2. **The 24-hour estimate rises off the baseline.** The runs of the last two hours are not counted,
   so a flat dashed line would mean the estimate scaled nothing up: at least one vertex is above
   the chart's floor.

Values are not asserted: they depend on the hour of the day the suite runs in. Those are pinned in
`tests/db/raids-in-progress.test.ts` (partial count over the share, the hour of the day, the
cutoffs at all three step sizes), `tests/db/completeness-curve.test.ts` and
`src/lib/db/completeness-curve.test.ts`.

**Bite proof — the red run.** Specs and seed committed (`aa699fa`) before the chart drew anything
new; the query already returned the estimated points, and the chart still drew them all into the
solid line. Of the 13 tests (11 activity specs and the two canary setups), **10 failed and 3
passed**: the canaries and the nav link spec. The 10: the join-and-cutoff spec (failing in `expectRangeDrawn` on "24h vertex count",
because the solid line had the estimated steps in it); the 24h estimate spec (timing out waiting
for `activity-provisional-line`); and eight other `expectRangeDrawn` callers, seven timing out
waiting for `activity-too-recent` and the JavaScript-off presets spec failing "24h vertex count". Green at the commit that draws the dashed line and the
shade (`8bc7ed2`): 13 of 13. No separate deliberate break: both new specs and every changed
assertion were seen failing before the code existed.

### What is still NOT covered

- The estimate's values and its error. The backtest is ADR 0009's, from a prod backup; the unit
  tests pin the arithmetic.
- That the estimate is actually higher than the partial count on screen (the seed's step shares
  are 1 for most hours, because its runs are whole hours); Vitest pins the division.
- The dashed line at 30d when it exists, and its absence when the grid leaves no step, are both
  accepted by the spec; neither is forced (the grid depends on the clock).
- The legend's prose after its first sentence, and the dashed swatch.
- Later tickets: tooltips in local time (#197), the per-raid panel (#198, #199).

## 2026-10-24 — #197 the Raid Activity tooltips in local time

`e2e/activity.spec.ts`, **eleven new specs**: six under "the tooltips" and five under "in the reader's
time zone". The suite is now **thirty-one flows, 190 tests including the two canary setups**.
`e2e/visual.spec.ts` and the rest of `activity.spec.ts` now pin `timezoneId: 'UTC'` with
`test.use` (the config is unchanged), because the chart's labels follow the browser's zone: the
JavaScript-on specs read the reader's clock without a " UTC" suffix, and the JavaScript-off ones
read UTC with it (`expectRangeDrawn` and `expectChartDrawn` take a `zone`).

**What the page gained:** hover and tap tooltips (`activity-tooltip`, from the shared
`ChartHover`, given a `locate` mapping for this chart's uneven slots), and a client step
(`ActivityLocal.tsx`) that moves the gridlines, tick labels, the peak caption, the before-data
legend and the intro line (`activity-zone`) onto the reader's clock after hydration. The figure
carries `data-window-from` / `data-window-to` so a spec can turn a label's position into the
instant it marks. No seed change.

1. **Hovering a counted step.** The busiest hour's tooltip repeats the caption's number and window
   (`3 average raids in progress, <window>`); the last counted step's has no estimate tail; the
   tooltip leaves with the mouse.
2. **Hovering the dashed line.** At 24h a dashed step's tooltip ends `· estimate, still
   arriving`, its window is 10 minutes wide, and the dashed line's first vertex (the last counted
   step) has no tail.
3. **A shaded span has no tooltip.** At 30d, a tooltip over the line goes away when the mouse
   moves into the span before the data starts, and again into the last 15 minutes' shade.
4. **Tap, and a tap elsewhere** (360×780, touch): at 24h and 30d a tap on the chart shows the tooltip
   inside the viewport, `expectNoOverflow` with it open, a second tap on the chart moves it, a tap
   on the heading dismisses it.
5. **A tap on the dashed line** reads "estimate, still arriving", inside the viewport, without overflow.
6. **A swipe scrolls** (360×480, touch, CDP touch events): the page scrolls and no tooltip opens.
7. **Ticks on the reader's clock** (Asia/Kathmandu, UTC+5:45): at 24h, 7d and 30d every label
   marks the instant its position says, by `Intl` for that zone (`HH:MM` for an hour mark, `Sat 17`
   at exactly midnight), a gridline sits under each, and the intro reads "Times are in your time
   zone (Asia/Katmandu)." (Chromium's older spelling of the name).
8. **A tooltip and the caption are 5 h 45 m ahead of the chart's UTC name:** the SVG's accessible
   name stays UTC; the tooltip's and the caption's windows are that window plus 345 minutes, and
   neither says UTC.
9. **The 30-day legend** names where the data starts on the reader's clock (`:45`, a quarter to the
   hour, since counting starts on a 3-hour UTC boundary), with no UTC.
10. **JavaScript off, in Kathmandu:** the intro reads "Times are UTC.", the caption ends " UTC.", and
    the tick labels sit on UTC instants.
11. **A browser that names no zone, in Kathmandu** (`resolvedOptions().timeZone` stubbed to `''`
    by an init script): once hydrated (a tooltip shows), the tooltip ends " UTC", the intro reads
    "Times are UTC.", the caption ends " UTC.", and the tick labels sit on UTC instants, though
    the browser's offset is still Kathmandu's. Added in fix loop 1 and seen red first (`0b32180`):
    the tooltip read `2 average raids in progress, Sun 25 Oct, 02:45–02:55`, Kathmandu's clock with
    no zone named.

The existing JavaScript-off specs also check the ticks sit on UTC instants.

**Bite proof — the red run.** Specs committed (`db312cd`) before the client step existed: of the 23
tests (21 activity specs and the two canary setups), **18 failed and 5 passed**: the canaries, the
nav link, the 24-hour estimate's baseline, and the JavaScript-off presets spec, which already read
UTC. Every new spec failed, but most failed first on the page not yet saying
"your time zone" (`waitForClientStep`), which says nothing of their later assertions, so the later
assertions were each broken on purpose in one build (`npm run e2e`, 11 failed, 12 passed):

| Break | Spec that failed |
| --- | --- |
| `slotAtFraction` clamps to the end slots instead of returning none | "a shaded span has no tooltip" (`toHaveCount(0)`) |
| `tooltipText` leaves off the estimate tail | "hovering the dashed line…", "a tap on the dashed line…" |
| `LocalGridlines` and `LocalTickLabels` ignore the reader's offset | the Kathmandu ticks spec |
| `LocalPeak` ignores the offset | "a tooltip and the caption are 5 hours 45 minutes ahead…" |
| `LocalBeforeData` ignores the offset | "the 30-day legend names where the data starts…" |
| `ChartHover` shows on `pointerdown` for touch as well | "a finger swiped across the chart…" |
| the tooltip loses `max-w-full` | "a tap shows the tooltip…" (at 24h: "the tooltip on 24h ends inside the viewport", 377 > 360) |
| the UTC suffix dropped | both JavaScript-off specs of the file and the Kathmandu JavaScript-off spec |

The tap spec failed first on the overflow break, which hid its dismissal assertion, so that one
was broken alone in a second build (the document's `pointerdown` listener removed): the spec failed
with the tooltip still open (`toHaveCount(0)`, received 1). All reverted; green at HEAD.

"Hovering a counted step" had failed only on `waitForClientStep` in the red run, and no break in
the table above reached its later assertions, so fix loop 1 broke it alone in a third build:

| Break | Spec that failed |
| --- | --- |
| `tooltipText` names the next step's window (`slot.end` to one step after it) | "hovering a counted step shows its average and its window" (expected `3 average raids in progress, Fri 23 Oct, 03:00–04:00`, received `…04:00–05:00`) |

Reverted; green at HEAD.

### What is still NOT covered

- A tooltip's position against the line (centred on the step, sliding inward at either end) is
  `tooltipLeft`'s, unit-tested in `src/lib/chart/pointer.test.ts`; no spec measures it.
- A real clock change inside a 30-day window: the per-instant offset is pinned in Vitest
  (`activity-time.test.ts`, `activity-geometry.test.ts`, London on 25 October 2026); the browser
  spec uses a zone with no clock change.
- A zone whose midnight does not exist on a day (a spring-forward at midnight): that tick is
  skipped. A fall-back onto midnight (the Azores, last
  Sunday of October) reads 00:00 twice and is ticked once, at the first: Vitest's
  (`activity-geometry.test.ts`), not a spec's.
- The y-axis, the legends' prose and the aria-label's wording beyond "UTC".
- Later tickets: the per-raid panel (#198, #199) and its second part for the hover.

## 2026-10-25 — #198 the Raid Activity per-raid panel and its raid picker

`e2e/activity.spec.ts`, **fourteen new specs** in one block, "the per-raid panel". The suite is now
**thirty-two flows, 204 tests including the two canary setups**. Two existing specs changed because
a counted step's tooltip now has raid lines under the total's: "hovering a counted step…" and the
no-zone spec's UTC check read the tooltip's *first line* through a new `totalLine()` helper (the
whole box was compared before, and now holds the raid lines too). Every other existing assertion is
as it was.

**What the page gained:** a second panel under the total (`data-timeline-part="raids"`) with a line
per picked raid (`activity-raid-line`, `data-raid`), its own y-axis (`activity-raid-axis`), a shade
over the steps not counted yet (`activity-not-counted`) and a legend of swatch plus name
(`activity-raid-legend`); the raid picker (`activity-raid-picker`), the site's multi-select capped
at five (`raid-limit-message` says why a sixth is refused); one tooltip box over both panels with
a named line per raid and one marker through both (`activity-tooltip-marker`); `?raids=` in the
URL, cleaned by a redirect. Five series colours, `--ui-series-1` to `-5` in `globals.css`.

**Seed:** `seedActivityRuns` gained `ACTIVITY_OTHER_RAIDS` (King's Fall 4 raid-hours, Vault of
Glass 3, Last Wish 2, Crota's End 1), appended after the existing runs so their instance ids are
unchanged, each start at least 4 hours from any other run and 36 hours back or more. **No existing
`activity.spec.ts` constant changed:** the hourly peak is still 3 (only the three Salvation's Edge
runs overlap), the 30-day peak still 1 (no two runs share a 3-hour step), and nothing lands in the
last 24 hours. Over 7 and 30 days the three busiest raids are Salvation's Edge, King's Fall and
Vault of Glass; over 24 hours only Salvation's Edge has run.

1. **The default.** On a first visit the panel draws the three busiest raids in that order, with a
   legend naming them, and the URL has no `raids`; at `?range=24h` it draws Salvation's Edge alone.
2. **A y-axis of its own.** With only King's Fall picked the bottom axis reads 0, 1 while the total's
   reaches at least the seeded peak of 3.
3. **Picking and unpicking.** Picking Last Wish writes the four keys to `?raids=`, in order, and the
   panel and legend follow; a reload keeps them; unpicking King's Fall writes three and a reload keeps those.
4. **Unpicking the last raid** drops `raids`, draws the top three and shows them ticked in the picker.
5. **A sixth raid is refused** with "Pick up to five raids", the option stays unselected, the URL and
   the panel are unchanged; unpicking one lets the same pick through.
6. **Cleanup.** `?raids=nope,kings_fall` becomes `?raids=kings_fall`; six valid keys become the first
   five with `range=30d` kept; `?raids=nope` loses the parameter and draws the top three.
7. **The range links** carry `raids` only when the URL named some.
8. **Colours.** Three different line colours in light and in dark, the legend's swatches equal to the
   lines', and the dark ones not the light ones.
9. **One hover, both panels.** At the seeded peak the box reads the total's line then `Salvation's
   Edge: 3`, `King's Fall: 0`, `Vault of Glass: 0`, the same on either panel; on the first King's Fall
   step, found from that raid's own line, `1 average raid in progress` and `King's Fall: 1`.
10. **One marker** from the top of the total panel to the bottom of the per-raid one.
11. **The newest hours.** At 24h a hover on the bottom panel over the estimate shows nothing, on the
    top panel the estimate with no raid lines, and on the last counted step both.
12. **The shade** over the bottom panel is wider than the total's too-recent shade, and its key reads
    "Shaded: the last 2 to 3 hours, not counted yet."
13. **JavaScript off:** the default raids drawn, and `?raids=nope,last_wish` redirected to
    `?raids=last_wish` with that line drawn.
14. **At 360px (touch):** the page, the open picker, the refused-sixth message, a tap on the bottom
    panel (a five-raid, six-line box) and the legend of five names, with `expectNoOverflow` after each
    and the picker, message and tooltip inside the viewport.

**Bite proof — the red run.** The specs (and the seed) were committed first (`eb005c4`) against the
page as it was: of 16 tests (14 new specs and the two canary setups) **14 failed and 2 passed**, the
canaries. Every new spec failed, but most on the picker or the panel not being there, which says
nothing of their later assertions, so eight of those were broken on purpose in one build (`npm run
e2e -- e2e/activity.spec.ts`: 11 failed, 27 passed):

| Break | Spec that failed |
| --- | --- |
| the cap never reached (`atCap = false`) | "refuses a sixth raid…" (no message), the 360px spec (no message) |
| the panel's axis scaled from the total | "the panel has a y-axis of its own…" (the axis read the total's, not `0 1`) |
| the per-raid panel finds a slot over the estimate | "over the newest hours…" (a tooltip where none is expected) |
| the marker not spanning the panels | "draws one marker through both panels" |
| `isRaidsParamClean` always true (no redirect) | "cleans up a ?raids=…", the JavaScript-off spec |
| the range link drops the raids | "the range links carry the raids…" and "picking and unpicking…" (a pick writes no `raids`) |
| the picker shows its own pick, not what is drawn | "unpicking the last raid…" (the default raids not ticked) |
| the tooltip carries no raid lines | "shows the total and each raid for the same moment…" |

Specs 1 (the default), 8 (colours) and 12 (the shade), and the tap half of 14, saw no break of
their own: the red run failed them only on the panel's absence. Vitest holds what they pin
(`pickRaids`, `raidColour`, `notCounted`). All breaks reverted; green at HEAD.

**Review fix loop 1 (S1, S6).** Two specs changed, no new ones; still 204 tests.

- "over the newest hours…" now hovers the bottom panel's last counted step and sees the tooltip
  before moving to the estimate and expecting none, so the count of 0 is the box going away rather
  than a check that could pass before React drew anything. Deliberate break, one build: the
  per-raid panel's `countedOnly` forced off in `ActivityLocal.tsx` — the spec failed at that
  `toHaveCount(0)`. Reverted.
- "refuses a sixth raid…" now expects the `raid-limit-message` live region attached, empty and
  hidden before the refusal (it is mounted empty with the open list so screen readers announce the
  text put into it). Red before the fix, against the build of `92472c9`: `toBeAttached()` found no
  element. Green after.

**Review fix loop 2 (O1).** One spec changed, no new ones; still 204 tests.

- "over the newest hours…" read the last counted step's line count with one `innerText()`, which
  does not retry, while the box could still hold the estimate's one line from the hover before. It
  is now an `expect.poll` over that read, still `toHaveLength(2)`. Deliberate break, one build
  (`npm run e2e -- e2e/activity.spec.ts -g "over the newest hours"`): `activitySlots` gives every
  slot no raid lines — the spec failed at the polled assertion after its 5 s timeout, "Received
  length: 1" with the counted step's own text (no estimate tail), so the poll had read the redrawn
  box. Reverted.

### What is still NOT covered

- The picker's keyboard path (Space on a focused option, arrow keys): the shared component's, and
  the cap goes through the same `toggleRaid` the click does.
- A raid whose line is all zeros beyond "it is drawn": no spec reads a flat line's height.
- Which raid is which colour past three (the specs pick up to five but only compare three colours;
  `raidColour` is Vitest's).
- The per-raid y-axis's labels beyond the King's Fall case (`valueAxis` is Vitest's).
- Per-raid estimates: #199, below.

## 2026-10-26 — #199 the Raid Activity per-raid Provisional estimate

`e2e/activity.spec.ts`, **eight new specs** in a block "the per-raid Provisional estimate", and two
rewritten ones in "the per-raid panel". The suite is now **thirty-three flows, 212 tests including the
two canary setups**. Two existing tooltip specs ("hovering the dashed line…", "a tap on the dashed
line…") read the tooltip's *first line* through `totalLine()`, because an estimated step's box now
holds the raid lines under the total's, as a counted step's already did.

**What the page gained:** each picked raid with an estimate has a dashed segment
(`activity-raid-provisional-line`, `data-raid`) joined on to its last counted point; the bottom panel
shades the total's too-recent span (`activity-raid-too-recent`, replacing `activity-not-counted`, whose
wider "not counted yet" shade and key are gone); a note (`activity-no-estimate-note`) names the picked
raids with no estimate; a tooltip line over an estimated step reads `Name: n · estimate, still arriving`,
or `Name: no estimate`.

**Seed and server:** no run was added. The e2e server sets `ACTIVITY_MIN_RAID_RUNS=6`
(`playwright.config.ts`): Salvation's Edge (RAID_A) has 9 or 10 runs in the training week (the 3 peak
runs, the one 100 hours back, the 6 daily), King's Fall 4, Vault of Glass 3, Last Wish 2, Crota's End 1.
So Salvation's Edge has an estimate and every other seeded raid has none, with 2 runs of margin below and
3 above. Over 24 hours and 7 days Salvation's Edge always has a share to divide by (its seeded runs are
whole hours), so the dashed segment does not depend on the hour of day the suite runs in.

1. **A dashed segment for a raid with history, none for one without** (`?range=24h` and `?range=7d`, picks
   Salvation's Edge and King's Fall): the dashed path begins on the solid line's last vertex, is dashed
   in the solid line's colour, runs through the same steps as the total's dashed line, and King's Fall has
   a solid line, no dashed one, and the note.
2. **The segment stops before the shade it shares with the total** and rises off the floor at 24 hours
   (the seeded recent run).
3. **No note** when every raid picked has an estimate.
4. **The tooltip** over an estimated step on the bottom panel: the total's line with its tail, then
   `Salvation's Edge: n · estimate, still arriving` and `King's Fall: no estimate`; a counted step reads
   King's Fall as a plain `0`.
5. **One marker** through both panels over an estimated step.
6. **JavaScript off:** the dashed segment, King's Fall's absence and the note are in the server's HTML.
7. **At 360px (touch):** five raids picked, four with no estimate: the note names them inside the
   viewport, a tap on an estimated step opens a six-line box with four `no estimate` lines inside the
   viewport, `expectNoOverflow` after each.

Rewritten: "over the newest hours…" now expects the estimate's two lines on either panel and a plain
count on the last counted step (`expect.poll`, for the redraw); "shades the newest hours of the bottom
panel" became "shades the same newest span in both panels, under one key" (same `x` and `width` as the
total's, no `activity-not-counted`).

**Bite proof — the red run.** The specs were written against the new server code and the #198 chart
(`ActivityChart.tsx`, `ActivityLocal.tsx`, `activity-geometry.ts` and `activity-tooltips.ts` as of
`0c34c30`, the red commit): of 46 tests in the file **10 failed and 36 passed**; every failure is one of
the eight new specs (the 24h/7d one counts twice) or the two rewritten ones, and all 36 others,
the two edited tooltip specs among them, still passed. Failing on the dashed segment's absence says
nothing of the later assertions, so four breaks were made on purpose in one build (`npx playwright test
e2e/activity.spec.ts`: 6 failed, 40 passed):

| Break | Spec that failed |
| --- | --- |
| the dashed path starts at its first estimate, not the last counted point | "over 24h…" and "over 7d a raid with history is dashed from its last counted point…" (`Expected "980.92,200"`, received `"986.87,200"` at the join) |
| `raidsWithoutEstimate` always empty (no note) | the JavaScript-off spec and the 360px spec (the note not found); the 24h/7d spec after the join |
| a raid with no estimate reads `Name: 0` | "the tooltip marks a raid's estimate, and says a raid without one has none" |
| the raid line drops its estimate tail | the same spec, and "over the newest hours…" |

The env wiring has no break of its own: with `ACTIVITY_MIN_RAID_RUNS` unset the default 5,000 gives
the seeded Salvation's Edge no estimate, and every dashed-segment spec fails. All breaks reverted;
green at HEAD.

### What is still NOT covered

- A raid whose estimate ends part-way (its curve gives no share for a later step): Vitest's
  (`raids-in-progress.test.ts`), the seed's raids all have shares.
- The threshold's boundary (exactly the minimum): Vitest's. The browser sees 4 against 9 or 10 runs.
- The 30-day range's per-raid estimates: the 3-hour grid can leave no whole Provisional step.
- The values of the per-raid estimates: hour-of-day dependent; Vitest pins them.
