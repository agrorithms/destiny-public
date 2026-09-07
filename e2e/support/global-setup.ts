import { fixtureDbPath } from './fixture-db';
import { mintCanariedArchive } from './archive-world';

/**
 * Seeds the fixture world once, before any spec runs.
 *
 * Deliberately does no HTTP: whether Playwright starts `webServer` before or
 * after globalSetup is an implementation detail this run should not depend on.
 * The proof that the *server* is on the fixture database is a separate step —
 * e2e/support/canary.setup.ts, wired as a project dependency so its ordering is
 * guaranteed by construction rather than by assumption.
 *
 * The seed-world import is dynamic so it happens strictly after fixtureDbPath()
 * has confirmed the env is in place. seed-world reaches src/lib/db, whose
 * DB_PATH is frozen at import time. ./archive-world is safe as a static import
 * by contrast: it reaches better-sqlite3 and tests/helpers only, never src/lib/db.
 */
export default async function globalSetup(): Promise<void> {
    const dbPath = fixtureDbPath();

    const { seedStaticWorld } = await import('./seed-world');
    seedStaticWorld();

    // Built rather than seeded: the Archive is a frozen file in production, so the
    // fixture is minted whole from the committed seed instead of having rows
    // inserted into an existing schema. See ./archive-world.ts.
    const archiveDbPath = mintCanariedArchive();

    // Printed unconditionally: when a spec fails, the first useful question is
    // "what was actually in the database", and the answer is a sqlite3 command
    // away only if the path is on screen. The directory is left in place for
    // that reason; it is a few hundred KB in the OS temp dir.
    console.log(`[e2e] fixture database seeded at ${dbPath}`);
    console.log(`[e2e] fixture Archive built at ${archiveDbPath}`);
}
