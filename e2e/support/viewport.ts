import { expect, type Page } from '@playwright/test';

/**
 * "The page does not scroll sideways at this viewport" — the phone criterion three
 * /gos10k specs assert (the shell, the range filter, the fastest-clears panel).
 *
 * Written once because it was hand-rolled three times, each with its own copy of the
 * `documentElement.scrollWidth - clientWidth` probe and the same message string. How
 * page overflow is *measured* is one decision — whether a scrollbar counts, whether a
 * ResizeObserver would be better — and three specs disagreeing about it silently is
 * exactly the drift this repo extracts fragments to avoid.
 *
 * Lives in e2e/support/ and is Playwright-only, so unlike tests/helpers/ it may import
 * from '@playwright/test' directly.
 */
export async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(0);
}
