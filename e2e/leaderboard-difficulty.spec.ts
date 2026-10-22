import type { Locator, Page, Request } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { DIFFICULTY_DP, DIFFICULTY_VOG, difficultyPlayerName } from './support/seed-world';
import { expectNoOverflow } from './support/viewport';

/**
 * The leaderboard's Difficulty dropdown (#41) — what only a browser can see.
 *
 * Which runs count under each Difficulty, and which raids' boards the API leaves out, are
 * pinned in tests/db/ and tests/routes/leaderboard.test.ts. What those tests can't see is the
 * page: that the dropdown is there on both tabs with All / Normal / Master / Epic, that a choice
 * reaches the server as `difficulty=` and its answer reaches the screen, that the choice is kept
 * across a reload (old stored values included), and that a raid with no version at the chosen
 * Difficulty has no card while one with the version but no clears keeps its empty card.
 *
 * The seeded world has FixtureGolf on Vault of Glass Normal (Feats on), FixtureHotel on Vault of
 * Glass Master and FixtureIndia on The Desert Perpetual Epic. See DIFFICULTY_PLAYERS.
 */

const DIFFICULTY_FILTER_KEY = 'destiny-farm-finder-difficulty-filter';

/** A raid with a Master version that the seeded world gives no clears at all. */
const MASTER_RAID_WITHOUT_CLEARS = 'Root of Nightmares';
/** A raid with no Master version, and no Epic one either. */
const RAID_WITHOUT_MASTER = 'Deep Stone Crypt';

function difficultySelect(page: Page): Locator {
    return page.getByRole('combobox', { name: 'Difficulty' });
}

/** One raid's card: the card holding that raid's heading. */
function raidCard(page: Page, raidName: string): Locator {
    return page.locator('.ui-card').filter({ has: page.getByRole('heading', { name: raidName, exact: true }) });
}

/** Every raid card's heading on the page. Card titles are the only level-3 headings. */
function cardHeadings(page: Page): Locator {
    return page.getByRole('heading', { level: 3 });
}

function isLeaderboardRequest(request: Request, difficulty: string | null): boolean {
    if (!request.url().includes('/api/leaderboard')) return false;
    return new URL(request.url()).searchParams.get('difficulty') === difficulty;
}

/** Selects a Difficulty and waits for the request it must send. */
async function chooseDifficulty(page: Page, value: '' | 'normal' | 'master' | 'epic'): Promise<Request> {
    // Armed before the change: the request is what proves the server was asked, rather than
    // the page hiding rows it had already fetched.
    const request = page.waitForRequest((r) => isLeaderboardRequest(r, value || null));
    await difficultySelect(page).selectOption(value);
    return request;
}

test.describe('the Difficulty dropdown', () => {
    for (const path of ['/leaderboard', '/leaderboard?board=fastest']) {
        test(`offers All, Normal, Master and Epic, with All first, on ${path}`, async ({ page }) => {
            await page.goto(path);

            const select = difficultySelect(page);
            await expect(select.locator('option')).toHaveText(['All', 'Normal', 'Master', 'Epic']);
            await expect(select).toHaveValue('');
        });
    }

    test('Master counts only the Master run, hides raids with no Master version, and keeps an empty card', async ({ page }) => {
        await page.goto('/leaderboard');
        await expect(raidCard(page, RAID_WITHOUT_MASTER)).toBeVisible();

        await chooseDifficulty(page, 'master');

        const vog = raidCard(page, DIFFICULTY_VOG.name);
        await expect(vog.getByRole('link', { name: difficultyPlayerName('master') })).toBeVisible();
        // Golf's Normal run has Feats on: the run the old filter counted as Master.
        await expect(vog.getByRole('link', { name: difficultyPlayerName('normal') })).toHaveCount(0);

        await expect(raidCard(page, RAID_WITHOUT_MASTER)).toHaveCount(0);
        await expect(raidCard(page, DIFFICULTY_DP.name)).toHaveCount(0);
        await expect(raidCard(page, MASTER_RAID_WITHOUT_CLEARS).getByText('No completions found')).toBeVisible();
    });

    test('Normal counts a Normal run with Feats on, and All brings every card back', async ({ page }) => {
        await page.goto('/leaderboard');

        await chooseDifficulty(page, 'normal');
        const vog = raidCard(page, DIFFICULTY_VOG.name);
        await expect(vog.getByRole('link', { name: difficultyPlayerName('normal') })).toBeVisible();
        await expect(vog.getByRole('link', { name: difficultyPlayerName('master') })).toHaveCount(0);

        // A raid's Normal and Master runs are one card: under All, both players are on it.
        await chooseDifficulty(page, '');
        await expect(vog.getByRole('link', { name: difficultyPlayerName('normal') })).toBeVisible();
        await expect(vog.getByRole('link', { name: difficultyPlayerName('master') })).toBeVisible();
        await expect(raidCard(page, RAID_WITHOUT_MASTER)).toBeVisible();
    });

    test('Epic on the Fastest Clears tab leaves The Desert Perpetual as the only card', async ({ page }) => {
        await page.goto('/leaderboard?board=fastest');

        const request = await chooseDifficulty(page, 'epic');
        expect(new URL(request.url()).searchParams.get('board')).toBe('fastest');

        await expect(cardHeadings(page)).toHaveText([DIFFICULTY_DP.name]);
        await expect(raidCard(page, DIFFICULTY_DP.name).getByRole('link', { name: difficultyPlayerName('epic') })).toBeVisible();
    });

    test('keeps the choice across a reload', async ({ page }) => {
        await page.goto('/leaderboard');
        await chooseDifficulty(page, 'epic');
        await expect(cardHeadings(page)).toHaveText([DIFFICULTY_DP.name]);

        const reloaded = page.waitForRequest((r) => isLeaderboardRequest(r, 'epic'));
        await page.reload();
        await reloaded;

        await expect(difficultySelect(page)).toHaveValue('epic');
        await expect(cardHeadings(page)).toHaveText([DIFFICULTY_DP.name]);
    });

    test('a value stored before Epic existed still loads', async ({ page }) => {
        // 'master' is what a visitor kept from before #41's dropdown came back.
        await page.addInitScript((key) => localStorage.setItem(key, 'master'), DIFFICULTY_FILTER_KEY);

        const request = page.waitForRequest((r) => isLeaderboardRequest(r, 'master'));
        await page.goto('/leaderboard');
        await request;

        await expect(difficultySelect(page)).toHaveValue('master');
        await expect(raidCard(page, RAID_WITHOUT_MASTER)).toHaveCount(0);
    });

    test('an unreadable stored value reads as All', async ({ page }) => {
        await page.addInitScript((key) => localStorage.setItem(key, 'legendary'), DIFFICULTY_FILTER_KEY);

        const request = page.waitForRequest((r) => isLeaderboardRequest(r, null));
        await page.goto('/leaderboard');
        await request;

        await expect(difficultySelect(page)).toHaveValue('');
        await expect(raidCard(page, RAID_WITHOUT_MASTER)).toBeVisible();
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('fits the controls and the narrowed cards without sideways scroll', async ({ page }) => {
            await page.goto('/leaderboard');
            await expect(difficultySelect(page)).toBeVisible();

            await chooseDifficulty(page, 'master');
            await expect(raidCard(page, DIFFICULTY_VOG.name).getByRole('link', { name: difficultyPlayerName('master') })).toBeVisible();

            await expectNoOverflow(page);
        });
    });
});
