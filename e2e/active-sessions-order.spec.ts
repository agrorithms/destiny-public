import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import {
    ORDER_EARLIER_RAID,
    ORDER_LATER_RAID,
    UNLISTED_NAMESAKE_RAID,
    UNLISTED_RAID,
    seedFireteams,
} from './support/seed-world';

/**
 * #156: raid sections on /active-sessions sit in the fixed order of the page's raid list
 * (the raid filter's order), grouped by raid key, with any key the list does not know
 * last. They used to be sorted busiest-first, so sections swapped places as fireteam
 * counts changed between 30-second refreshes; and they were grouped by display name, so
 * two raids sharing a name would have merged.
 *
 * Each raid is seeded so the busiest-first order would get it wrong: the later raid in
 * the fixed order has more fireteams than the earlier one, and the unlisted raid has
 * more than both. A second unlisted raid shares the first one's display name.
 *
 * Fixture namespace `86`, one sub-prefix per raid so the three rosters cannot share a
 * membership id. The two listed raids are ones no other spec seeds, so the counts here
 * hold whatever other spec files have left live on the page.
 */
test.beforeAll(async () => {
    seedFireteams({ count: 1, size: 6, prefix: '861', raid: ORDER_EARLIER_RAID });
    seedFireteams({ count: 3, size: 6, prefix: '862', raid: ORDER_LATER_RAID });
    seedFireteams({ count: 4, size: 6, prefix: '863', raid: UNLISTED_RAID });
    seedFireteams({ count: 1, size: 6, prefix: '864', raid: UNLISTED_NAMESAKE_RAID });
});

/** Every raid section heading on the page, top to bottom, once the seeded ones have rendered. */
async function sectionHeadings(page: Page): Promise<string[]> {
    // Section headings are the page's only h2s; each tile's raid name is an h3.
    const headings = page.getByRole('heading', { level: 2 });
    // allTextContents does not wait, so wait for the seeded sections first. They arrive in
    // one render, so waiting for one of them is enough.
    await expect(page.getByRole('heading', { level: 2, name: ORDER_LATER_RAID.name })).toBeVisible();
    return headings.allTextContents();
}

test.describe('active sessions section order', () => {
    // The ticket's own criterion: a raid with more fireteams must not climb above one
    // that comes before it in the raid list.
    test('renders raid sections in the raid list order, not busiest first', async ({ page }) => {
        await page.goto('/active-sessions');

        const headings = await sectionHeadings(page);

        expect(headings).toContain(ORDER_EARLIER_RAID.name);
        expect(headings).toContain(ORDER_LATER_RAID.name);
        expect(headings.indexOf(ORDER_EARLIER_RAID.name))
            .toBeLessThan(headings.indexOf(ORDER_LATER_RAID.name));
    });

    // A raid key the page's list does not know has no place in the fixed order, so it
    // goes after every raid that does, however many fireteams it has.
    test('renders a raid missing from the raid list after every listed raid', async ({ page }) => {
        await page.goto('/active-sessions');

        const headings = await sectionHeadings(page);

        expect(headings.at(-1)).toBe(UNLISTED_RAID.name);
    });

    // Sections are grouped by raid key. Grouped by display name, these two raids would
    // render as one "Raid" section holding both raids' fireteams.
    test('keeps two raids that share a display name in separate sections', async ({ page }) => {
        await page.goto('/active-sessions');

        await expect(page.getByRole('heading', { level: 2, name: UNLISTED_RAID.name, exact: true }))
            .toHaveCount(2);
    });
});
