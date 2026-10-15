import { expect, test } from './support/test-fixtures';
import { RAID_B, fireteamMemberName, seedFireteams } from './support/seed-world';
import { fireteamRows } from './support/fireteam-rows';

/**
 * Flow #3. A player is identified by `Name#Code` and the full form must reach
 * the screen. Truncated names were a real production bug, which is why
 * CLAUDE.md makes storing `bungie_global_display_name` in full a convention.
 *
 * Two distinct failures are covered:
 *   - dropping the discriminator entirely, rendering a bare name
 *   - dropping the zero-padding, rendering "#7" where Bungie means "#0007"
 *
 * The padding case is the one most likely to regress unnoticed: it looks like a
 * valid name, just a different player's.
 */

/**
 * One fireteam of its own, on the other raid and under its own `82` namespace, so
 * this file's assertions cannot be perturbed by — or perturb — the counts in
 * active-sessions-cap.spec.ts regardless of execution order. Its Fireteam Leader
 * sits in seat 3, so the list row is titled after that member.
 */
const SESSION_PREFIX = '82';
const LEADER_SEAT = 3;

test.beforeAll(async () => {
    seedFireteams({ count: 1, size: 6, prefix: SESSION_PREFIX, raid: RAID_B, leaderSeat: LEADER_SEAT });
});

test.describe('player identity', () => {
    test('renders the full Name#Code on the leaderboard', async ({ page }) => {
        await page.goto('/leaderboard');

        await expect(page.getByRole('link', { name: 'FixtureAlpha#4242' })).toBeVisible();
    });

    test('zero-pads a short discriminator to four digits', async ({ page }) => {
        await page.goto('/leaderboard');

        // FixtureBravo is seeded with code 7. Bungie's canonical form is #0007;
        // formatBungieDisplayName pads it, and this is the only test that proves
        // the padded form survives all the way to the rendered row.
        await expect(page.getByRole('link', { name: 'FixtureBravo#0007' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'FixtureBravo#7', exact: true })).toHaveCount(0);
    });

    test('never renders a bare name without its discriminator', async ({ page }) => {
        await page.goto('/leaderboard');

        // Anchored on both ends: a bare "FixtureCharlie" link means the code was
        // lost somewhere between the players table and the row.
        await expect(page.getByRole('link', { name: /^FixtureCharlie$/ })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'FixtureCharlie#1111' })).toBeVisible();
    });

    test('renders the leader\'s full Name#Code in an active-session row title', async ({ page }) => {
        await page.goto('/active-sessions');

        // The other half of this flow. Session rosters are enriched server-side from
        // the players table via formatBungieDisplayName — a different code path
        // from the leaderboard, and one that renders raw membership ids when the
        // identity is missing, which is the failure this pins. Since #157 the list
        // view is the default and a row shows only its Fireteam Leader by name.
        const leader = fireteamMemberName(SESSION_PREFIX, 0, LEADER_SEAT);
        const row = fireteamRows(page.getByRole('region', { name: RAID_B.name })).filter({ hasText: `${leader}'s fireteam` });

        await expect(row).toContainText(`${leader}'s fireteam`);
        await expect(row.getByRole('link', { name: leader, exact: true })).toBeVisible();
    });

    test('renders a member\'s full Name#Code in an expanded active-session row', async ({ page }) => {
        await page.goto('/active-sessions');

        // Since #158 the rest of the Roster is behind a click: an open row lists every member
        // but the one it is titled after. Seat 0 is not the leader, so it only reaches the
        // screen through that list, enriched by the same server-side path as the title.
        const leader = fireteamMemberName(SESSION_PREFIX, 0, LEADER_SEAT);
        const member = fireteamMemberName(SESSION_PREFIX, 0, 0);
        const row = fireteamRows(page.getByRole('region', { name: RAID_B.name })).filter({ hasText: `${leader}'s fireteam` });

        await row.getByTitle('6 of 6 players').click();

        await expect(row.getByRole('list').getByRole('link', { name: member, exact: true }))
            .toHaveAttribute('href', /^\/player\/3\/\d+$/);
    });

    test('links each name to that player\'s profile', async ({ page }) => {
        await page.goto('/leaderboard');

        // membershipType 3 is what the fixture seeds; a wrong type here produces a
        // profile page that resolves to nobody.
        await expect(page.getByRole('link', { name: 'FixtureAlpha#4242' }))
            .toHaveAttribute('href', '/player/3/4611686018400010001');
    });
});
