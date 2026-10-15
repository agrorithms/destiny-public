import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { RAID_B, SIZE_RAID, fireteamMemberName, seedFireteams, type FixtureRaid } from './support/seed-world';
import { fireteamRow, fireteamRows, memberList } from './support/fireteam-rows';
import { boxOf, expectInsideViewport, expectNoHorizontalPageOverflow } from './support/viewport';
import { refreshSessions } from './support/active-sessions-page';

/**
 * #161: six toggle chips, 1 to 6, filter /active-sessions by the Roster size each row shows.
 * All six are on at first, each toggles on its own, the choice is kept in localStorage, and the
 * filter combines with the raid filter in list view and tile view.
 *
 * Which chip a player count falls under (7+ under 6, 0 under 1) is a Roster rule tested in
 * Vitest (`rosterSizeChip` in src/lib/active-session/roster.test.ts). This file covers what only
 * the page can show. Every Playwright test gets a fresh browser context, so each starts on a
 * first visit with nothing stored.
 *
 * Fixture namespace `91`:
 * - `911`–`916`, on SIZE_RAID, a raid no other spec seeds: one fireteam of each size, 1 to 6,
 *   the leader in seat 0, so the section has exactly one row per chip;
 * - `917`, on RAID_B (Crota's End): one two-player fireteam, for a second section. RAID_B's only
 *   other fireteam is the player-names spec's six-player one (`82`), live or not depending on
 *   which file ran first. So whenever a spec here needs RAID_B's section gone, it switches off
 *   chips 2 AND 6, and it never counts RAID_B's rows;
 * - `918` plus the retry number, on RAID_B: seeded by the last spec only (see there).
 */
const PREFIX_OF_SIZE = { 1: '911', 2: '912', 3: '913', 4: '914', 5: '915', 6: '916' } as const;
const OTHER_RAID = RAID_B;
const OTHER_PREFIX = '917';

test.beforeAll(async () => {
    for (const [size, prefix] of Object.entries(PREFIX_OF_SIZE)) {
        seedFireteams({ count: 1, size: Number(size), prefix, raid: SIZE_RAID, leaderSeat: 0 });
    }
    seedFireteams({ count: 1, size: 2, prefix: OTHER_PREFIX, raid: OTHER_RAID, leaderSeat: 0 });
});

const SIZES = [1, 2, 3, 4, 5, 6] as const;
type Size = (typeof SIZES)[number];

/** A raid's section: a region named by its h2. */
function sectionOf(page: Page, raid: FixtureRaid): Locator {
    return page.getByRole('region', { name: raid.name });
}

/** The section's header button, which collapses and expands it (#159). */
function headerOf(page: Page, raid: FixtureRaid): Locator {
    return sectionOf(page, raid).getByRole('button', { name: raid.name, exact: true });
}

/** The row of SIZE_RAID's fireteam of this size, titled after its leader in seat 0. */
function rowOfSize(page: Page, size: Size): Locator {
    return fireteamRow(sectionOf(page, SIZE_RAID), fireteamMemberName(PREFIX_OF_SIZE[size], 0, 0));
}

function chipGroup(page: Page): Locator {
    return page.getByRole('group', { name: 'Fireteam size' });
}

function chip(page: Page, size: Size): Locator {
    return chipGroup(page).getByRole('button', { name: `Fireteams of ${size}`, exact: true });
}

/** Clicks each chip once, in order: on to off, or off to on. */
async function toggleChips(page: Page, ...sizes: Size[]): Promise<void> {
    for (const size of sizes) {
        await chip(page, size).click();
    }
}

/** Asserts each chip's pressed state: the sizes given are off, every other one on. */
async function expectChipsOff(page: Page, ...off: Size[]): Promise<void> {
    for (const size of SIZES) {
        await expect(chip(page, size), `chip ${size}`).toHaveAttribute('aria-pressed', off.includes(size) ? 'false' : 'true');
    }
}

