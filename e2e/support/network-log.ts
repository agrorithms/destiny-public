import type { Page } from '@playwright/test';
import { PAGE_TOKEN_HEADER } from '../../src/lib/http/request-auth';

/**
 * Records every browser → app request to /api/players/** in call order.
 *
 * What Vitest cannot provide: which requests the profile page actually makes, in
 * what order. Since #9001 the claim that matters most is a negative one, that the
 * only write a profile view sends is the history-crawl request (ids only) and
 * every other call is a read. `hasPageToken` is recorded per entry because the
 * token surviving the RSC boundary into a real header is itself an assertion no
 * unit test can make.
 *
 * Shared by profile-live-card.spec.ts and profile-roster-names.spec.ts.
 */
export interface NetworkEntry {
    method: string;
    path: string;
    hasPageToken: boolean;
}

/**
 * A pure observer via `page.on`, deliberately not `page.route`.
 *
 * A route handler would claim a slot in Playwright's reverse-registration
 * routing stack for these URLs — so a later spec that needs to *fulfil* an
 * /api/players response would silently stop being logged, and every logged
 * request would be re-issued through `route.continue()`. `page.on('request')`
 * sees everything, conflicts with nothing, and needs no await.
 */
export function interceptApiCalls(page: Page): NetworkEntry[] {
    const log: NetworkEntry[] = [];

    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/players/')) return;
        log.push({
            method: request.method(),
            path: url.pathname + url.search,
            hasPageToken: PAGE_TOKEN_HEADER in request.headers(),
        });
    });

    return log;
}

/**
 * The profile specs wait on queue-crawl, which is fire-and-forget — the
 * waiter has to be armed before navigating or it can miss the response.
 */
export function waitForQueueCrawl(page: Page) {
    return waitForPost(page, '/api/players/queue-crawl');
}

/**
 * The "profile viewed" request (#9003) is fire-and-forget too, and it can follow the page's
 * live check by a probe or two, so the waiter is armed before navigating, as for queue-crawl.
 * Resolves on the response, whatever its status.
 */
export function waitForProfileViewed(page: Page) {
    return waitForPost(page, '/api/players/profile-viewed');
}

/** The response to the page's next POST to `path`, whatever its status. */
function waitForPost(page: Page, path: string) {
    return page.waitForResponse(
        (res) => res.url().includes(path) && res.request().method() === 'POST',
        { timeout: 15_000 },
    );
}

/** The bodies the page POSTed to profile-viewed, parsed, in call order. A pure observer, like interceptApiCalls. */
export function recordProfileViewed(page: Page): Array<Record<string, unknown>> {
    const bodies: Array<Record<string, unknown>> = [];
    page.on('request', (request) => {
        if (request.method() !== 'POST' || !request.url().includes('/api/players/profile-viewed')) return;
        bodies.push(JSON.parse(request.postData() ?? 'null'));
    });
    return bodies;
}
