import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { ACTIVITY_SCOPES, type ActivityScopeId } from '../src/app/activity/activity-scope';
import { ACTIVITY_SCOPE_TOP_RAIDS, RAID_STATS_TOO_FEW, RAID_STATS_WEEK } from './support/seed-world';
import { expectInsideViewport, expectNoOverflow } from './support/viewport';
import { withDbQuiesced } from '../tests/helpers/db-quiesce';

/**
 * The Raid Activity page's Raid Stats tab (#200): one card per raid, its Clear Time over Full
 * Clears and its KDA and class split under the page's Scope, beside the chart as a second tab
 * held in `?view=stats`. What the numbers are is pinned in tests/db/raid-stats.test.ts and the
 * board's wording in src/app/activity/raid-stats-view.test.ts; what only a browser can see is
 * here: the tab strip and the URL, the range and scope links keeping the tab, the raids dropped
 * on a switch, a scope switch moving KDA and Classes and not Clear Time, the too-few card, the
 * 30-day rule, maintenance, a warm tab with JavaScript off, and a phone.
 *
 * The seeded figures are Salvation's Edge's ({@link RAID_STATS_WEEK}, ./support/seed-world.ts):
 * its Checkpoint Runs, unfinished Fresh Runs and Full Clears were played by different classes at
 * different KDAs, so each Scope reads differently.
 *
 * **Not here: the empty state.** The e2e Tracker has runs in every window, so a board with no
 * raid can't be reached in a browser; raid-stats-view.test.ts proves an empty frame gives it (an
 * accepted gap, docs/e2e-coverage.md). **Nor the streaming order**: the seed's queries take
 * milliseconds, so a cold load here arrives whole. The order was measured on a prod backup and
 * recorded in docs/progress/200-raid-stats-tab.md.
 */

test.use({ timezoneId: 'UTC' });

const STATS_WEEK = '/activity?range=7d&view=stats';

function scopeOf(id: ActivityScopeId) {
    return ACTIVITY_SCOPES.find((scope) => scope.id === id)!;
}

function tab(page: Page, name: 'Raids in Progress' | 'Raid Stats'): Locator {
    return page.getByTestId('activity-view').getByRole('link', { name, exact: true });
}

function rangeLink(page: Page, label: string): Locator {
    return page.getByTestId('activity-range').getByRole('link', { name: label, exact: true });
}

function scopeLink(page: Page, id: ActivityScopeId): Locator {
    return page.getByTestId('activity-scope').getByRole('link', { name: scopeOf(id).label, exact: true });
}

/**
 * A raid's card as the reader sees it. On a cold load the cards are streamed: React keeps the
 * finished ones in a hidden segment beside the fallback until it reveals them, which can be after
 * the `load` event, so only the visible copy counts.
 */
function card(page: Page, raidKey: string): Locator {
    return page.locator(`[data-testid="raid-stats-card"][data-raid="${raidKey}"]:visible`);
}

/** The URL's query, without the origin and path, for exact comparison. */
function query(page: Page): string {
    return new URL(page.url()).search;
}

/** A panel's figures as `[label, value]` pairs, in the order shown. */
async function figures(panel: Locator): Promise<string[][]> {
    return panel.getByTestId('raid-stats-figure').evaluateAll((items) =>
        items.map((item) => [item.querySelector('dt')?.textContent ?? '', item.querySelector('dd')?.textContent ?? ''])
    );
}

/** Salvation's Edge's card shows the week's Clear Time and `scope`'s KDA and classes. */
async function expectSeCard(page: Page, scope: ActivityScopeId): Promise<void> {
    const se = card(page, RAID_STATS_WEEK.raid.key);
    const clearTime = se.getByTestId('raid-stats-clear-time');
    const kda = se.getByTestId('raid-stats-kda');
    await expect.poll(() => figures(clearTime)).toEqual(RAID_STATS_WEEK.clearTime.figures);
    await expect(clearTime.getByTestId('raid-stats-sample')).toHaveText(RAID_STATS_WEEK.clearTime.sample);
    await expect.poll(() => figures(kda), { message: `KDA under ${scope}` }).toEqual(RAID_STATS_WEEK.scopes[scope].figures);
    await expect(kda.getByTestId('raid-stats-sample')).toHaveText(RAID_STATS_WEEK.scopes[scope].sample);
    await expect(se.getByTestId('raid-stats-classes')).toHaveText(RAID_STATS_WEEK.scopes[scope].classes);
}

/** The raid keys the chart's bottom panel draws, in order. */
async function drawnRaids(page: Page): Promise<string[]> {
    return page.getByTestId('activity-raid-line').evaluateAll((lines) => lines.map((line) => line.getAttribute('data-raid') ?? ''));
}

