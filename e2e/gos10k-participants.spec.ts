import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The participants panel and the class split (#94) — the half of them only a browser can
 * see.
 *
 * The buckets, the distinct-membership rule, the duos being kept and the class counts are
 * asserted in Vitest (tests/db/archive-composition.test.ts) with specific figures. This
 * file asserts no figures, the same rule every Archive spec follows — and the e2e Archive
 * carries a canary Helper joined to every Run, which moves both panels' counts anyway.
 *
 * What is left is the participants panel's empty state — a range with no clears renders a
 * sentence rather than a zero headline over seven empty rows — and #94's phone criterion
 * for both panels.
 */
test.describe('the participants panel', () => {
    test('says there is nobody to count for a range with no clears', async ({ page }) => {
        // November 2020 holds one Run and no Pinned Full Clear, and resolves rather than
        // degrading (tests/db/archive-range.test.ts).
        await page.goto('/gos10k?from=2020-11-01&to=2020-11-30&tab=participants');

        const section = page.getByRole('region', { name: 'How many people were in each clear' });
        await expect(section).toBeVisible();
        await expect(section.getByText(/nobody to count/i)).toBeVisible();
        await expect(page.getByTestId('archive-participants')).toHaveCount(0);
        await expect(section).not.toContainText('NaN');
    });

    test('labels the column as people who entered', async ({ page }) => {
        await page.goto('/gos10k?tab=participants');

        const panel = page.getByTestId('archive-participants');
        await expect(panel.getByRole('columnheader', { name: 'People who entered' })).toBeVisible();
        await expect(panel.getByRole('figure')).toContainText(/trio clear/);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps both panels inside a 360px viewport', async ({ page }) => {
            await page.goto('/gos10k?tab=participants');

            const participants = page.getByTestId('archive-participants');
            const classes = page.getByTestId('archive-class-split');
            await expect(participants).toBeVisible();
            await expect(classes).toBeVisible();

            await expectNoElementOverflow(participants, 'the participants panel');
            await expectNoElementOverflow(classes, 'the class split');
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
