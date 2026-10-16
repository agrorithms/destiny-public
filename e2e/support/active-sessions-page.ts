import { expect, type Page } from '@playwright/test';

/**
 * Driving /active-sessions through its data: Refresh, and a maintenance response.
 *
 * Extracted because the expand spec (#158) and the collapse spec (#159) each carried a
 * word-for-word copy of both. Two specs prove that page state survives a maintenance response
 * (open rows, collapsed sections). If their stubs drifted apart, one could be stubbing a
 * response the page no longer treats as maintenance.
 *
 * A separate file from fireteam-rows.ts, which only builds locators, and from viewport.ts,
 * which only measures layout: these act on the page. Playwright-only, so it imports from
 * '@playwright/test' directly.
 */

/**
 * The page's sessions request, matched by path. One rule for the stub and for the wait on a
 * response, so the two can't disagree about which requests count.
 */
function isSessionsRequest(url: URL): boolean {
    return url.pathname === '/api/active-sessions';
}

/** The banner text the maintenance stub sends, so a spec can wait for it. */
export const MAINTENANCE_MESSAGE = 'Database maintenance is in progress.';

/**
 * Clicks Refresh and waits for the new response to render. Refresh runs the same fetch as the
 * 30-second poll. The button is disabled while that fetch is in flight, so its being enabled
 * again means the response has rendered.
 */
export async function refreshSessions(page: Page): Promise<void> {
    const refreshed = page.waitForResponse((response) => isSessionsRequest(new URL(response.url())));
    await page.getByRole('button', { name: 'Refresh' }).click();
    await refreshed;
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
}

/**
 * Answers every /api/active-sessions request from here on with the route's maintenance
 * response: no sessions, because none could be read, not because they ended. The page's own
 * fetch and its handling of the response are what run. {@link endMaintenance} lets the real
 * API answer again.
 *
 * This stubs one of our own API routes, which ADR 0004 otherwise forbids in the browser
 * suite. It is the one exception the ADR's 2026-10-15 amendment allows: the e2e server can't
 * be put into maintenance, so a stub is the only way to get this response. Anything the
 * server *can* be driven into is seeded instead (see `endFireteams` in seed-world.ts).
 */
export async function serveMaintenance(page: Page): Promise<void> {
    await page.route(isSessionsRequest, (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            raidKey: 'all', count: 0, total: 0, shown: 0, sessions: [],
            maintenance: true, message: MAINTENANCE_MESSAGE,
        }),
    }));
}

/** Removes {@link serveMaintenance}'s stub, so the next fetch reaches the real API. */
export async function endMaintenance(page: Page): Promise<void> {
    await page.unroute(isSessionsRequest);
}
