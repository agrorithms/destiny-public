import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

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
    // Structural, not an ordering assertion: it anchors the two specs below and
    // checks the headline names its population. That the figure comes *first* is a
    // reading-order property no assertion here would catch honestly.
    test('renders a headline figure labelled with the population it counts', async ({ page }) => {
        await page.goto('/gos10k');

        // By role and accessible name: the figure is named by its own figcaption, so
        // this asserts the number and its label are programmatically related rather
        // than merely adjacent — which is the property a screen reader depends on.
        // `exact`, because accessible names match by substring: #94's trio figure is
        // captioned with "…Pinned Full Clears that three people entered…", and an inexact
        // match binds to both figures.
        await expect(
            page.getByRole('figure', { name: 'Pinned Full Clears', exact: true })
        ).toBeVisible();
    });

    test('keeps the methodology closed until the reader asks for it', async ({ page }) => {
        await page.goto('/gos10k');

        // The sentence that only exists inside the methodology copy.
        const methodology = page.getByText('two defensible answers');
        await expect(methodology).toBeHidden();

        // Located by the summary's own words rather than by `details` or by
        // getByRole('group'): a second disclosure on this page — any panel ticket —
        // would make an unscoped group locator strict-mode-ambiguous.
        await page.getByText('How the 10,000 is counted').click();
        await expect(methodology).toBeVisible();
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('renders without a horizontal page scroll or a clipped headline', async ({ page }) => {
            await page.goto('/gos10k');

            await expectNoHorizontalPageOverflow(page);

            await expectNoElementOverflow(
                page.getByTestId('archive-headline-figure'),
                'the headline figure'
            );
        });
    });
});
