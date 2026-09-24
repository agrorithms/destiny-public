import { expect, test } from './support/test-fixtures';
import { boxOf, expectNoHorizontalPageOverflow } from './support/viewport';

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
 * #108 added the control's two layouts, which are computed-layout facts and nothing
 * else: how much of a phone's screen the collapsed bar takes once it sticks, whether it
 * sticks below the site nav or under it, and where the `xl` rail sits beside the column.
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

    // #108. Below `xl` the control is a sticky bar collapsed by default, so a phone reader
    // scrolling the page sees the panel being filtered rather than the filter. Occupancy
    // and "is it covered by the site nav" are computed-layout facts no other seam sees.
    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('renders the control without a horizontal page scroll', async ({ page }) => {
            await page.goto('/gos10k?clearFrom=103&clearTo=143');

            await expect(page.getByTestId('archive-range-filter')).toBeVisible();
            await expectNoHorizontalPageOverflow(page);
        });

        test('sticks below the site nav as a bar under 15% of the viewport', async ({ page }) => {
            await page.goto('/gos10k?clearFrom=103&clearTo=143');
            await expectStuckBelowNav(page, 0);
            await expectBarWithinBudget(page);

            // Collapsed: the summary and the way back are there, the forms are not.
            await expect(page.getByTestId('archive-range-summary')).toBeVisible();
            await expect(page.getByTestId('archive-range-clear')).toBeVisible();
            await expect(page.getByRole('group', { name: 'By date' })).toBeHidden();
        });

        test('expands to both forms and the presets, and collapses after applying', async ({ page }) => {
            await page.goto('/gos10k');
            await expect(page.getByRole('group', { name: 'By Clear Number' })).toBeHidden();
            await expect(page.getByRole('link', { name: 'The final year' })).toBeHidden();

            await page.getByText('Change range').click();

            await expect(page.getByRole('group', { name: 'By date' })).toBeVisible();
            const clears = page.getByRole('group', { name: 'By Clear Number' });
            await expect(clears).toBeVisible();
            await expect(page.getByRole('link', { name: 'The final year' })).toBeVisible();
            await expectNoHorizontalPageOverflow(page);

            await clears.getByLabel('From').fill('103');
            await clears.getByLabel('To').fill('143');
            await clears.getByRole('button', { name: 'Apply' }).click();

            // A GET form is a full navigation, and the bar is collapsed on every load —
            // including this one, straight after the reader applied a range.
            await expect(page).toHaveURL(/clearFrom=103&clearTo=143/);
            await expect(page.getByRole('group', { name: 'By Clear Number' })).toBeHidden();
            await expect(page.getByTestId('archive-range-summary')).toBeVisible();
            await expect(page.getByTestId('archive-range-summary')).toContainText('clears 103–143');
        });

        test('shows a degraded link\'s notice with the bar collapsed', async ({ page }) => {
            // A reader whose link fell back to the whole Archive must not have to open
            // the control to find out.
            await page.goto('/gos10k?from=2026-01-01&to=2020-01-01');

            await expect(page.getByRole('group', { name: 'By date' })).toBeHidden();
            await expect(page.getByTestId('archive-range-degraded')).toBeVisible();
            // The notice is the one thing that makes the collapsed bar taller, and the
            // bound holds with it showing too.
            await expectStuckBelowNav(page, 0);
            await expectBarWithinBudget(page);
        });
    });

    // #108. From `lg` the site nav is one row rather than two, so the bar sticks at a
    // second hardcoded offset. Nothing else lands on it: 360 is below `lg`, 1280 is the rail.
    test.describe('between the nav\'s one-row breakpoint and the rail', () => {
        test.use({ viewport: { width: 1024, height: 768 } });

        test('still sticks directly below the site nav', async ({ page }) => {
            await page.goto('/gos10k?clearFrom=103&clearTo=143');

            await expect(page.getByText('Change range')).toBeVisible();
            await expectStuckBelowNav(page, 0);
        });
    });

    // #108. At `xl` the filter leaves the column for a rail on its left, and the pair is
    // centred together. The rail is always open: there is no collapse control to find.
    test.describe('at the rail breakpoint', () => {
        test.use({ viewport: { width: 1280, height: 900 } });

        test('is a sticky, always-open rail left of the column, centred as a pair', async ({ page }) => {
            await page.goto('/gos10k?clearFrom=103&clearTo=143');

            await expect(page.getByText('Change range')).toBeHidden();
            await expect(page.getByRole('group', { name: 'By date' })).toBeVisible();
            await expect(page.getByRole('group', { name: 'By Clear Number' })).toBeVisible();
            await expect(page.getByRole('link', { name: 'The final year' })).toBeVisible();

            const main = await boxOf(page.locator('main'));
            const rail = await boxOf(page.getByTestId('archive-range-filter'));
            const column = await boxOf(page.locator('main > section > header'));

            expect(rail.x + rail.width, 'the rail overlaps the column').toBeLessThanOrEqual(column.x);
            // `main`'s padding is the same on both sides, so centred in its box is centred
            // in its content.
            const pairCentre = (rail.x + column.x + column.width) / 2;
            expect(Math.abs(pairCentre - (main.x + main.width / 2)), 'the pair is off-centre').toBeLessThanOrEqual(1);
            await expectNoHorizontalPageOverflow(page);

            // Sticky: scrolled well past the header, the rail is still in view, a 1.5rem
            // gap below the nav rather than under it.
            await expectStuckBelowNav(page, 24);
        });
    });
});

/**
 * "Once scrolled, the filter is stuck `gap` px below the site nav": not under it, and not
 * scrolled away. The nav is sticky at the top and draws over the page, so a control stuck
 * at top 0 sits underneath it; the filter's `top` is the nav's height, hardcoded per
 * breakpoint, and this is what notices when the nav changes height and that drifts.
 */
async function expectStuckBelowNav(page: import('@playwright/test').Page, gap: number): Promise<void> {
    // Far enough down that the filter has left its place in the flow and stuck.
    await page.getByRole('heading', { name: 'Fastest clears' }).scrollIntoViewIfNeeded();

    const nav = await boxOf(page.locator('body > nav'));
    const filter = await boxOf(page.getByTestId('archive-range-filter'));
    expect(
        Math.abs(filter.y - (nav.y + nav.height + gap)),
        'the filter is not stuck where it should be below the site nav'
    ).toBeLessThanOrEqual(1);
}

/** #108's phone bound: the collapsed, stuck bar takes at most 15% of the viewport's height. */
async function expectBarWithinBudget(page: import('@playwright/test').Page): Promise<void> {
    const bar = await boxOf(page.getByTestId('archive-range-filter'));
    expect(bar.height, 'the collapsed bar is too tall').toBeLessThanOrEqual(page.viewportSize()!.height * 0.15);
}
