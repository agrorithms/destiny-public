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

/**
 * "This element sits inside the viewport, left edge and right edge" — the phone criterion
 * for one control, row or tooltip, which neither overflow helper above can see. An ancestor
 * with `overflow: hidden` (a rounded card, a truncated cell) clips a too-wide child, so
 * neither the page nor the ancestor scrolls, and the part past the edge is cut off without
 * anything reporting it.
 *
 * Extracted because the `box.x >= 0` / `box.x + box.width <= 360` pair had been hand-written
 * five times across four specs (the list view's toggle and row, the expanded row's members,
 * #159's controls and collapsed header, the timeline's tooltip), with a hard-coded 360 and
 * four wordings for the failure. The width is the page's own viewport, so a spec run at
 * another size measures against that size.
 */
export async function expectInsideViewport(element: Locator, what: string): Promise<void> {
    const viewport = element.page().viewportSize();
    if (!viewport) throw new Error('nothing to measure against: the page has no fixed viewport');
    const box = await boxOf(element);
    expect(box.x, `${what} starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${what} ends inside the viewport`).toBeLessThanOrEqual(viewport.width);
}
