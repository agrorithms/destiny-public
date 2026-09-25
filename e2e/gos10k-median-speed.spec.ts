import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The median speed board (#92) — the half of it that only a browser can see.
 *
 * The medians, the floor, the tie-break and the empty state are arithmetic over the
 * fixture Archive and are asserted in Vitest (tests/db/archive-median-speed.test.ts)
 * with named Helpers and specific durations. Repeating any of that here would buy
 * nothing and break on every re-extraction of the fixture, so this file asserts no
 * counts, no names and no durations — the same rule the fastest-clears spec follows.
 *
 * What is left is two things no other seam reaches. The first is #92's empty-state
 * criterion — "renders an intelligible empty state rather than a blank panel or an
 * error". Vitest can prove the *query* returns nothing; only a rendered page can prove
 * the panel then says so, and this app has no component-test harness (Vitest runs in
 * `node` with no jsdom, and adding one for a single branch is more machinery than the
 * branch is worth). The second is #92's phone criterion. This panel is a three-column table whose first
 * column holds `Name#Code` in full, which is the column most likely to push a table
 * past a 360px viewport — and a table that overflows is invisible to every other seam:
 * the server-rendered DOM is identical either way and JSDOM reports every element as
 * zero-wide.
 */
test.describe('the median speed board', () => {
    test('says why it is empty when no guardian reaches the floor', async ({ page }) => {
        // Two clears, so the most-present guardian in the window has two — the fixture's
        // canary is joined to every Run and still cannot reach fifteen. A range rather
        // than a hand-picked date because clear numbers are what the floor is counted
        // in, and `clearFrom`/`clearTo` is the same grammar the range control writes.
        await page.goto('/gos10k?clearFrom=103&clearTo=104&tab=rankings');

        // The panel is still on the page — an empty board that disappeared would pass a
        // "no table" assertion while being exactly the blank panel the criterion rules
        // out. So: heading present, table absent, reason stated.
        await expect(
            page.getByRole('heading', { name: 'Consistently fastest' })
        ).toBeVisible();
        await expect(page.getByTestId('archive-median-speed')).toHaveCount(0);
        await expect(page.getByText(/no guardian was present for/i)).toBeVisible();
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the board inside a 360px viewport', async ({ page }) => {
            await page.goto('/gos10k?tab=rankings');

            // By testid rather than by role: `getByRole('table')` binds to whatever is in
            // a `<table>`, and the Helper board above this one would capture the
            // assertion silently (docs/handoffs/260803-playwright-e2e.md).
            const board = page.getByTestId('archive-median-speed');
            await expect(board).toBeVisible();

            // The table's own box first — a wide unbreakable cell scrolls the table
            // rather than the page when an ancestor has its own overflow.
            await expectNoElementOverflow(board, 'the board');

            // And the page, which is how a wide table usually announces itself.
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
