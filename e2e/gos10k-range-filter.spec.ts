import { expect, test } from './support/test-fixtures';
import { expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The global range control (#87) — the part of it that is only checkable in a browser.
 *
 * The arithmetic is not here. Which clears a date range contains, which dates a Clear
 * Number range spans, and what a malformed link resolves to are all asserted against
 * the fixture Archive in Vitest (tests/db/archive-range.test.ts), with specific dates
 * and specific Clear Numbers. What Vitest cannot see is the property the control's
 * whole design rests on: that submitting one mode *drops the other mode's parameters*,
 * because that is a browser's form-submission behaviour rather than the page's code.
 *
 * Asserts no counts and no dates. #85 widened the fixture from 9 Runs to 406 and every
 * count in a spec would have broken for no benefit; the Clear Numbers below are typed
 * in by the test itself, so they are the test's own figures rather than the fixture's.
 */

/** The headline is the page's most-filtered figure, and the one every panel follows. */
async function headline(page: import('@playwright/test').Page): Promise<number> {
    const text = await page.getByTestId('archive-headline-figure').innerText();
    return Number(text.replace(/[^0-9]/g, ''));
}

test.describe('the GoS 10k range filter', () => {
    test('filters the page by Clear Number and puts the range in the URL', async ({ page }) => {
        await page.goto('/gos10k');
        const unfiltered = await headline(page);

        await page.getByRole('group', { name: 'By Clear Number' }).getByLabel('From').fill('103');
        await page.getByRole('group', { name: 'By Clear Number' }).getByLabel('To').fill('143');
        await page.getByRole('group', { name: 'By Clear Number' }).getByRole('button', { name: 'Apply' }).click();

        // The whole state is the URL: this is what makes a view shareable.
        await expect(page).toHaveURL(/clearFrom=103&clearTo=143/);
        expect(await headline(page)).toBeLessThan(unfiltered);
        // The inactive mode's reading of the same range, rendered as read-only text.
        await expect(page.getByTestId('archive-range-summary')).toContainText('clears 103–143');
    });

    test('replaces a Clear Number range when a date range is applied', async ({ page }) => {
        // The mutual-exclusion criterion, and the reason the control is two forms: a
        // browser submits only the inputs of the form it submitted, so there is no state
        // in which both ranges are applied.
        await page.goto('/gos10k?clearFrom=103&clearTo=143');

        const dates = page.getByRole('group', { name: 'By date' });
        await dates.getByLabel('From').fill('2022-02-01');
        await dates.getByLabel('To').fill('2022-02-28');
        await dates.getByRole('button', { name: 'Apply' }).click();

        await expect(page).toHaveURL(/[?&]from=2022-02-01/);
        await expect(page).toHaveURL(/[?&]to=2022-02-28/);
        await expect(page).not.toHaveURL(/clearFrom/);
        await expect(page).not.toHaveURL(/clearTo/);
    });

    test('returns to the whole Archive', async ({ page }) => {
        await page.goto('/gos10k?clearFrom=103&clearTo=143');
        const filtered = await headline(page);

        await page.getByTestId('archive-range-clear').click();

        await expect(page).toHaveURL(/\/gos10k$/);
        expect(await headline(page)).toBeGreaterThan(filtered);
        // Nothing to clear on the unfiltered page, so the affordance is not offered.
        await expect(page.getByTestId('archive-range-clear')).toHaveCount(0);
    });

    test('degrades a hand-edited link to the whole Archive and says so', async ({ page }) => {
        await page.goto('/gos10k');
        const unfiltered = await headline(page);

        // Reversed, and asking for both modes at once — neither is reachable from the
        // control, and both must render the page rather than an error or an empty view.
        await page.goto('/gos10k?from=2026-01-01&to=2020-01-01&clearFrom=1&clearTo=5');

        expect(await headline(page)).toBe(unfiltered);
        await expect(page.getByTestId('archive-range-degraded')).toBeVisible();
    });

    test('applies a milestone preset without the reader typing a date', async ({ page }) => {
        await page.goto('/gos10k');

        await page.getByRole('link', { name: 'The final year' }).click();

        // Preset links write the same parameters the forms submit; which parameters is
        // the preset's own business and is asserted in src/lib/db/archive/range.test.ts.
        await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
        await expect(page.getByTestId('archive-range-clear')).toBeVisible();
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('renders the control without a horizontal page scroll', async ({ page }) => {
            await page.goto('/gos10k?clearFrom=103&clearTo=143');

            await expect(page.getByTestId('archive-range-filter')).toBeVisible();
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
