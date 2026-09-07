import { expect, test } from '@playwright/test';
import { archiveCanaryDisplayName } from './archive-world';

/**
 * The Archive's half of the fixture-database proof: it *observes* which Archive
 * the running server opened, rather than reasoning about configuration.
 *
 * Sibling of ./canary.setup.ts, and it exists for the same reason — the two
 * layers that already guard the path (assertDbPathAllowed() in
 * src/lib/db/archive/index.ts, and the FIXTURE_DB_ENV_KEYS fail-fast in
 * playwright.config.ts) both reason about env vars, and neither can fire if the
 * env never reaches the `next start` child. That is exactly the failure they
 * exist to prevent, and here it would end with the specs reading the real 63 MB
 * serving copy. This asks the server.
 *
 * Two differences from the Tracker's canary, both forced by the Archive:
 *
 *   1. There is no /api/gos10k route to ask, and adding one would be application
 *      code written for a test — the thing CLAUDE.md's testing section rules out.
 *      So the check reads the rendered page instead. That is the stronger proof
 *      anyway: it goes through the same getArchiveDb() singleton and the same
 *      server component the specs exercise, not a parallel endpoint that could
 *      diverge from it.
 *   2. The page is HTML, not a `no-store` JSON route, so `no-cache` is sent
 *      explicitly. `reuseExistingServer: false` means a cold server per run and
 *      /gos10k is `force-dynamic`, so today nothing could serve a stale render —
 *      but issue #95 is about to change this route's cache lifetime, and a
 *      binding proof that quietly depends on cache behaviour is not a proof.
 *
 * Still `request` rather than `page`, like its sibling: this is a configuration
 * proof, not a rendering test. The rendering is gos10k-smoke.spec.ts's job.
 */
test('the server is serving this run\'s fixture Archive', async ({ request }) => {
    const expected = archiveCanaryDisplayName();

    const response = await request.get('/gos10k', { headers: { 'Cache-Control': 'no-cache' } });

    // A 500 here is the Archive's designed failure mode (ADR 0007): a missing or
    // mismatched file takes out this one route and nothing else. Report it as
    // itself rather than letting the body assertion below describe it as a
    // missing canary.
    expect(
        response.status(),
        '/gos10k did not render — if this is a 500, the fixture Archive was not minted at the ' +
        'path the server was given, or getArchiveDb() rejected it'
    ).toBe(200);

    // The canary name carries a per-run nonce, so a server left over from an
    // earlier run holds the *previous* run's canary and fails here rather than
    // letting every spec read a stale Archive.
    expect(
        await response.text(),
        'the running server is not reading this run\'s fixture Archive — it may be a stale ' +
        'server from an earlier run, or GOS10K_ARCHIVE_DB_PATH did not reach `next start`'
    ).toContain(expected);
});
