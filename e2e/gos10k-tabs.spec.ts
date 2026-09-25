import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The page's three tabs (#112) — the half of them only a browser can see.
 *
 * What a tab link and a Helper board link *write* is pure and asserted in Vitest
 * (src/app/gos10k/archive-tab.test.ts, helper-board-view.test.ts). What Vitest cannot
 * see is the range control's side of the bargain: its two GET forms submit only their
 * own inputs, so whether applying a range keeps the tab is a browser's form-submission
 * behaviour, resting on one hidden input. That, which panels each tab renders, and
 * whether the strip fits a phone are what this file asserts.
 *
 * Asserts no counts, no names and no dates, the same rule every Archive spec follows.
 * The Clear Numbers and dates below are typed in by the test itself.
 */

/** Each tab's panels, by heading. A tab renders exactly its own and none of the others'. */
const PANELS = {
    overview: ['How much of each clear he was there for', 'By year', 'The runs that did not become clears'],
    rankings: ['Who helped most', 'Fastest clears', 'Consistently fastest'],
    participants: ['How many people were in each clear', 'Classes brought'],
} as const;

type Tab = keyof typeof PANELS;

const LABEL: Record<Tab, string> = {
    overview: 'Overview',
    rankings: 'Rankings',
    participants: 'Participants',
};

async function expectTab(page: import('@playwright/test').Page, tab: Tab): Promise<void> {
    const strip = page.getByRole('navigation', { name: 'Archive sections' });
    await expect(strip.getByRole('link', { name: LABEL[tab] })).toHaveAttribute('aria-current', 'page');
    await expect(strip.locator('[aria-current]')).toHaveCount(1);

    for (const [other, headings] of Object.entries(PANELS) as [Tab, readonly string[]][]) {
        for (const name of headings) {
            const heading = page.getByRole('heading', { name, exact: true });
            if (other === tab) await expect(heading, `${name} should be on ${tab}`).toBeVisible();
            else await expect(heading, `${name} should not be on ${tab}`).toHaveCount(0);
        }
    }
}

test.describe('the GoS 10k tabs', () => {
    test('opens on Overview, with the header, filter and timeline above it', async ({ page }) => {
        await page.goto('/gos10k');

        await expectTab(page, 'overview');
        // The parts above the tabs, which every tab shares.
        await expect(
            page.getByRole('figure', { name: 'Garden of Salvation Full Clears', exact: true })
        ).toBeVisible();
        await expect(page.getByTestId('archive-range-filter')).toBeVisible();
        await expect(page.getByTestId('archive-timeline')).toBeVisible();
    });

    test('renders exactly each tab\'s panels, and Overview for a tab it does not know', async ({ page }) => {
        await page.goto('/gos10k?tab=rankings');
        await expectTab(page, 'rankings');
        await expect(page.getByTestId('archive-timeline')).toBeVisible();

        await page.goto('/gos10k?tab=participants');
        await expectTab(page, 'participants');
        await expect(page.getByTestId('archive-timeline')).toBeVisible();

        // A hand-edited tab is the default page, exactly as a hand-edited range is the
        // whole Archive.
        await page.goto('/gos10k?tab=helpers');
        await expectTab(page, 'overview');
    });

    // The issue's own criterion: switch a tab under a range, then apply a range under a
    // tab — by each form, by a preset, and back to the whole Archive.
    test('keeps the range across a tab switch, and the tab across every range change', async ({ page }) => {
        await page.goto('/gos10k?clearFrom=103&clearTo=143');
        const strip = page.getByRole('navigation', { name: 'Archive sections' });

        await strip.getByRole('link', { name: 'Rankings' }).click();
        await expect(page).toHaveURL(/\?clearFrom=103&clearTo=143&tab=rankings$/);
        await expectTab(page, 'rankings');
        await expect(page.getByTestId('archive-range-summary')).toContainText('clears 103–143');

        // By date: the form's hidden `tab` input rides along, and the Clear Number pair
        // is still dropped — the tab is not a way round the two-forms rule.
        const dates = page.getByRole('group', { name: 'By date' });
        await dates.getByLabel('From').fill('2022-02-01');
        await dates.getByLabel('To').fill('2022-02-28');
        await dates.getByRole('button', { name: 'Apply' }).click();
        await expect(page).toHaveURL(/\?from=2022-02-01&to=2022-02-28&tab=rankings$/);
        await expectTab(page, 'rankings');

        // By Clear Number, from a different tab, so both forms are proved on their own.
        await strip.getByRole('link', { name: 'Participants' }).click();
        await expect(page).toHaveURL(/\?from=2022-02-01&to=2022-02-28&tab=participants$/);
        const clears = page.getByRole('group', { name: 'By Clear Number' });
        await clears.getByLabel('From').fill('103');
        await clears.getByLabel('To').fill('143');
        await clears.getByRole('button', { name: 'Apply' }).click();
        await expect(page).toHaveURL(/\?clearFrom=103&clearTo=143&tab=participants$/);
        await expectTab(page, 'participants');

        await page.getByRole('link', { name: 'The final year' }).click();
        await expect(page).toHaveURL(/\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&tab=participants$/);
        await expectTab(page, 'participants');

        await page.getByTestId('archive-range-clear').click();
        await expect(page).toHaveURL(/\/gos10k\?tab=participants$/);
        await expectTab(page, 'participants');
    });

    test('drops the Helper board\'s own view when the reader leaves Rankings', async ({ page }) => {
        await page.goto('/gos10k?clearFrom=1&clearTo=5000&tab=rankings&helperTime=inRun&helperRows=all');
        const strip = page.getByRole('navigation', { name: 'Archive sections' });

        await strip.getByRole('link', { name: 'Participants' }).click();
        await expect(page).toHaveURL(/\?clearFrom=1&clearTo=5000&tab=participants$/);

        // And coming back is the board's default view, not the one left behind.
        await strip.getByRole('link', { name: 'Rankings' }).click();
        await expect(page).toHaveURL(/\?clearFrom=1&clearTo=5000&tab=rankings$/);
        await expect(page.getByTestId('archive-helper-time-header')).toHaveText('Time with him');
        await expect(page.getByTestId('archive-helper-board').locator('tbody tr')).toHaveCount(25);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('fits the strip on one row at 360px', async ({ page }) => {
            await page.goto('/gos10k');

            const strip = page.getByRole('navigation', { name: 'Archive sections' });
            await expect(strip).toBeVisible();
            await expectNoElementOverflow(strip, 'the tab strip');

            // One row: all three links share a top edge, so none has wrapped below.
            const tops = await strip
                .getByRole('link')
                .evaluateAll((links) => new Set(links.map((l) => Math.round(l.getBoundingClientRect().top))).size);
            expect(tops, 'the tab strip wrapped').toBe(1);

            await expectNoHorizontalPageOverflow(page);
        });
    });
});