/** Ticks or unticks each raid in the raid filter, then closes the dropdown. */
async function toggleInRaidFilter(page: Page, ...raids: FixtureRaid[]): Promise<void> {
    await page.locator('button[aria-haspopup="listbox"]').click();
    for (const raid of raids) {
        await page.getByRole('option', { name: raid.name, exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
}

test.describe('active sessions fireteam-size filter', () => {
    // The ticket's first criterion: six chips, all on for a first visit, so nothing is
    // filtered until the visitor asks. Each chip says by aria-pressed whether it is on, and
    // its name says what it filters, not just "3".
    test('shows six chips, all on, on a first visit', async ({ page }) => {
        await page.goto('/active-sessions');

        await expect(chipGroup(page).getByRole('button')).toHaveCount(6);
        await expectChipsOff(page);
        for (const size of SIZES) {
            await expect(chip(page, size)).toHaveText(String(size));
            await expect(chip(page, size)).toHaveAttribute('title', `Fireteams of ${size}`);
        }
        await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(6);
    });

    // Chips, not radio buttons and not a range: switching one off leaves the others as they
    // are, so "3 and 5 off" is as easy to ask for as "6 off".
    test('toggles each chip independently', async ({ page }) => {
        await page.goto('/active-sessions');

        await toggleChips(page, 3);
        await expectChipsOff(page, 3);

        await toggleChips(page, 5);
        await expectChipsOff(page, 3, 5);

        await toggleChips(page, 3);
        await expectChipsOff(page, 5);
    });

    // A chip switched off hides the fireteams of its size and only those: the section keeps
    // one row for each other size. Switching it back on brings the row back.
    test('hides the fireteams of a switched-off size in list view', async ({ page }) => {
        await page.goto('/active-sessions');
        await expect(rowOfSize(page, 3)).toHaveCount(1);

        await toggleChips(page, 3);

        await expect(rowOfSize(page, 3)).toHaveCount(0);
        await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(5);
        for (const size of [1, 2, 4, 5, 6] as const) {
            await expect(rowOfSize(page, size), `the fireteam of ${size}`).toHaveCount(1);
        }

        await toggleChips(page, 3);

        await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(6);
    });

    // The same criterion in tile view. Tiles are counted per section only, by the h3 each
    // tile carries: per-fireteam tile coverage is #153's to restore, not this ticket's.
    test('hides the fireteams of a switched-off size in tile view', async ({ page }) => {
        await page.goto('/active-sessions');
        await page.getByRole('button', { name: 'Tile view' }).click();
        const tiles = sectionOf(page, SIZE_RAID).getByRole('heading', { level: 3 });
        await expect(tiles).toHaveCount(6);

        await toggleChips(page, 1, 6);

        await expect(tiles).toHaveCount(4);
    });

    // A section with no fireteam left to show goes, rather than leaving an empty header.
    // RAID_B holds this file's two-player fireteam and at most player-names' six-player one,
    // so chips 2 and 6 off empty it while SIZE_RAID keeps its other four rows.
    test('removes a raid section when none of its fireteams match', async ({ page }) => {
        await page.goto('/active-sessions');
        await expect(sectionOf(page, OTHER_RAID)).toBeVisible();

        await toggleChips(page, 2, 6);

        await expect(sectionOf(page, OTHER_RAID)).toHaveCount(0);
        await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(4);

        await toggleChips(page, 2);

        await expect(fireteamRow(sectionOf(page, OTHER_RAID), fireteamMemberName(OTHER_PREFIX, 0, 0))).toHaveCount(1);
    });

    // Both filters at once show only fireteams that pass both: RAID_B's two-player fireteam
    // passes the size filter but not the raid filter, and SIZE_RAID's six-player one the
    // other way round, so neither shows.
    test('combines with the raid filter', async ({ page }) => {
        await page.goto('/active-sessions');
        await toggleInRaidFilter(page, SIZE_RAID);

        await toggleChips(page, 6);

        await expect(page.getByRole('heading', { level: 2 })).toHaveText([SIZE_RAID.name]);
        await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(5);
        await expect(rowOfSize(page, 6)).toHaveCount(0);
    });

    // The selection is the visitor's own, so it is kept in localStorage like the raid filter.
    // The page is prerendered with every chip on, so the pressed state is checked after the
    // reload too: a hook that read storage during hydration left #157's toggle showing the
    // prerendered state for good.
    test('keeps the selection across a reload', async ({ page }) => {
        await page.goto('/active-sessions');
        await toggleChips(page, 4, 6);
        await expectChipsOff(page, 4, 6);

        await page.reload();

        await expectChipsOff(page, 4, 6);
        await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(4);
        await expect(rowOfSize(page, 4)).toHaveCount(0);
        await expect(rowOfSize(page, 6)).toHaveCount(0);
    });

    // A stored value the page can't read, from an old version, a hand edit or a corrupt
    // write, must not leave chips stuck off or the page empty. Anything other than a list of
    // whole numbers from 1 to 6 counts as nothing stored: all six on.
    test('treats a stored selection it cannot read as all six on', async ({ page }) => {
        await page.goto('/active-sessions');

        for (const stored of ['not json', 'null', '{"sizes":[1]}', '["3"]', '[2.5]', '[1,7]']) {
            await page.evaluate((value) => localStorage.setItem('destiny-farm-finder-sessions-sizes', value), stored);
            await page.reload();

            await expect(chip(page, 1), `after storing ${stored}`).toHaveAttribute('aria-pressed', 'true');
            await expectChipsOff(page);
            await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(6);
        }
    });

    // A browser that can't save (full storage, some private modes) must still filter, and once
    // saving works again the latest choice has to win. Only the first save of the sizes fails
    // here. The same stale fallback that once kept the List | Tiles toggle stuck (#157) would
    // leave chip 5 on, so both halves are checked, and the reload shows what was saved.
    test('filters when saving fails, and the next successful save wins', async ({ page }) => {
        await page.addInitScript(() => {
            const setItem = Storage.prototype.setItem;
            let sizeSaves = 0;
            Storage.prototype.setItem = function (key: string, value: string) {
                if (key === 'destiny-farm-finder-sessions-sizes' && sizeSaves++ === 0) {
                    throw new DOMException('Storage is full', 'QuotaExceededError');
                }
                setItem.call(this, key, value);
            };
        });
        await page.goto('/active-sessions');

        await toggleChips(page, 3); // this save fails, but the chip still switches off
        await expectChipsOff(page, 3);
        await expect(rowOfSize(page, 3)).toHaveCount(0);

        await toggleChips(page, 5); // this save works, so it must win
        await expectChipsOff(page, 3, 5);

        await page.reload();

        await expectChipsOff(page, 3, 5);
    });

    // Every chip off asks for no sizes, so nothing shows (the user's decision), and the empty
    // state says why. With no sections, Collapse all is disabled, as when the raid filter
    // empties the page (#159). A page the chips empty within a raid filter says so too, so the
    // visitor knows to look at the chips rather than the raids.
    test('shows the empty state when no fireteam matches the chips', async ({ page }) => {
        await page.goto('/active-sessions');

        await toggleChips(page, ...SIZES);

        await expect(page.getByText('No active raid sessions found')).toBeVisible();
        await expect(page.getByText('Select at least one fireteam size')).toBeVisible();
        await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^(Collapse|Expand) all$/ })).toBeDisabled();

        await toggleChips(page, ...SIZES);
        await toggleInRaidFilter(page, OTHER_RAID);
        await toggleChips(page, 2, 6);

        await expect(page.getByText('No active raid sessions found')).toBeVisible();
        await expect(page.getByText('Try selecting more fireteam sizes')).toBeVisible();
    });

    // #159's rule, for chips: a section that leaves the page is forgotten as collapsed, so it
    // comes back expanded like anything newly on screen. A section the chips leave on the page
    // keeps its collapse.
    test('brings a section the chips emptied back expanded', async ({ page }) => {
        await page.goto('/active-sessions');
        await headerOf(page, OTHER_RAID).click();
        await headerOf(page, SIZE_RAID).click();
        await expect(headerOf(page, OTHER_RAID)).toHaveAttribute('aria-expanded', 'false');
        await expect(headerOf(page, SIZE_RAID)).toHaveAttribute('aria-expanded', 'false');

        await toggleChips(page, 2, 6);
        await expect(sectionOf(page, OTHER_RAID)).toHaveCount(0);
        await toggleChips(page, 2, 6);

        await expect(headerOf(page, OTHER_RAID)).toHaveAttribute('aria-expanded', 'true');
        await expect(headerOf(page, SIZE_RAID)).toHaveAttribute('aria-expanded', 'false');
    });

    // Which rows are open is the page's state, kept by fireteam (#158), so a row a chip hides
    // is still open when the chip shows it again.
    test('brings an open row back open when its size is shown again', async ({ page }) => {
        await page.goto('/active-sessions');
        const row = rowOfSize(page, 5);
        await row.getByRole('button', { name: 'Fireteam members' }).click();
        await expect(memberList(row).getByRole('listitem')).toHaveCount(4);

        await toggleChips(page, 5);
        await expect(row).toHaveCount(0);
        await toggleChips(page, 5);

        await expect(row.getByRole('button', { name: 'Fireteam members' })).toHaveAttribute('aria-expanded', 'true');
        await expect(memberList(row).getByRole('listitem')).toHaveCount(4);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        // The ticket's phone criterion: at 360px the control bar wraps, and every chip has to
        // land inside the viewport without overlapping another control. A row of a fireteam
        // with a copy button stays one line: the row's flex line is measured, its padding
        // plus one line, never the `truncate` title cell, which is one line however the row
        // breaks (#160's S2).
        test('fits the chips inside a 360px viewport', async ({ page }) => {
            await page.goto('/active-sessions');
            await expect(fireteamRows(sectionOf(page, SIZE_RAID))).toHaveCount(6);

            for (const size of SIZES) {
                await expectInsideViewport(chip(page, size), `chip ${size}`);
            }
            const controls = {
                raidFilter: page.locator('button[aria-haspopup="listbox"]'),
                refresh: page.getByRole('button', { name: 'Refresh' }),
                collapseAll: page.getByRole('button', { name: /^(Collapse|Expand) all$/ }),
                sizes: chipGroup(page),
                view: page.getByRole('group', { name: 'View' }),
            };
            const boxes = Object.fromEntries(
                await Promise.all(Object.entries(controls).map(async ([name, control]) => [name, await boxOf(control)] as const)),
            );
            for (const [name, control] of Object.entries(controls)) {
                await expectInsideViewport(control, name);
            }
            const names = Object.keys(boxes);
            for (const [i, a] of names.entries()) {
                for (const b of names.slice(i + 1)) {
                    const [p, q] = [boxes[a], boxes[b]];
                    const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
                    expect(apart, `${a} and ${b} don't overlap`).toBe(true);
                }
            }
            await expectNoHorizontalPageOverflow(page);

            await toggleChips(page, 1);
            await expectChipsOff(page, 1);
            const rowLine = rowOfSize(page, 5).locator(':scope > div');
            const { height, oneLine } = await rowLine.evaluate((line) => {
                const style = getComputedStyle(line);
                return {
                    height: line.clientHeight,
                    oneLine: parseFloat(style.paddingTop) + parseFloat(style.lineHeight) + parseFloat(style.paddingBottom),
                };
            });
            expect(height, 'the row is one line tall').toBe(oneLine);
        });
    });

    // Kept LAST in the file, on purpose. A refresh alone can empty a section: here a collapsed
    // raid's only shown fireteam grows from 5 to 6 while chip 6 is off. The raid is still in
    // the API's response, so a page that only forgot raids missing from the response would keep
    // it collapsed, and it would come back collapsed when chip 6 is switched on. The page
    // forgets raids with nothing *shown* instead, so it comes back expanded.
    //
    // Its fireteam is seeded here, not in beforeAll, so the RAID_B specs above never see it,
    // and it can't shrink back to 5 once grown. So its membership ids carry the retry number
    // (CI retries twice): each attempt gets a fresh fireteam, and an earlier attempt's, left at
    // 6, stays hidden while chips 2 and 6 are off. Nothing after this spec may count RAID_B.
    test('brings back expanded a section a refresh emptied under the chips', async ({ page }, testInfo) => {
        const growing = { count: 1, prefix: `918${testInfo.retry}`, raid: OTHER_RAID, leaderSeat: 0 };
        seedFireteams({ ...growing, size: 5 });
        await page.goto('/active-sessions');
        await toggleChips(page, 2, 6);
        await expect(fireteamRow(sectionOf(page, OTHER_RAID), fireteamMemberName(growing.prefix, 0, 0))).toHaveCount(1);
        await headerOf(page, OTHER_RAID).click();
        await expect(headerOf(page, OTHER_RAID)).toHaveAttribute('aria-expanded', 'false');

        seedFireteams({ ...growing, size: 6 });
        await refreshSessions(page);
        await expect(sectionOf(page, OTHER_RAID)).toHaveCount(0);

        await toggleChips(page, 6);

        await expect(headerOf(page, OTHER_RAID)).toHaveAttribute('aria-expanded', 'true');
    });
});
