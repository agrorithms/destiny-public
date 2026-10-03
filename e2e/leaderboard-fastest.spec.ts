import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { FASTEST_CLEARS, RAID_A, RAID_B } from './support/seed-world';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The leaderboard's Fastest Clears tab (#132) — what only a browser can see.
 *
 * The runner's ranking rules are pinned in tests/db/fastest-clears.test.ts. What those
 * tests cannot see is the page around it: that the tab is held in the URL and switches
 * without a reload, that the View toggle goes away without overwriting the stored
 * preference, and that the request the page sends reaches a route that answers per raid.
 * There are no route tests (#130 left them out on purpose), so the third of those is
 * proved here, through the running server.
 *
 * The boards are asserted against FASTEST_CLEARS in the seeded world, which is ordered
 * against the Full Clears boards, so the count board under the new heading cannot pass.
 */

const VIEW_MODE_KEY = 'destiny-farm-finder-view-mode';

function tabStrip(page: Page): Locator {
    return page.getByRole('navigation', { name: 'Leaderboards' });
}

async function expectActiveTab(page: Page, label: 'Full Clears' | 'Fastest Clears'): Promise<void> {
    const strip = tabStrip(page);
    await expect(strip.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(strip.locator('[aria-current]')).toHaveCount(1);
}

/** One raid's board: the card holding that raid's heading. */
function raidBoard(page: Page, raidName: string): Locator {
    return page.locator('.ui-card').filter({ has: page.getByRole('heading', { name: raidName, exact: true }) });
}

/** Each row as [player, right-hand column], so order, names and times are one assertion. */
async function expectBoardRows(board: Locator, rows: readonly (readonly [string, string])[]): Promise<void> {
    const body = board.locator('tbody tr');
    await expect(body).toHaveCount(rows.length);
    for (const [i, [player, value]] of rows.entries()) {
        const row = body.nth(i);
        await expect(row.getByRole('link')).toHaveText(player);
        await expect(row.locator('td').last()).toHaveText(value);
    }
}

/**
 * Marks the page's JavaScript context. A full reload replaces the context and loses the
 * mark, so it surviving a tab switch is what proves the switch was client-side.
 */
async function markDocument(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
}

async function expectSameDocument(page: Page): Promise<void> {
    const same = await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument);
    expect(same, 'the tab switch reloaded the page').toBe(true);
}

test.describe('the Fastest Clears tab', () => {
    test('opens from ?board=fastest, and the tabs switch the URL without a reload', async ({ page }) => {
        // The URL is the tab (#132): a link has to land on it, and switching has to
        // write it back so refresh and back behave.
        await page.goto('/leaderboard?board=fastest');
        await expectActiveTab(page, 'Fastest Clears');
        await expect(page.getByText('Fastest clears in the last', { exact: false })).toBeVisible();
        await expect(raidBoard(page, RAID_A.name).getByRole('columnheader', { name: 'Clear Time' })).toBeVisible();

        await markDocument(page);
        await tabStrip(page).getByRole('link', { name: 'Full Clears' }).click();
        await expect(page).toHaveURL(/\/leaderboard$/);
        await expectActiveTab(page, 'Full Clears');
        await expect(page.getByText('Top raiders by full clears in the last', { exact: false })).toBeVisible();

        // From the keyboard this time: the tabs are links, so Enter follows one.
        await tabStrip(page).getByRole('link', { name: 'Fastest Clears' }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/leaderboard\?board=fastest$/);
        await expectActiveTab(page, 'Fastest Clears');
        await expectSameDocument(page);

        // Back returns to the tab it came from.
        await page.goBack();
        await expect(page).toHaveURL(/\/leaderboard$/);
        await expectActiveTab(page, 'Full Clears');
    });

    test('opens Full Clears for a board it does not know', async ({ page }) => {
        // A hand-edited parameter is the default page, never an empty or broken one.
        await page.goto('/leaderboard?board=speedrun');
        await expectActiveTab(page, 'Full Clears');
        await expect(raidBoard(page, RAID_A.name).getByRole('columnheader', { name: 'Clears', exact: true })).toBeVisible();
    });

    test('hides the View toggle, and leaves a stored Total Clears preference for Full Clears', async ({ page }) => {
        // #130: Fastest Clears is always per raid, and the stored View mode is neither
        // read nor overwritten there — a visit must not reset someone's Total Clears.
        await page.goto('/leaderboard');
        await page.getByRole('button', { name: 'Total Clears' }).click();
        await expect(page.locator('tbody tr').first()).toBeVisible();

        await tabStrip(page).getByRole('link', { name: 'Fastest Clears' }).click();
        await expectActiveTab(page, 'Fastest Clears');
        await expect(page.getByRole('button', { name: 'Total Clears' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Per Raid' })).toHaveCount(0);
        await expect(raidBoard(page, RAID_A.name)).toBeVisible();
        expect(await page.evaluate((key) => localStorage.getItem(key), VIEW_MODE_KEY)).toBe('aggregate');

        // Coming back asks for the aggregate board again, so the preference was not
        // just left in storage but is the one the tab uses.
        const aggregateRequest = page.waitForRequest((request) =>
            request.url().includes('/api/leaderboard')
            && new URL(request.url()).searchParams.get('mode') === 'aggregate'
        );
        await tabStrip(page).getByRole('link', { name: 'Full Clears' }).click();
        await aggregateRequest;
        await expect(page.getByRole('button', { name: 'Total Clears' })).toHaveClass(/ui-toggle-active/);
    });

    test('asks for board=fastest and renders one board per raid, ranked by Clear Time', async ({ page }) => {
        // Stored as Total Clears and sent no mode: if the route did not force per-raid,
        // this would come back as one aggregate board with no raid headings.
        await page.addInitScript((key) => localStorage.setItem(key, 'aggregate'), VIEW_MODE_KEY);

        const fastestRequest = page.waitForRequest((request) => {
            if (!request.url().includes('/api/leaderboard')) return false;
            const params = new URL(request.url()).searchParams;
            return params.get('board') === 'fastest' && !params.has('mode');
        });
        await page.goto('/leaderboard?board=fastest');
        await fastestRequest;

        await expectBoardRows(raidBoard(page, RAID_A.name), FASTEST_CLEARS[RAID_A.key]);
        await expectBoardRows(raidBoard(page, RAID_B.name), FASTEST_CLEARS[RAID_B.key]);

        // Names keep their profile links on this tab too.
        await expect(page.getByRole('link', { name: 'FixtureCharlie#1111' }))
            .toHaveAttribute('href', '/player/3/4611686018400010003');
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('fits the tab strip on one row and the boards without sideways scroll', async ({ page }) => {
            await page.goto('/leaderboard?board=fastest');

            const strip = tabStrip(page);
            await expect(strip).toBeVisible();
            await expectNoElementOverflow(strip, 'the tab strip');
            const tops = await strip
                .getByRole('link')
                .evaluateAll((links) => new Set(links.map((l) => Math.round(l.getBoundingClientRect().top))).size);
            expect(tops, 'the tab strip wrapped').toBe(1);

            // The Clear Time column is wider than the Clears column; the board must
            // still fit, heading included.
            const board = raidBoard(page, RAID_A.name);
            await expectBoardRows(board, FASTEST_CLEARS[RAID_A.key]);
            await expectNoElementOverflow(board.locator('table'), 'the Fastest Clears board');
            const header = board.getByRole('columnheader', { name: 'Clear Time' });
            await expectNoElementOverflow(header, 'the Clear Time heading');

            await expectNoHorizontalPageOverflow(page);
        });
    });
});
