import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Mints the throwaway database the whole e2e run points at.
 *
 * This file must not import anything that reaches `src/lib/db`, directly or
 * transitively. `DB_PATH` in src/lib/db/index.ts is a module-level const
 * resolved at *import* time, so the env vars below have to be set before that
 * module is first loaded anywhere in the process. It is the same ordering
 * constraint tests/setup/test-db-path.ts solves for Vitest — that file can't be
 * reused because it imports `afterAll` from `vitest`. Seeding therefore lives in
 * ./seed-world.ts, which is loaded only after this has run.
 *
 * Called from playwright.config.ts at config load, which is the earliest point
 * the run controls and the only place that builds `webServer.env`.
 */

/**
 * The page-token secret the whole e2e run shares, pinned into both the runner
 * (below, at config load) and the server (playwright.config.ts webServer.env).
 *
 * Pinned rather than passed through from the shell, because two things are
 * invisible otherwise: `next start` loads .env, so an unpinned server verifies
 * against the developer's real secret while the runner mints with whatever the
 * shell exported; and where no .env supplies one at all — CI, a fresh clone —
 * verifyPageToken() fails *open*, disabling the token half of the guard so every
 * token assertion passes for the wrong reason. Production runs with the secret
 * set, so that is the configuration worth proving.
 *
 * Same literal shape as tests/routes/write-route-setup.ts, for the same reason.
 */
export const E2E_PAGE_TOKEN_SECRET = 'e2e-page-token-secret-not-a-real-credential';

/** Env vars every process in the e2e run needs. Kept in one place so the config
 *  and the workers cannot drift on the list. */
export const FIXTURE_DB_ENV_KEYS = [
    'RAID_TRACKER_DB_PATH',
    'DFF_TEST_DB_SENTINEL',
    // The app opens two databases, and the Archive's guard is a separate opt-in:
    // assertDbPathAllowed() in src/lib/db/archive/index.ts compares against its own
    // sentinel. Listed here so the fail-fast covers them too — unset, the `next start`
    // child inherits nothing and opens data/gos-10k.db, the real 63 MB serving copy,
    // and every /gos10k spec would assert against production data.
    'GOS10K_ARCHIVE_DB_PATH',
    'DFF_TEST_GOS10K_DB_SENTINEL',
    'DFF_E2E',
    'DFF_E2E_RUN_ID',
] as const;

/**
 * Idempotent by design. playwright.config.ts is re-loaded in every worker
 * process, and workers inherit the runner's env — so a second call must reuse
 * the already-minted path rather than creating a fresh directory that nothing
 * else knows about. Without this, workers would seed one database while the
 * server read another and every assertion would fail for a reason nowhere near
 * the test.
 */
export function mintFixtureDbPath(): string {
    const existing = process.env.RAID_TRACKER_DB_PATH;
    if (process.env.DFF_E2E && existing) {
        return path.resolve(existing);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-e2e-'));
    const dbPath = path.join(dir, 'e2e.db');
    // Sibling of the Tracker fixture in the same mkdtemp directory: one directory
    // is the whole run's state, so the two fixture databases cannot collide and
    // there is one path on screen when a failure sends you to a sqlite3 shell.
    // Mirrors tests/setup/test-db-path.ts, which does the same for Vitest.
    const archiveDbPath = path.join(dir, 'gos-10k-e2e.db');

    process.env.RAID_TRACKER_DB_PATH = dbPath;
    // The one database any process in this run is allowed to open. getDb()
    // compares DB_PATH against it and refuses anything else while DFF_E2E is
    // set — see assertDbPathAllowed() in src/lib/db/index.ts.
    process.env.DFF_TEST_DB_SENTINEL = dbPath;
    // The Archive's equivalent pair. Unlike the Tracker's, the file itself is not
    // created here: getArchiveDb() opens `fileMustExist`, and e2e/support/archive-world.ts
    // mints it from the committed seed in globalSetup. Setting the path without
    // minting the file is a loud 500 on /gos10k, never a silently empty database.
    process.env.GOS10K_ARCHIVE_DB_PATH = archiveDbPath;
    process.env.DFF_TEST_GOS10K_DB_SENTINEL = archiveDbPath;
    process.env.DFF_E2E = '1';
    // Unique per run, and baked into the canary row. A server left over from an
    // earlier run would still hold a canary — just the *previous* run's — so
    // without this the canary check would pass while every spec silently read a
    // stale database. See canaryDisplayName() in ./seed-world.ts.
    process.env.DFF_E2E_RUN_ID = path.basename(dir).replace('dff-e2e-', '');

    return dbPath;
}

/** The nonce that ties the canary row to this specific run. */
export function fixtureRunId(): string {
    const runId = process.env.DFF_E2E_RUN_ID;
    if (!runId) {
        throw new Error('DFF_E2E_RUN_ID is unset — mintFixtureDbPath() did not run.');
    }
    return runId;
}

/**
 * The minted Tracker path, for code running after config load. Throws rather than
 * falling back, because a silent fallback here is the live 5.5 GB database.
 */
export function fixtureDbPath(): string {
    const dbPath = process.env.RAID_TRACKER_DB_PATH;
    if (!dbPath || !process.env.DFF_E2E) {
        throw new Error(
            'The e2e fixture database was never minted. mintFixtureDbPath() runs from ' +
            'playwright.config.ts at config load — if you are seeing this, that did not happen.'
        );
    }
    return path.resolve(dbPath);
}

/**
 * The minted Archive path. Throws for the same reason as fixtureDbPath(): a silent
 * fallback here is `data/gos-10k.db`, the real serving copy.
 */
export function fixtureArchiveDbPath(): string {
    const dbPath = process.env.GOS10K_ARCHIVE_DB_PATH;
    if (!dbPath || !process.env.DFF_E2E) {
        throw new Error(
            'The e2e fixture Archive path was never minted. mintFixtureDbPath() runs from ' +
            'playwright.config.ts at config load — if you are seeing this, that did not happen.'
        );
    }
    return path.resolve(dbPath);
}
