import { expect, test } from './support/test-fixtures';
import { expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The median speed board (#92) — the half of it that only a browser can see.
 *
 * The medians, the floor, the tie-break and the empty state are arithmetic over the
 * fixture Archive and are asserted in Vitest (tests/db/archive-median-speed.test.ts)
 * with named Helpers and specific durations. Repeating any of that here would buy
 * nothing and break on every re-extraction of the fixture, so this file asserts no
 * counts, no names and no durations — the same rule the fastest-clears spec follows.
 *
 * What is left is #92's phone criterion. This panel is a three-column table whose first
 * column holds `Name#Code` in full, which is the column most likely to push a table
 * past a 360px viewport — and a table that overflows is invisible to every other seam:
 * the server-rendered DOM is identical either way and JSDOM reports every element as
 * zero-wide.
 */
test.describe('the median speed board', () => {
    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the board inside a 360px viewport', async ({ page }) => {
            await page.goto('/gos10k');

            // By testid rather than by role: `getByRole('table')` binds to whatever is in
            // a `<table>`, and the Helper board above this one would capture the
            // assertion silently (docs/handoffs/260803-playwright-e2e.md).
            const board = page.getByTestId('archive-median-speed');
            await expect(board).toBeVisible();

            // The table's own box first — a wide unbreakable cell scrolls the table
            // rather than the page when an ancestor has its own overflow.
            const overflow = await board.evaluate((el) => el.scrollWidth - el.clientWidth);
            expect(overflow, 'the board scrolls sideways at 360px').toBeLessThanOrEqual(0);

            // And the page, which is how a wide table usually announces itself.
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
