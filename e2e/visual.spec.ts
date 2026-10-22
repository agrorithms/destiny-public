import path from 'node:path';
import type { Page, Request } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { expectNoOverflow } from './support/viewport';

/**
 * The viewport matrix: every route `npm run visual:check` lists, at 360 / 768 / 1280px in
 * light and dark. Runs only under the six `visual-*` projects, which playwright.config.ts
 * defines only when VISUAL_ROUTES is set — so `npm run e2e` never sees this file.
 *
 * Two outputs with different jobs. The screenshot is for a human to review and asserts
 * nothing. The overflow check is the gate: a page with something clipped or pushed past
 * the edge fails, and it is taken after the screenshot so the evidence exists either way.
 *
 * This measures pages as they load. Overflow that only appears after an interaction (#160's
 * copy bubble appeared on click) belongs in that interaction's spec, which calls
 * expectNoOverflow() itself.
 */

interface VisualRoute {
    /** Folder- and filename-safe name: `home`, `active-sessions`, `player`. */
    slug: string;
    path: string;
}

const routes: VisualRoute[] = JSON.parse(process.env.VISUAL_ROUTES ?? '[]');
const VISUAL_DIR = path.join(process.cwd(), 'visual-check');

/** How long no request may be awaiting its response before the page counts as drawn. */
const QUIET_MS = 500;

/**
 * Navigates, then waits until no request has been awaiting its response for QUIET_MS:
 * client pages fetch their data after load, and a screenshot taken before it arrives
 * shows a spinner.
 *
 * Not `waitUntil: 'networkidle'`, which also waits for every response *body* to be read.
 * The player page's queue-crawl POST is fire-and-forget (queueCrawlOnce in
 * PlayerProfileClient.tsx never reads the reply), so Chromium never counts it finished
 * and networkidle never comes, though the 202 arrives in milliseconds. A response
 * arriving is what this wait needs; the body is the page's business.
 */
async function gotoAndSettle(page: Page, url: string): Promise<void> {
    const pending = new Set<Request>();
    page.on('request', (request) => pending.add(request));
    page.on('response', (response) => pending.delete(response.request()));
    page.on('requestfailed', (request) => pending.delete(request));
    page.on('requestfinished', (request) => pending.delete(request));

    await page.goto(url, { waitUntil: 'load' });
    let quietSince = Date.now();
    while (Date.now() - quietSince < QUIET_MS) {
        if (pending.size > 0) quietSince = Date.now();
        await page.waitForTimeout(50);
    }
}

for (const route of routes) {
    test(`${route.slug} (${route.path})`, async ({ page }, testInfo) => {
        const width = page.viewportSize()?.width;
        const theme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light';

        await gotoAndSettle(page, route.path);
        await page.evaluate(() => document.fonts.ready);

        // The pre-paint script in layout.tsx sets `.dark` from the OS preference when
        // nothing is stored, which is what colorScheme emulates. Asserted so a dark
        // screenshot can never silently be a light one.
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        else await expect(page.locator('html')).not.toHaveClass(/dark/);

        // route, width and theme in the folder *and* the filename, so a file copied out of
        // its folder still says what it is.
        await page.screenshot({
            path: path.join(VISUAL_DIR, route.slug, `${route.slug}--${width}--${theme}.png`),
            fullPage: true,
            animations: 'disabled',
        });

        await expectNoOverflow(page);
    });
}
