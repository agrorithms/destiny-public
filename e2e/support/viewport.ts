import { expect, type Locator, type Page } from '@playwright/test';

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

/**
 * "This element does not scroll sideways inside its own box" — the other half of the
 * phone criterion, and the one {@link expectNoHorizontalPageOverflow} cannot see. An
 * ancestor with its own `overflow` absorbs a too-wide child, so the page measures clean
 * while the panel itself is the thing a reader has to drag.
 *
 * Extracted for the same reason as its page-level sibling above: the
 * `scrollWidth - clientWidth` probe had been hand-rolled three times (the shell's
 * headline figure, the fastest-clears chip row, the median speed board's table), each
 * with its own copy of the arithmetic and its own wording for the failure.
 */
export async function expectNoElementOverflow(element: Locator, what: string): Promise<void> {
    const overflow = await element.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, `${what} scrolls sideways at this viewport`).toBeLessThanOrEqual(0);
}

/**
 * An element's rendered box, or a failure that says it has none.
 *
 * `boundingBox()` returns null for an element that is not rendered, and each spec that
 * measured layout had its own answer to that — a throw, an `expect(...).not.toBeNull()`,
 * a non-null assertion. A layout assertion against a missing element is a failed test,
 * whichever spec makes it, so the answer is written once.
 */
export async function boxOf(element: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await element.boundingBox();
    if (!box) throw new Error('nothing to measure: the element is not rendered');
    return box;
}
