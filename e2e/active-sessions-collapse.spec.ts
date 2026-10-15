import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import {
    COLLAPSE_OTHER_RAID,
    COLLAPSE_RAID,
    UNSEEDED_RAID,
    fireteamMemberName,
    seedFireteams,
    type FixtureRaid,
} from './support/seed-world';
import { fireteamRow, fireteamRows, memberList } from './support/fireteam-rows';
import { boxOf, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * #159: each raid section on /active-sessions collapses and expands from its header, in list
 * view and tile view, and a Collapse all / Expand all button next to Refresh folds the page.
 * Collapsed sections are kept in memory only: they survive Refresh but not a reload.
 *
 * Other spec files leave fireteams live on the page for 900 seconds, so "every visible
 * section" would include theirs. The specs that depend on every visible section filter the
 * page down to this file's two raids first, through the raid filter itself.
 *
 * Fixture namespace `89`, on two raids no other spec seeds:
 * - `891`: two six-player fireteams on COLLAPSE_RAID, the leader in seat 2;
 * - `892`: one four-player fireteam on COLLAPSE_OTHER_RAID, the leader in seat 0.
 * UNSEEDED_RAID is never seeded, so filtering to it leaves the page with no sections.
 */
const FIRETEAM_PREFIX = '891';
const LEADER_SEAT = 2;
const OTHER_PREFIX = '892';

test.beforeAll(async () => {
    seedFireteams({ count: 2, size: 6, prefix: FIRETEAM_PREFIX, raid: COLLAPSE_RAID, leaderSeat: LEADER_SEAT });
    seedFireteams({ count: 1, size: 4, prefix: OTHER_PREFIX, raid: COLLAPSE_OTHER_RAID, leaderSeat: 0 });
});

/** A raid's section: a region named by its h2. */
function sectionOf(page: Page, raid: FixtureRaid): Locator {
    return page.getByRole('region', { name: raid.name });
}

/** The button inside a section's h2 that collapses and expands it. */
function headerOf(page: Page, raid: FixtureRaid): Locator {
    return sectionOf(page, raid).getByRole('button', { name: raid.name, exact: true });
}

/** The one Collapse all / Expand all button, whichever it reads right now. */
function collapseAllButton(page: Page): Locator {
    return page.getByRole('button', { name: /^(Collapse|Expand) all$/ });
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

/** Filters the page to this file's two raids, and waits for both sections. */
async function showOnlyThisFilesRaids(page: Page): Promise<void> {
    await page.goto('/active-sessions');
    await toggleInRaidFilter(page, COLLAPSE_RAID, COLLAPSE_OTHER_RAID);
    // Root of Nightmares comes before King's Fall in the page's raid list (#156).
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([COLLAPSE_RAID.name, COLLAPSE_OTHER_RAID.name]);
}

async function expectExpanded(page: Page, raid: FixtureRaid, fireteams: number): Promise<void> {
    await expect(headerOf(page, raid)).toHaveAttribute('aria-expanded', 'true');
    await expect(fireteamRows(sectionOf(page, raid))).toHaveCount(fireteams);
}

async function expectCollapsed(page: Page, raid: FixtureRaid): Promise<void> {
    await expect(headerOf(page, raid)).toHaveAttribute('aria-expanded', 'false');
    await expect(fireteamRows(sectionOf(page, raid))).toHaveCount(0);
}

/** Clicks Refresh and waits for the new response to render. */
async function refresh(page: Page): Promise<void> {
    const refreshed = page.waitForResponse((response) => response.url().includes('/api/active-sessions'));
    await page.getByRole('button', { name: 'Refresh' }).click();
    await refreshed;
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
}

function leaderOf(fireteam: number): string {
    return fireteamMemberName(FIRETEAM_PREFIX, fireteam, LEADER_SEAT);
}

test.describe('active sessions collapsible raid sections', () => {
    // The ticket's first criterion, in list view: the header folds the section away and
    // brings it back, and a collapsed section still says which raid it is and how many
    // fireteams it holds. The second click lands on the count, not the name, because the
    // whole header is the click target.
    test('collapses and expands a section from its header in list view', async ({ page }) => {
        await page.goto('/active-sessions');
        const section = sectionOf(page, COLLAPSE_RAID);
        await expectExpanded(page, COLLAPSE_RAID, 2);

        await headerOf(page, COLLAPSE_RAID).click();

        await expectCollapsed(page, COLLAPSE_RAID);
        await expect(section.getByRole('heading', { level: 2, name: COLLAPSE_RAID.name })).toBeVisible();
        await expect(section.getByText('2 sessions', { exact: true })).toBeVisible();

        await section.getByText('2 sessions', { exact: true }).click();

        await expectExpanded(page, COLLAPSE_RAID, 2);
    });

    // The same criterion in tile view: one wrapper covers both views, so tiles fold away too.
    // A tile's raid name is an h3, which is how the list spec counts tiles.
    test('collapses and expands a section from its header in tile view', async ({ page }) => {
        await page.goto('/active-sessions');
        await page.getByRole('button', { name: 'Tile view' }).click();
        const section = sectionOf(page, COLLAPSE_RAID);
        const tiles = section.getByRole('heading', { level: 3 });
        await expect(tiles).toHaveCount(2);

        await headerOf(page, COLLAPSE_RAID).click();

        await expect(headerOf(page, COLLAPSE_RAID)).toHaveAttribute('aria-expanded', 'false');
        await expect(tiles).toHaveCount(0);
        await expect(section.getByText('2 sessions', { exact: true })).toBeVisible();

        await headerOf(page, COLLAPSE_RAID).click();

        await expect(tiles).toHaveCount(2);
    });

    // A refresh replaces every session object, and the page must not undo the visitor's
    // choice when it does. Refresh runs the same fetch as the 30-second poll. The other
    // section stays expanded, so a refresh that collapsed everything would fail too.
    test('keeps a collapsed section collapsed after Refresh', async ({ page }) => {
        await page.goto('/active-sessions');
        await headerOf(page, COLLAPSE_RAID).click();
        await expectCollapsed(page, COLLAPSE_RAID);

        await refresh(page);

        await expectCollapsed(page, COLLAPSE_RAID);
        await expectExpanded(page, COLLAPSE_OTHER_RAID, 1);
    });

    // Collapsed sections live in memory only, by design: the raid filter, which is saved,
    // is the way to hide raids for good. So a reload starts every section expanded.
    test('expands every section again after a reload', async ({ page }) => {
        await page.goto('/active-sessions');
        await headerOf(page, COLLAPSE_RAID).click();
        await expectCollapsed(page, COLLAPSE_RAID);

        await page.reload();

        await expectExpanded(page, COLLAPSE_RAID, 2);
    });

    // The ticket's Collapse all criterion: one click folds every visible section, the button
    // then offers the opposite, and Expand all undoes it.
    test('collapses every visible section with Collapse all, and Expand all reverses it', async ({ page }) => {
        await showOnlyThisFilesRaids(page);
        const button = collapseAllButton(page);
        await expect(button).toHaveText('Collapse all');

        await button.click();

        await expectCollapsed(page, COLLAPSE_RAID);
        await expectCollapsed(page, COLLAPSE_OTHER_RAID);
        await expect(button).toHaveText('Expand all');

        await button.click();

        await expectExpanded(page, COLLAPSE_RAID, 2);
        await expectExpanded(page, COLLAPSE_OTHER_RAID, 1);
        await expect(button).toHaveText('Collapse all');
    });

    // The rule the user added: the button reads Expand all only when every visible section
    // is collapsed. With one still open, collapsing is the useful action, so it says that.
    test('reads Collapse all while any visible section is still expanded', async ({ page }) => {
        await showOnlyThisFilesRaids(page);
        const button = collapseAllButton(page);

        await headerOf(page, COLLAPSE_RAID).click();
        await expect(button).toHaveText('Collapse all');

        await headerOf(page, COLLAPSE_OTHER_RAID).click();
        await expect(button).toHaveText('Expand all');

        await headerOf(page, COLLAPSE_RAID).click();
        await expect(button).toHaveText('Collapse all');
    });

    // A section the raid filter brings in is new activity on screen, so it starts expanded,
    // and the button goes back to Collapse all. Sections already collapsed stay collapsed.
    test('starts a section that a raid-filter change brings in expanded', async ({ page }) => {
        await page.goto('/active-sessions');
        await toggleInRaidFilter(page, COLLAPSE_RAID);
        await expect(page.getByRole('heading', { level: 2 })).toHaveText([COLLAPSE_RAID.name]);
        await collapseAllButton(page).click();
        await expect(collapseAllButton(page)).toHaveText('Expand all');

        await toggleInRaidFilter(page, COLLAPSE_OTHER_RAID);

        await expectExpanded(page, COLLAPSE_OTHER_RAID, 1);
        await expectCollapsed(page, COLLAPSE_RAID);
        await expect(collapseAllButton(page)).toHaveText('Collapse all');
    });

    // The same rule from the other side: a section the filter hides and then shows again is
    // newly on screen, so it comes back expanded rather than remembering it was collapsed.
    test('brings a section back expanded after the raid filter hides and shows it', async ({ page }) => {
        await showOnlyThisFilesRaids(page);
        await headerOf(page, COLLAPSE_RAID).click();
        await expectCollapsed(page, COLLAPSE_RAID);

        await toggleInRaidFilter(page, COLLAPSE_RAID);
        await expect(sectionOf(page, COLLAPSE_RAID)).toHaveCount(0);
        await toggleInRaidFilter(page, COLLAPSE_RAID);

        await expectExpanded(page, COLLAPSE_RAID, 2);
    });

    // The header is a real button inside the h2, so keyboard and screen-reader users can fold
    // a section too: Enter and Space both toggle it, aria-expanded says which state it is
    // in, and aria-controls names the section's content, which stays in the page (hidden)
    // while collapsed so the reference always resolves.
    test('operates a section header from the keyboard', async ({ page }) => {
        await page.goto('/active-sessions');
        const header = headerOf(page, COLLAPSE_RAID);
        await expectExpanded(page, COLLAPSE_RAID, 2);

        await header.focus();
        await page.keyboard.press('Enter');

        await expect(header).toHaveAttribute('aria-expanded', 'false');
        const contentId = await header.getAttribute('aria-controls');
        expect(contentId, 'the header names the content it controls').toBeTruthy();
        const content = page.locator(`[id="${contentId}"]`);
        await expect(content).toHaveCount(1);
        await expect(content).toBeHidden();

        await page.keyboard.press('Space');

        await expect(header).toHaveAttribute('aria-expanded', 'true');
        await expect(content).toBeVisible();
        await expect(fireteamRows(sectionOf(page, COLLAPSE_RAID))).toHaveCount(2);
    });

    // A maintenance response shows no sessions because none could be read, not because the
    // raids ended. Like open rows (#158), collapsed sections survive it, rather than every
    // section springing open each time the database is briefly busy.
    test('keeps a collapsed section collapsed across a maintenance response', async ({ page }) => {
        await page.goto('/active-sessions');
        await headerOf(page, COLLAPSE_RAID).click();
        await expectCollapsed(page, COLLAPSE_RAID);

        await page.route('**/api/active-sessions*', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                raidKey: 'all', count: 0, total: 0, shown: 0, sessions: [],
                maintenance: true, message: 'Database maintenance is in progress.',
            }),
        }));
        await refresh(page);
        await expect(page.getByText('Database maintenance is in progress.')).toBeVisible();
        await expect(sectionOf(page, COLLAPSE_RAID)).toHaveCount(0);

        await page.unroute('**/api/active-sessions*');
        await refresh(page);

        await expectCollapsed(page, COLLAPSE_RAID);
        await expectExpanded(page, COLLAPSE_OTHER_RAID, 1);
    });

    // With no sections on the page, "every visible section is collapsed" is true of nothing,
    // and offering Expand all would be offering to expand nothing. The button stays as
    // Collapse all, disabled, so the control bar doesn't change shape.
    test('disables Collapse all when the raid filter leaves no sections', async ({ page }) => {
        await page.goto('/active-sessions');
        await toggleInRaidFilter(page, UNSEEDED_RAID);

        await expect(page.getByText('No active raid sessions found')).toBeVisible();
        await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
        await expect(collapseAllButton(page)).toHaveText('Collapse all');
        await expect(collapseAllButton(page)).toBeDisabled();
    });

    // Collapsing unmounts a section's rows, but which rows are open is the page's state, not
    // the rows', so an open row is still open when its section expands again. Counting the
    // rows with the row open also pins the row locator to the section's own list: a locator
    // that reached into the open row's member list would count 2 + 5 here.
    test('brings an open row back open when its section expands', async ({ page }) => {
        await page.goto('/active-sessions');
        const section = sectionOf(page, COLLAPSE_RAID);
        const row = fireteamRow(section, leaderOf(0));
        await row.getByTitle('6 of 6 players').click();
        await expect(memberList(row).getByRole('listitem')).toHaveCount(5);

        await headerOf(page, COLLAPSE_RAID).click();
        await expectCollapsed(page, COLLAPSE_RAID);
        await headerOf(page, COLLAPSE_RAID).click();

        await expect(fireteamRows(section)).toHaveCount(2);
        await expect(row.getByRole('button', { name: 'Fireteam members' })).toHaveAttribute('aria-expanded', 'true');
        await expect(memberList(row).getByRole('listitem')).toHaveCount(5);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        // The ticket's phone criterion: at 360px the control bar wraps, so every control has
        // to land inside the viewport without overlapping another, with Collapse all still
        // beside Refresh. A collapsed section's header keeps its name and count on screen.
        test('fits the controls and a collapsed header inside a 360px viewport', async ({ page }) => {
            await page.goto('/active-sessions');
            await expectExpanded(page, COLLAPSE_RAID, 2);
            const controls = {
                raidFilter: page.locator('button[aria-haspopup="listbox"]'),
                refresh: page.getByRole('button', { name: 'Refresh' }),
                collapseAll: collapseAllButton(page),
                view: page.getByRole('group', { name: 'View' }),
            };
            const boxes = Object.fromEntries(
                await Promise.all(Object.entries(controls).map(async ([name, control]) => [name, await boxOf(control)] as const)),
            );

            for (const [name, box] of Object.entries(boxes)) {
                expect(box.x, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width, `${name} ends inside the viewport`).toBeLessThanOrEqual(360);
            }
            const names = Object.keys(boxes);
            for (const [i, a] of names.entries()) {
                for (const b of names.slice(i + 1)) {
                    const [p, q] = [boxes[a], boxes[b]];
                    const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
                    expect(apart, `${a} and ${b} don't overlap`).toBe(true);
                }
            }
            expect(boxes.collapseAll.y, 'Collapse all sits on the same line as Refresh').toBe(boxes.refresh.y);
            expect(boxes.collapseAll.x, 'Collapse all sits after Refresh').toBeGreaterThan(boxes.refresh.x);

            await headerOf(page, COLLAPSE_RAID).click();
            await expectCollapsed(page, COLLAPSE_RAID);
            const section = sectionOf(page, COLLAPSE_RAID);
            for (const part of [headerOf(page, COLLAPSE_RAID), section.getByText('2 sessions', { exact: true })]) {
                const box = await boxOf(part);
                expect(box.x + box.width, 'the collapsed header ends inside the viewport').toBeLessThanOrEqual(360);
            }
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
