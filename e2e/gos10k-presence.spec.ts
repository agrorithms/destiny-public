import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The presence strip (#89) — the half of it that only a browser can see.
 *
 * The share, the two totals, the late-join count and the envelope over two characters
 * are arithmetic over the fixture Archive, asserted in Vitest
 * (tests/db/archive-presence.test.ts) with specific seconds. This file asserts no
 * figures, the same rule every Archive spec follows.
 *
 * What is left is what no other seam reaches: that a range with no clears renders a
 * stated empty state rather than `NaN%` or a 0% bar (Vitest proves the query returns
 * zeroes; only a rendered page proves the panel then says so — there is no component
 * harness), and #89's phone criterion.
 */
test.describe('the presence strip', () => {
    test('says there is nothing to measure for a range with no clears', async ({ page }) => {
        // November 2020 holds one Run and no Pinned Full Clear, and resolves rather than
        // degrading (tests/db/archive-range.test.ts).
        await page.goto('/gos10k?from=2020-11-01&to=2020-11-30');

        const section = page.getByRole('region', { name: 'How much of each clear he was there for' });
        await expect(section).toBeVisible();
        await expect(section.getByText(/no presence to measure/i)).toBeVisible();
        await expect(page.getByTestId('archive-presence-strip')).toHaveCount(0);
        await expect(section).not.toContainText('NaN');
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the strip inside a 360px viewport', async ({ page }) => {
            await page.goto('/gos10k');

            const strip = page.getByTestId('archive-presence-strip');
            await expect(strip).toBeVisible();

            await expectNoElementOverflow(strip, 'the presence strip');
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
