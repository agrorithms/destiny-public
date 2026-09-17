import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The Resets panel (#93) — the half of it that only a browser can see.
 *
 * The populations, their durations and that they partition the Runs are asserted in
 * Vitest (tests/db/archive-resets.test.ts) with specific counts. This file asserts no
 * figures, the same rule every Archive spec follows.
 *
 * What is left is the empty state — a range with no non-clears renders one sentence
 * rather than four "none"s and an equation of zeroes, which only a rendered page shows —
 * and #93's phone criterion.
 */
test.describe('the Resets panel', () => {
    test('says there is nothing to report for a range that is one clear', async ({ page }) => {
        // A one-clear range resolves to that Run's own instant, so it holds no other Run
        // (tests/db/archive-resets.test.ts).
        await page.goto('/gos10k?clearFrom=102&clearTo=102');

        const section = page.getByRole('region', { name: 'The runs that did not become clears' });
        await expect(section).toBeVisible();
        await expect(section.getByText(/nothing to report/i)).toBeVisible();
        await expect(page.getByTestId('archive-resets')).toHaveCount(0);
        await expect(section).not.toContainText('NaN');
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the panel inside a 360px viewport', async ({ page }) => {
            await page.goto('/gos10k');

            const panel = page.getByTestId('archive-resets');
            await expect(panel).toBeVisible();

            await expectNoElementOverflow(panel, 'the Resets panel');
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
