import { expect, test } from './support/test-fixtures';
import { boxOf, expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

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
 * #111 added two more of the same kind: the column is centred at a desktop width,
 * and no reader ever sees the word "Pinned".
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
        // captioned with "…Full Clears that three people entered…", and an inexact match
        // would bind to it too if the headline's caption were ever shortened.
        await expect(
            page.getByRole('figure', { name: 'Garden of Salvation Full Clears', exact: true })
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

    // #111. The model has two full-clear rules and the code names both, but the page
    // shows one: an unqualified Full Clear here is the Pinned rule. Everything a reader
    // sees must say "Full Clear", including the text behind the closed methodology and
    // the charts' accessible names, which innerText would miss.
    test('never shows a reader the word "Pinned"', async ({ page }) => {
        await page.goto('/gos10k');

        // textContent rather than innerText, so the closed disclosure counts. Scoped to
        // <main> because the framework's inline scripts sit outside it.
        expect(await page.locator('main').textContent()).not.toContain('Pinned');
        await expect(page.locator('[aria-label*="Pinned" i]')).toHaveCount(0);
    });

    // #111. The page's column is narrower than the site's main column on purpose (the
    // panels are prose and tables); it sat against the left edge because it had no
    // `mx-auto`, where every other page is centred. Only a real layout shows this.
    // Measured below `xl`: from there up the range filter is a rail beside the column
    // and the *pair* is centred instead (#108, asserted in gos10k-range-filter.spec.ts).
    test('centres its column in the site\'s main column below the rail breakpoint', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 900 });
        await page.goto('/gos10k');

        const main = await boxOf(page.locator('main'));
        const column = await boxOf(page.locator('main > section'));

        // Narrower than main, or centring is not being tested at all.
        expect(column.width).toBeLessThan(main.width - 100);
        // `main`'s padding is the same on both sides, so centred in its box is centred
        // in its content.
        expect(
            Math.abs(column.x + column.width / 2 - (main.x + main.width / 2)),
            'the column is off-centre'
        ).toBeLessThanOrEqual(1);
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
