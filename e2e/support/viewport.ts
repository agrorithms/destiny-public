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

/**
 * Elements {@link expectNoOverflow} does not measure, each with the reason it may overflow.
 * Matched with `closest()`, so an entry covers its descendants too.
 *
 * Here and not as a `data-` attribute on the element because application code is not
 * changed to make it testable (CLAUDE.md). Every entry is a decision someone made about a
 * specific element; a broad selector added to quiet a failure defeats the gate.
 */
export const OVERFLOW_EXEMPT: ReadonlyArray<{ selector: string; reason: string }> = [];

/**
 * "Nothing on this page is cut off or pushed past the edge" — the hard gate of the
 * viewport matrix (`npm run visual:check`), and the check a spec runs after an interaction
 * that adds something to the page: a row opened, a tooltip shown, a copy confirmed.
 *
 * Every visible element is measured twice:
 *
 * - **Viewport**: its box sits inside the viewport left to right, unless it is inside a
 *   container that scrolls sideways — then the container is what gets measured, because
 *   the reader can scroll to the rest. Not top to bottom: pages scroll down.
 * - **Clipping**: its box sits inside its nearest clipping ancestor (`overflow: hidden` or
 *   `clip`) on whichever axis that ancestor clips, top and bottom included. This is the
 *   failure {@link expectNoHorizontalPageOverflow} and {@link expectNoElementOverflow}
 *   cannot see: #160's copy bubble was clipped by the list's `overflow-hidden`, so nothing
 *   scrolled and nothing reported it.
 *
 * Not measured: SVG internals (charts draw where they like inside their own `<svg>`),
 * zero-size elements, anything `checkVisibility()` says is hidden or transparent, text
 * hidden for screen readers (`clip` / `clip-path`), and children of an ancestor that clips
 * with an ellipsis or a line clamp — that clipping is the design. Absolutely positioned
 * popups are measured: the bubble was one. A fixed element is measured against the
 * viewport only, and an absolute one only against ancestors at or above its containing
 * block, because those are the only boxes that can clip it.
 *
 * Children of an element already reported are not reported again, so one wide row reads
 * as one failure rather than forty.
 */
export async function expectNoOverflow(page: Page): Promise<void> {
    const offenders = await page.evaluate(auditOverflow, OVERFLOW_EXEMPT.map((entry) => entry.selector));
    expect(offenders, 'elements overflow the viewport or are clipped by an ancestor').toEqual([]);
}

/**
 * Runs in the page (via `page.evaluate`), so it must be self-contained: no imports, no
 * references to anything outside its own body.
 */
function auditOverflow(exempt: string[]): string[] {
    // Sub-pixel layout rounds differently per element; a real overflow is whole pixels.
    const TOLERANCE = 1;
    const styles = new Map<Element, CSSStyleDeclaration>();
    const style = (el: Element) => {
        let cs = styles.get(el);
        if (!cs) styles.set(el, (cs = getComputedStyle(el)));
        return cs;
    };
    const clips = (value: string) => value === 'hidden' || value === 'clip';
    const scrolls = (value: string) => value === 'auto' || value === 'scroll';

    const describe = (el: Element) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className
            ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
            : '';
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
        return `<${el.tagName.toLowerCase()}${id}${cls}>${text ? ` "${text}"` : ''}`;
    };

    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const offenders: string[] = [];
    const reported = new Set<Element>();

    if (root.scrollWidth > viewportWidth + TOLERANCE) {
        offenders.push(`the page scrolls sideways by ${root.scrollWidth - viewportWidth}px`);
    }

    for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
        if (exempt.some((selector) => el.closest(selector))) continue;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;

        const box = el.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;

        // Visually hidden text (Tailwind's sr-only) and anything inside a clip-path.
        let hidden = false;
        for (let a: Element | null = el; a && a !== root; a = a.parentElement) {
            const cs = style(a);
            if (cs.clipPath !== 'none' || (cs.clip && cs.clip !== 'auto')) { hidden = true; break; }
        }
        if (hidden) continue;

        // Children of a reported element overflow by the same pixels; say it once.
        let parentReported = false;
        for (let a = el.parentElement; a; a = a.parentElement) {
            if (reported.has(a)) { parentReported = true; break; }
        }
        if (parentReported) continue;

        const position = style(el).position;
        // Only ancestors at or above the containing block can clip a positioned element.
        let ancestor: Element | null =
            position === 'fixed' ? null
            : position === 'absolute' ? (el as HTMLElement).offsetParent
            : el.parentElement;

        const problems: string[] = [];
        let insideSideScroller = false;
        let nearestChecked = false;

        for (; ancestor && ancestor !== root && ancestor !== document.body; ancestor = ancestor.parentElement) {
            const cs = style(ancestor);
            if (scrolls(cs.overflowX)) insideSideScroller = true;
            if (nearestChecked) continue;
            if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;

            // The nearest ancestor that does anything with overflow decides; one further
            // out can only clip this element by also clipping that one, which is then
            // reported on its own.
            nearestChecked = true;
            if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) continue;

            // A container clipped to nothing is a collapsed section, not a clipped child.
            if (ancestor.clientWidth === 0 || ancestor.clientHeight === 0) continue;

            const outer = ancestor.getBoundingClientRect();
            // The clip edge is the padding box: inside the borders.
            const left = outer.left + ancestor.clientLeft;
            const top = outer.top + ancestor.clientTop;
            const right = left + ancestor.clientWidth;
            const bottom = top + ancestor.clientHeight;

            if (clips(cs.overflowX)) {
                if (box.left < left - TOLERANCE) problems.push(`clipped ${(left - box.left).toFixed(1)}px on the left`);
                if (box.right > right + TOLERANCE) problems.push(`clipped ${(box.right - right).toFixed(1)}px on the right`);
            }
            if (clips(cs.overflowY)) {
                if (box.top < top - TOLERANCE) problems.push(`clipped ${(top - box.top).toFixed(1)}px at the top`);
                if (box.bottom > bottom + TOLERANCE) problems.push(`clipped ${(box.bottom - bottom).toFixed(1)}px at the bottom`);
            }
            if (problems.length > 0) problems.push(`by ${describe(ancestor)}`);
        }

        if (!insideSideScroller) {
            if (box.left < -TOLERANCE) problems.push(`${(-box.left).toFixed(1)}px past the viewport's left edge`);
            if (box.right > viewportWidth + TOLERANCE) {
                problems.push(`${(box.right - viewportWidth).toFixed(1)}px past the viewport's right edge`);
            }
        }

        if (problems.length > 0) {
            reported.add(el);
            offenders.push(`${describe(el)}: ${problems.join(', ')}`);
        }
    }
    return offenders;
}
