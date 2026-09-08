import { expect, test } from './support/test-fixtures';

/**
 * The page shell from issue #86 — the part of /gos10k that is only checkable in
 * a browser.
 *
 * The numbers themselves are the Archive query module's job and are asserted
 * over the fixture Archive in Vitest (tests/db/archive-predicates.test.ts).
 * What cannot be asserted there, and is asserted here, is exactly two things
 * from #86's acceptance criteria: the methodology is *closed* by default, which
 * is a rendered-DOM property, and the shell is readable on a phone without a
 * horizontal page scroll or a clipped headline, which needs a real layout.
 *
 * Deliberately asserts no counts and no dates — #85 widens the fixture Archive
 * immediately after this and every one of those would break for no benefit.
 * The headline is located by its label, not by its value.
 */
test.describe('the GoS 10k page shell', () => {
    test('leads with the Pinned Full Clear figure and states the population it counts', async ({ page }) => {
        await page.goto('/gos10k');

        const headline = page.getByTestId('archive-headline-figure');
        await expect(headline).toBeVisible();
        await expect(page.getByTestId('archive-headline-population')).toContainText('Pinned Full Clears');
    });

    test('keeps the methodology closed until the reader asks for it', async ({ page }) => {
        await page.goto('/gos10k');

        // The sentence that only exists inside the methodology copy.
        const methodology = page.getByText('two defensible answers');
        await expect(methodology).toBeHidden();

        await page.getByRole('group').getByText('How the 10,000 is counted').click();
        await expect(methodology).toBeVisible();
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('renders without a horizontal page scroll or a clipped headline', async ({ page }) => {
            await page.goto('/gos10k');

            const overflow = await page.evaluate(() => {
                const root = document.documentElement;
                return root.scrollWidth - root.clientWidth;
            });
            expect(overflow, 'the page scrolls horizontally at 360px').toBeLessThanOrEqual(0);

            const clipped = await page.getByTestId('archive-headline-figure').evaluate(
                (el) => el.scrollWidth - el.clientWidth
            );
            expect(clipped, 'the headline figure is clipped at 360px').toBeLessThanOrEqual(0);
        });
    });
});
