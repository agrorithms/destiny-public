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
  `85` = client-write-guard) applied to both membership ids and display names, so no two specs
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
props.

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
