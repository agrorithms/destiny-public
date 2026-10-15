import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { LIST_RAID, fireteamMemberName, seedFireteams, seedPlayerWithSession } from './support/seed-world';
import { fireteamRows } from './support/fireteam-rows';
import { boxOf, expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * #157: /active-sessions opens in list view, one row per fireteam titled after its
 * Fireteam Leader, with a List | Tiles toggle whose choice is kept in localStorage.
 *
 * Which member leads, and what a row is called when nobody does or the name is a raw ID,
 * are Roster rules tested in Vitest (src/lib/active-session/roster.test.ts). This file
 * covers what only the page can show: the default view, the toggle and its persistence,
 * what a row renders, the row order, and the phone width.
 *
 * Fixture namespace `87`: two six-player fireteams with a leader in seat 2 (`871`), and one
 * solo player with no leader flagged (`872`), all on a raid no other spec seeds. The solo
 * player started most recently, so the row order proves fireteam size outranks recency, and
 * has a 26-character name, the longest a Bungie Name can be, for the phone-width check.
 * Every Playwright test gets a fresh browser context, so each one starts on a first visit
 * with nothing in localStorage.
 */
const FIRETEAM_PREFIX = '871';
const LEADER_SEAT = 2;
const SOLO = { membershipId: '87200', name: 'Roster872SoloWithALongName', code: 1872 };

test.beforeAll(async () => {
    // Fireteam 1 starts a minute after fireteam 0 (seedFireteams staggers them).
    seedFireteams({ count: 2, size: 6, prefix: FIRETEAM_PREFIX, raid: LIST_RAID, leaderSeat: LEADER_SEAT });
    // Starts half an hour ago: newer than both fireteams.
    seedPlayerWithSession({ ...SOLO, raid: LIST_RAID });
});

/**
 * The list raid's section: a region named by its h2, so other raids' rows stay out of it. Its
 * rows are read through fireteamRows, which leaves out the member items an open row nests (#158).
 */
function listSection(page: Page) {
    return page.getByRole('region', { name: LIST_RAID.name });
}

function leaderOf(fireteam: number): string {
    return fireteamMemberName(FIRETEAM_PREFIX, fireteam, LEADER_SEAT);
}

test.describe('active sessions list view', () => {
    // The ticket's first criterion: List is the new default, chosen in the design session
    // over keeping tiles for continuity.
    test('opens in list view on a first visit', async ({ page }) => {
        await page.goto('/active-sessions');

        await expect(fireteamRows(listSection(page))).toHaveCount(3);
        await expect(listSection(page).getByRole('heading', { level: 3 })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Tile view' })).toHaveAttribute('aria-pressed', 'false');
    });

    // Both halves are icons with no visible text, so the tooltip is what a sighted visitor
    // reads and the aria-label is what a screen reader announces.
    test('gives each half of the toggle a tooltip and a pressed state', async ({ page }) => {
        await page.goto('/active-sessions');

        const list = page.getByRole('button', { name: 'List view' });
        const tiles = page.getByRole('button', { name: 'Tile view' });
        await expect(list).toHaveAttribute('title', 'List view');
        await expect(tiles).toHaveAttribute('title', 'Tile view');
        await expect(list).toHaveAttribute('aria-pressed', 'true');
        await expect(tiles).toHaveAttribute('aria-pressed', 'false');
    });

    // The preference is personal, so it lives in localStorage, not the URL: the reload
    // keeps the same address and must still come back in tile view.
    test('switches to tile view and keeps the choice across a reload', async ({ page }) => {
        await page.goto('/active-sessions');
        await expect(fireteamRows(listSection(page))).toHaveCount(3);

        await page.getByRole('button', { name: 'Tile view' }).click();

        // Each tile carries its raid name as an h3.
        const tiles = listSection(page).getByRole('heading', { level: 3, name: LIST_RAID.name });
        await expect(tiles).toHaveCount(3);
        await expect(fireteamRows(listSection(page))).toHaveCount(0);

        await page.reload();

        await expect(tiles).toHaveCount(3);
        await expect(page.getByRole('button', { name: 'Tile view' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'false');

        await page.getByRole('button', { name: 'List view' }).click();
        await expect(fireteamRows(listSection(page))).toHaveCount(3);
    });

    // A browser that can't save (full storage, some private modes) must still let you switch
    // views, and once saving works again the latest pick has to win. Only the first save of
    // the view fails here; other keys, like the theme's, save normally. A stale in-memory
    // fallback that kept the failed pick once got past a review, so both halves are checked.
    test('switches view when saving fails, and the next successful save wins', async ({ page }) => {
        await page.addInitScript(() => {
            const setItem = Storage.prototype.setItem;
            let viewSaves = 0;
            Storage.prototype.setItem = function (key: string, value: string) {
                if (key === 'destiny-farm-finder-sessions-view' && viewSaves++ === 0) {
                    throw new DOMException('Storage is full', 'QuotaExceededError');
                }
                setItem.call(this, key, value);
            };
        });
        await page.goto('/active-sessions');
        const list = page.getByRole('button', { name: 'List view' });
        const tiles = page.getByRole('button', { name: 'Tile view' });

        await tiles.click(); // this save fails, but the view still switches
        await expect(tiles).toHaveAttribute('aria-pressed', 'true');

        await list.click(); // this save works, so List must win
        await expect(list).toHaveAttribute('aria-pressed', 'true');
        await expect(tiles).toHaveAttribute('aria-pressed', 'false');
    });

    // A row is "<leader Name#Code>'s fireteam", the player count and the elapsed time. The
    // leader sits in seat 2, not seat 0, so a row titled after the first member, or after
    // whichever tracked player's row dedupe kept, would show a different name.
    test('titles a row after its Fireteam Leader with the player count and elapsed time', async ({ page }) => {
        await page.goto('/active-sessions');

        const row = fireteamRows(listSection(page)).filter({ hasText: leaderOf(0) });
        await expect(row).toContainText(`${leaderOf(0)}'s fireteam`);
        // Read cell by cell through their tooltips: the row's text runs the cells
        // together ("6/61h 0m"), which no word-boundary pattern can split.
        await expect(row.getByTitle('6 of 6 players')).toHaveText('6/6');
        // Fireteam 0 started an hour before the seed ran.
        await expect(row.getByTitle('Time elapsed')).toHaveText(/^1h \d+m$/);
        await expect(row.getByRole('link', { name: leaderOf(0), exact: true }))
            .toHaveAttribute('href', /^\/player\/3\/\d+$/);
    });

    // The solo player has no member flagged as leader, so its row falls back to the
    // tracked player, who is that player.
    test('titles a row with no flagged leader after the tracked player', async ({ page }) => {
        await page.goto('/active-sessions');

        const row = fireteamRows(listSection(page)).filter({ hasText: SOLO.name });
        await expect(row).toContainText(`${SOLO.name}#${SOLO.code}'s fireteam`);
        await expect(row.getByTitle('1 of 6 players')).toHaveText('1/6');
        // Seeded as started half an hour ago.
        await expect(row.getByTitle('Time elapsed')).toHaveText(/^3\dm$/);
    });

    // Rows keep the API's order (compareSessionsForDisplay): multi-player fireteams first,
    // then the most recently started. The solo player started last, so a list sorted by
    // start time alone would put it first.
    test('keeps the API order: multi-player fireteams first, then newest first', async ({ page }) => {
        await page.goto('/active-sessions');

        const rows = fireteamRows(listSection(page));
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText(`${leaderOf(1)}'s fireteam`);
        await expect(rows.nth(1)).toContainText(`${leaderOf(0)}'s fireteam`);
        await expect(rows.nth(2)).toContainText(`${SOLO.name}#${SOLO.code}'s fireteam`);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        // The ticket's phone criterion: the toggle and a row fit, and nothing makes the page
        // scroll sideways. A long Name#Code is the likeliest thing to push a row wide, so the
        // row measured is the solo player's, whose name is as long as a Bungie Name gets. A
        // short-named row fits at 360px even when the title can't shrink, so measuring one
        // proves nothing.
        test('fits the toggle and a long-named row inside a 360px viewport', async ({ page }) => {
            await page.goto('/active-sessions');

            const toggle = page.getByRole('group', { name: 'View' });
            const row = fireteamRows(listSection(page)).filter({ hasText: SOLO.name });
            await expect(toggle).toBeVisible();
            await expect(row).toBeVisible();

            for (const [what, element] of [['the view toggle', toggle], ['a list row', row]] as const) {
                const box = await boxOf(element);
                expect(box.x, `${what} starts inside the viewport`).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width, `${what} ends inside the viewport`).toBeLessThanOrEqual(360);
            }
            await expectNoElementOverflow(row, 'a list row');
            await expectNoHorizontalPageOverflow(page);

            // Sideways overflow alone misses a title that wraps. Without `truncate` the long
            // name breaks onto a second line instead, so nothing scrolls sideways, but the
            // unbreakable Name#Code spills over the "1/6" count beside it. So the title cell
            // (the link's parent) must also be exactly one line tall.
            const titleCell = row.getByRole('link', { name: `${SOLO.name}#${SOLO.code}`, exact: true }).locator('..');
            const { height, lineHeight } = await titleCell.evaluate((cell) => ({
                height: cell.clientHeight,
                lineHeight: parseFloat(getComputedStyle(cell).lineHeight),
            }));
            expect(height, "the row's title is one line tall").toBe(lineHeight);
        });
    });
});
