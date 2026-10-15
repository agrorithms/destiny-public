import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { EXPAND_RAID, fireteamMemberName, seedFireteams, seedPlayerWithSession } from './support/seed-world';
import { fireteamRows } from './support/fireteam-rows';
import { boxOf, expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';
import { seedPlayer } from '../tests/helpers/seed';

/**
 * #158: a list row expands to show the rest of its Roster, and open rows stay open across
 * refreshes.
 *
 * Which member a row leaves out, and when two polls describe the same fireteam, are Roster
 * rules tested in Vitest (src/lib/active-session/roster.test.ts). This file covers what only
 * the page can show: the click target, the chevron, several open rows, open rows surviving
 * Refresh (including a Roster that grows in between), and the phone width.
 *
 * Fixture namespace `88`, all on a raid no other spec seeds:
 * - `881`: two six-player fireteams with the leader in seat 2;
 * - `882`: one five-player fireteam (leader in seat 0) that the growth spec reseeds as six;
 * - `883`: one tracked player with no leader flagged and five other members, every name as
 *   long as a Bungie Name gets (26 characters), for the phone-width check.
 */
const FIRETEAM_PREFIX = '881';
const LEADER_SEAT = 2;
const GROWING_PREFIX = '882';
const LONG = {
    membershipId: '88300',
    name: 'Roster883TrackedWithALongN',
    code: 1883,
    members: [1, 2, 3, 4, 5].map((n) => ({ membershipId: `8830${n}`, name: `Roster883Member${n}WithALongN` })),
};

test.beforeAll(async () => {
    seedFireteams({ count: 2, size: 6, prefix: FIRETEAM_PREFIX, raid: EXPAND_RAID, leaderSeat: LEADER_SEAT });
    seedFireteams({ count: 1, size: 5, prefix: GROWING_PREFIX, raid: EXPAND_RAID, leaderSeat: 0 });
    seedPlayerWithSession({ ...LONG, raid: EXPAND_RAID, extraMembers: LONG.members.map((m) => m.membershipId) });
    for (const member of LONG.members) seedPlayer(member.membershipId, member.name, LONG.code);
});

/** The row titled "<name>'s fireteam" in this spec's raid section. */
function rowOf(page: Page, name: string) {
    return fireteamRows(page.getByRole('region', { name: EXPAND_RAID.name })).filter({ hasText: `${name}'s fireteam` });
}

function leaderOf(fireteam: number): string {
    return fireteamMemberName(FIRETEAM_PREFIX, fireteam, LEADER_SEAT);
}

/** Every seat of an `881` fireteam except the leader's: who its expanded row should list. */
function othersOf(fireteam: number): string[] {
    return [0, 1, 3, 4, 5].map((seat) => fireteamMemberName(FIRETEAM_PREFIX, fireteam, seat));
}

test.describe('active sessions expandable rows', () => {
    // The ticket's first two criteria together: a click anywhere on the row (here, the
    // player count, which is plain text) opens it, the chevron says so, and the open row
    // lists the other five members as full Name#Code links. A second click closes it.
    test('opens and closes a row on a click, with the chevron showing which', async ({ page }) => {
        await page.goto('/active-sessions');
        const row = rowOf(page, leaderOf(0));
        const chevron = row.getByRole('button', { name: 'Fireteam members' });
        await expect(chevron).toHaveAttribute('aria-expanded', 'false');
        await expect(row.getByRole('list')).toHaveCount(0);

        await row.getByTitle('6 of 6 players').click();

        await expect(chevron).toHaveAttribute('aria-expanded', 'true');
        const members = row.getByRole('list', { name: 'Other fireteam members' });
        await expect(members.getByRole('listitem')).toHaveText(othersOf(0));
        for (const name of othersOf(0)) {
            await expect(members.getByRole('link', { name, exact: true })).toHaveAttribute('href', /^\/player\/3\/881\d+$/);
        }

        await row.getByTitle('Time elapsed').click();

        await expect(chevron).toHaveAttribute('aria-expanded', 'false');
        await expect(members).toHaveCount(0);
    });

    // The chevron is a real button, so keyboard and screen-reader users can open a row
    // too: Enter toggles it, and aria-controls names the list it opens.
    test('opens a row from the keyboard through the chevron button', async ({ page }) => {
        await page.goto('/active-sessions');
        const row = rowOf(page, leaderOf(0));
        const chevron = row.getByRole('button', { name: 'Fireteam members' });

        await chevron.focus();
        await page.keyboard.press('Enter');

        await expect(chevron).toHaveAttribute('aria-expanded', 'true');
        const listId = await chevron.getAttribute('aria-controls');
        expect(listId, 'the chevron names the list it controls').toBeTruthy();
        await expect(page.locator(`[id="${listId}"]`)).toHaveText(new RegExp(othersOf(0)[0]));
    });

    // The leader's name is a link to their player page and must keep working as one. The
    // click still reaches the row (it bubbles), so the row has to tell it apart. The
    // navigation is cancelled here only so the row can be checked afterwards.
    test('does not toggle the row when the title link is clicked', async ({ page }) => {
        await page.goto('/active-sessions');
        const row = rowOf(page, leaderOf(0));
        const link = row.getByRole('link', { name: leaderOf(0), exact: true });
        await link.evaluate((a) => a.addEventListener('click', (event) => event.preventDefault()));

        await link.click();

        await expect(row.getByRole('button', { name: 'Fireteam members' })).toHaveAttribute('aria-expanded', 'false');
    });

    // The other half: the same click, not cancelled, goes to the leader's player page. The
    // player page itself is answered with a stub so it can't make its own writes against
    // this spec's players (it calls the client-write endpoints on load).
    test('follows the title link to the leader\'s player page', async ({ page }) => {
        await page.goto('/active-sessions');
        const link = rowOf(page, leaderOf(0)).getByRole('link', { name: leaderOf(0), exact: true });
        const href = await link.getAttribute('href');
        await page.route('**/player/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>player</title>' }));

        await link.click();

        await expect(page).toHaveURL(new RegExp(`${href}$`));
    });

    // Several rows can be open at once: opening a second row must not close the first.
    test('keeps several rows open at once', async ({ page }) => {
        await page.goto('/active-sessions');

        await rowOf(page, leaderOf(0)).getByTitle('6 of 6 players').click();
        await rowOf(page, leaderOf(1)).getByTitle('6 of 6 players').click();

        for (const fireteam of [0, 1]) {
            await expect(rowOf(page, leaderOf(fireteam)).getByRole('button', { name: 'Fireteam members' }))
                .toHaveAttribute('aria-expanded', 'true');
            await expect(rowOf(page, leaderOf(fireteam)).getByRole('list').getByRole('listitem')).toHaveText(othersOf(fireteam));
        }
    });

    // The ticket's headline: a refresh replaces every session object, and an open row must
    // still be open after it. Refresh runs the same fetch as the 30-second poll. The second
    // row stays shut, so a refresh that opened everything would fail too.
    test('keeps an open row open after Refresh', async ({ page }) => {
        await page.goto('/active-sessions');
        await rowOf(page, leaderOf(0)).getByTitle('6 of 6 players').click();
        const refreshed = page.waitForResponse((response) => response.url().includes('/api/active-sessions'));

        await page.getByRole('button', { name: 'Refresh' }).click();
        await refreshed;
        await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();

        await expect(rowOf(page, leaderOf(0)).getByRole('button', { name: 'Fireteam members' })).toHaveAttribute('aria-expanded', 'true');
        await expect(rowOf(page, leaderOf(0)).getByRole('list').getByRole('listitem')).toHaveText(othersOf(0));
        await expect(rowOf(page, leaderOf(1)).getByRole('button', { name: 'Fireteam members' })).toHaveAttribute('aria-expanded', 'false');
    });

    // Someone joins between refreshes: the five-player Roster becomes six, so the row's member
    // set changes. An open row keyed by the exact member set would close here; keyed by session
    // identity (one Roster containing the other) it stays open and now lists the newcomer.
    test('keeps an open row open when a member joins between refreshes', async ({ page }) => {
        const leader = fireteamMemberName(GROWING_PREFIX, 0, 0);
        const newcomer = fireteamMemberName(GROWING_PREFIX, 0, 5);
        await page.goto('/active-sessions');
        const row = rowOf(page, leader);
        await row.getByTitle('5 of 6 players').click();
        await expect(row.getByRole('list').getByRole('listitem')).toHaveCount(4);

        seedFireteams({ count: 1, size: 6, prefix: GROWING_PREFIX, raid: EXPAND_RAID, leaderSeat: 0 });
        await page.getByRole('button', { name: 'Refresh' }).click();

        await expect(row.getByTitle('6 of 6 players')).toBeVisible();
        await expect(row.getByRole('button', { name: 'Fireteam members' })).toHaveAttribute('aria-expanded', 'true');
        await expect(row.getByRole('list').getByRole('link', { name: newcomer, exact: true })).toBeVisible();
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        // The ticket's phone criterion: an open row, listing five names as long as Bungie
        // Names get, doesn't scroll sideways and neither does the page. And opening a row
        // mustn't break #157's collapsed title, which has to stay one line tall.
        test('fits an open row of long names inside a 360px viewport', async ({ page }) => {
            await page.goto('/active-sessions');
            const row = rowOf(page, `${LONG.name}#${LONG.code}`);
            await row.getByTitle('6 of 6 players').click();
            const members = row.getByRole('list').getByRole('listitem');
            await expect(members).toHaveCount(5);

            await expectNoElementOverflow(row, 'an open list row');
            await expectNoHorizontalPageOverflow(page);
            for (const member of await members.all()) {
                const box = await boxOf(member);
                expect(box.x + box.width, 'a member ends inside the viewport').toBeLessThanOrEqual(360);
            }

            const titleCell = row.getByRole('link', { name: `${LONG.name}#${LONG.code}`, exact: true }).locator('..');
            const { height, lineHeight } = await titleCell.evaluate((cell) => ({
                height: cell.clientHeight,
                lineHeight: parseFloat(getComputedStyle(cell).lineHeight),
            }));
            expect(height, "the open row's title is one line tall").toBe(lineHeight);
        });
    });
});