// First in the file, and the file is the first to open the stats tab (`activity-scope` sorts
// before it, `activity.spec.ts` after; neither visits `view=stats`). Maintenance shows only on a
// cache miss: a frame already cached would be served, as the chart's series is, so this request
// must be the run's first for the 24-hour stats tab. The check below says so if it isn't.
test.describe('the Raid Stats tab during maintenance', () => {
    test('says the stats are unavailable and keeps the tabs and links (the run\'s first 24h stats request)', async ({ page }) => {
        await withDbQuiesced(async () => {
            await page.goto('/activity?range=24h&view=stats');
            await expect(page.getByTestId('activity-maintenance').or(page.locator('[data-testid="raid-stats-card"]:visible').first())).toBeVisible();
            if ((await page.locator('[data-testid="raid-stats-card"]:visible').count()) > 0) {
                throw new Error(
                    'Precondition broken: this must be the first request of the e2e run for /activity?range=24h&view=stats. ' +
                    'Its frame was already cached, so the page was served from the cache and maintenance cannot show. ' +
                    'Keep this test first in this file, and keep every other spec off the 24h stats tab before it.'
                );
            }
            await expect(page.getByTestId('activity-maintenance')).toHaveText(
                'Database maintenance is in progress. Raid Stats is temporarily unavailable.'
            );
            await expect(tab(page, 'Raid Stats')).toHaveAttribute('aria-current', 'page');
            await expect(rangeLink(page, '24h')).toHaveAttribute('aria-current', 'page');
            await expect(scopeLink(page, 'all')).toHaveAttribute('aria-current', 'page');
        });
    });
});

test.describe('the tab strip', () => {
    test('Raids in Progress is the chart and current on a plain link; Raid Stats sets view=stats and survives a reload', async ({ page }) => {
        await page.goto('/activity?range=7d');
        await expect(tab(page, 'Raids in Progress')).toHaveAttribute('aria-current', 'page');
        await expect(tab(page, 'Raid Stats')).not.toHaveAttribute('aria-current');
        await expect(page.getByTestId('activity-chart')).toBeVisible();

        await tab(page, 'Raid Stats').click();
        await expect(page).toHaveURL(STATS_WEEK);
        await expect(tab(page, 'Raid Stats')).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('raid-stats-board')).toBeVisible();
        await expect(page.getByTestId('activity-chart')).toHaveCount(0);
        await expect(page.getByTestId('activity-intro')).toHaveText(
            `Clear times and KDA per raid over the last 7 days. ${scopeOf('all').intro}`
        );
        await expect(page.getByTestId('raid-stats-arriving')).toBeVisible();

        await page.reload();
        await expect(tab(page, 'Raid Stats')).toHaveAttribute('aria-current', 'page');
        await expectSeCard(page, 'all');

        await tab(page, 'Raids in Progress').click();
        await expect(page).toHaveURL('/activity?range=7d');
        await expect(page.getByTestId('activity-chart')).toBeVisible();
    });

    test('an unreadable or repeated view shows the chart, with no redirect', async ({ page }) => {
        for (const url of ['/activity?range=7d&view=table', '/activity?range=7d&view=stats&view=stats']) {
            await page.goto(url);
            await expect(page.getByTestId('activity-chart'), url).toBeVisible();
            await expect(tab(page, 'Raids in Progress')).toHaveAttribute('aria-current', 'page');
            expect(page.url()).toContain(url);
        }
    });

    test('the stats tab draws the cards in the raid table\'s order, one per raid that ran', async ({ page }) => {
        await page.goto(STATS_WEEK);
        const shown = page.locator('[data-testid="raid-stats-card"]:visible');
        await expect
            .poll(() => shown.evaluateAll((cards) => cards.map((c) => c.getAttribute('data-raid'))))
            .toEqual(['the_desert_perpetual', 'salvations_edge', 'crotas_end', 'kings_fall', 'vault_of_glass', 'last_wish']);
    });
});

test.describe('the links shared by both tabs', () => {
    test('the range and scope links keep the tab', async ({ page }) => {
        await page.goto(STATS_WEEK);
        await rangeLink(page, '24h').click();
        await expect(page).toHaveURL('/activity?range=24h&view=stats');
        await expect(page.getByTestId('activity-intro')).toContainText('over the last 24 hours.');

        await scopeLink(page, 'fresh').click();
        await expect(page).toHaveURL('/activity?range=24h&scope=fresh&view=stats');
        await expect(tab(page, 'Raid Stats')).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('activity-intro')).toContainText(scopeOf('fresh').intro);
    });

    test('a tab switch drops the raids, and the chart tab lands on the range\'s top raids', async ({ page }) => {
        await page.goto('/activity?range=7d&raids=last_wish,crotas_end');
        expect(await drawnRaids(page)).toEqual(['last_wish', 'crotas_end']);
        await expect(tab(page, 'Raid Stats')).toHaveAttribute('href', STATS_WEEK);

        await tab(page, 'Raid Stats').click();
        await expect(page).toHaveURL(STATS_WEEK);
        await expect(page.getByTestId('activity-raid-picker')).toHaveCount(0);
        for (const link of await page.getByTestId('activity-range').getByRole('link').all()) {
            expect(await link.getAttribute('href')).not.toContain('raids');
        }

        await tab(page, 'Raids in Progress').click();
        await expect(page).toHaveURL('/activity?range=7d');
        await expect.poll(() => drawnRaids(page)).toEqual([...ACTIVITY_SCOPE_TOP_RAIDS.all]);
    });

    test('a stats tab link with raids is redirected to the same link without them', async ({ page }) => {
        await page.goto('/activity?range=24h&scope=full&view=stats&raids=last_wish');
        await expect(page).toHaveURL('/activity?range=24h&scope=full&view=stats');
        await expect(page.getByTestId('raid-stats-board')).toBeVisible();
    });
});

test.describe('the scope on the stats tab', () => {
    test('a scope switch changes KDA and Classes and leaves Clear Time alone', async ({ page }) => {
        await page.goto(STATS_WEEK);
        await expectSeCard(page, 'all');
        await scopeLink(page, 'full').click();
        await expect(page).toHaveURL('/activity?range=7d&scope=full&view=stats');
        await expectSeCard(page, 'full');
        await scopeLink(page, 'fresh').click();
        await expect(page).toHaveURL('/activity?range=7d&scope=fresh&view=stats');
        await expectSeCard(page, 'fresh');
    });

    test('a raid under three runs says so in place of its figures', async ({ page }) => {
        await page.goto(STATS_WEEK);
        const tooFew = card(page, RAID_STATS_TOO_FEW.key);
        await expect(tooFew.getByRole('heading', { name: RAID_STATS_TOO_FEW.name })).toBeVisible();
        await expect(tooFew.getByTestId('raid-stats-clear-time')).toContainText('1 run, too few to show');
        await expect(tooFew.getByTestId('raid-stats-kda')).toContainText('1 run, too few to show');
        await expect(tooFew.getByTestId('raid-stats-figure')).toHaveCount(0);
        await expect(tooFew.getByTestId('raid-stats-classes')).toHaveCount(0);
    });

    for (const scope of ['all', 'fresh', 'full'] as const) {
        test(`at 30 days under ${scope}, one line replaces the scope links and the tab shows Full Clears`, async ({ page }) => {
            const url = `/activity?range=30d${scope === 'all' ? '' : `&scope=${scope}`}&view=stats`;
            await page.goto(url);
            await expect(page).toHaveURL(url);
            await expect(page.getByTestId('activity-full-clears-only')).toHaveText('30 days shows Full Clears only');
            await expect(page.getByTestId('activity-scope')).toHaveCount(0);
            await expect(page.getByTestId('activity-intro')).toHaveText(
                `Clear times and KDA per raid over the last 30 days. ${scopeOf('full').intro}`
            );
            await expectSeCard(page, 'full');
        });
    }

    test('the chart tab keeps the scope chosen before a 30-day stats visit', async ({ page }) => {
        await page.goto('/activity?range=30d&scope=fresh&view=stats');
        await tab(page, 'Raids in Progress').click();
        await expect(page).toHaveURL('/activity?range=30d&scope=fresh');
        await expect(scopeLink(page, 'fresh')).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('activity-intro')).toContainText(scopeOf('fresh').intro);
    });
});

test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    // A warm tab is in the first HTML, panels and all; a cold one would leave the skeleton and its
    // <noscript> line, which a reader with JavaScript off never sees replaced. One earlier request
    // to the same server warms the frame and the scope (the e2e server is one process).
    test('a warm stats tab shows every panel, with no skeleton', async ({ page, request }) => {
        const url = '/activity?range=7d&scope=full&view=stats';
        expect((await request.get(url)).ok()).toBe(true);
        await page.goto(url);
        await expectSeCard(page, 'full');
        await expect(page.getByTestId('raid-stats-skeleton')).toHaveCount(0);
        await expect(page.getByText('Still computing. Reload shortly.')).toHaveCount(0);
    });

    test('the tabs are plain links, the chart tab is still drawn, and a stats link with raids is cleaned up', async ({ page }) => {
        await page.goto('/activity?range=7d');
        await expect(page.getByTestId('activity-chart')).toBeVisible();
        await tab(page, 'Raid Stats').click();
        await expect(page).toHaveURL(STATS_WEEK);
        await expect(page.getByTestId('raid-stats-board')).toBeVisible();

        await page.goto('/activity?range=7d&view=stats&raids=kings_fall');
        await expect(page).toHaveURL(STATS_WEEK);
        expect(query(page)).toBe('?range=7d&view=stats');
    });
});

test.describe('at phone width', () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test('the tab strip and a card fit 360px, at 7 days and at 30 days, with nothing overflowing', async ({ page }) => {
        for (const url of [STATS_WEEK, '/activity?range=30d&view=stats']) {
            await page.goto(url);
            await expectInsideViewport(page.getByTestId('activity-view'), `the tab strip at ${url}`);
            await expectInsideViewport(card(page, RAID_STATS_WEEK.raid.key), `Salvation's Edge's card at ${url}`);
            await expectNoOverflow(page);
        }
    });
});
