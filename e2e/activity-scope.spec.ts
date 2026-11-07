import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { ACTIVITY_SCOPES, type ActivityScopeId } from '../src/app/activity/activity-scope';
import { ACTIVITY_SCOPE_PEAKS, ACTIVITY_SCOPE_TOP_RAIDS, RAID_A } from './support/seed-world';
import { expectInsideViewport, expectNoOverflow } from './support/viewport';

/**
 * The Raid Activity Scope (#204): the All · Fresh · Full Clears links under the range presets,
 * held in `?scope=`. Which runs each scope counts is pinned in tests/db/raids-in-progress.test.ts;
 * what only a browser can see is the page: that each link reaches the server and its answer
 * reaches the screen, that the scope survives a range switch, a reload and a raid pick, that a
 * bad link falls back to All Attempts, that the intro and the tooltips say which runs are
 * counted, that the default raids and their estimates follow the scope, that the links work
 * with JavaScript off, and that both rows of links fit a phone.
 *
 * The seeded world (`seedActivityRuns`, ./support/seed-world.ts) re-flags some of its runs as
 * Fresh Runs and Full Clears, so over 7 days the busiest hour is 3, 2 and 1 raids in progress
 * under the three scopes ({@link ACTIVITY_SCOPE_PEAKS}), and the default raids differ by scope
 * ({@link ACTIVITY_SCOPE_TOP_RAIDS}). The peak caption is how a spec tells which scope's line is
 * drawn: the line itself is request-time geometry.
 */

test.use({ timezoneId: 'UTC' });

function scopeOf(id: ActivityScopeId) {
    return ACTIVITY_SCOPES.find((scope) => scope.id === id)!;
}

/** The scope control's link to a scope, found by the label it shows. */
function scopeLink(page: Page, id: ActivityScopeId) {
    return page.getByTestId('activity-scope').getByRole('link', { name: scopeOf(id).label, exact: true });
}

function rangeLink(page: Page, label: string) {
    return page.getByTestId('activity-range').getByRole('link', { name: label, exact: true });
}

/** The 7-day busiest-hour caption for `raids` raids in progress. */
function weekPeak(raids: number): RegExp {
    return new RegExp(`^Busiest hour: ${raids} raids? in progress, `);
}

/**
 * The checks that the page on screen counts `id`'s runs: the control marks it and only it,
 * the intro names it, and — on the 7-day chart — the peak is that scope's.
 */
async function expectScopeDrawn(page: Page, id: ActivityScopeId, { week = true } = {}): Promise<void> {
    for (const scope of ACTIVITY_SCOPES) {
        if (scope.id === id) await expect(scopeLink(page, scope.id)).toHaveAttribute('aria-current', 'page');
        else await expect(scopeLink(page, scope.id), `${scope.id} is not marked`).not.toHaveAttribute('aria-current');
    }
    await expect(page.getByTestId('activity-intro')).toContainText(scopeOf(id).intro);
    if (week) await expect(page.getByTestId('activity-peak')).toHaveText(weekPeak(ACTIVITY_SCOPE_PEAKS[id]));
}

/** The raid keys the bottom panel draws, in the order it draws them. */
async function drawnRaids(page: Page): Promise<string[]> {
    return page.getByTestId('activity-raid-line').evaluateAll((lines) => lines.map((line) => line.getAttribute('data-raid') ?? ''));
}

/** The URL's query, without the origin and path, for exact comparison. */
function query(page: Page): string {
    return new URL(page.url()).search;
}

test.describe('the scope links', () => {
    test('each one sets ?scope= and redraws the total line, and All leaves the key out', async ({ page }) => {
        await page.goto('/activity');
        await expectScopeDrawn(page, 'all');
        const lines = new Set([await page.getByTestId('activity-line').getAttribute('d')]);

        for (const id of ['fresh', 'full'] as const) {
            await scopeLink(page, id).click();
            await expect(page).toHaveURL(new RegExp(`/activity\\?range=7d&scope=${id}$`));
            await expectScopeDrawn(page, id);
            lines.add(await page.getByTestId('activity-line').getAttribute('d'));
        }
        expect(lines.size, 'each scope draws its own line').toBe(3);

        await scopeLink(page, 'all').click();
        await expect(page).toHaveURL(/\/activity\?range=7d$/);
        await expectScopeDrawn(page, 'all');
    });

    test('each link carries its tooltip, and the intro follows the scope', async ({ page }) => {
        for (const scope of ACTIVITY_SCOPES) {
            await page.goto(`/activity?scope=${scope.id}`);
            for (const other of ACTIVITY_SCOPES) {
                await expect(scopeLink(page, other.id)).toHaveAttribute('title', other.title);
            }
            await expectScopeDrawn(page, scope.id);
            for (const other of ACTIVITY_SCOPES.filter((each) => each.id !== scope.id)) {
                await expect(page.getByTestId('activity-intro')).not.toContainText(other.intro);
            }
        }
    });

    test('the scope survives a range switch and a reload', async ({ page }) => {
        await page.goto('/activity?scope=full');

        await rangeLink(page, '30d').click();
        await expect(page).toHaveURL(/\/activity\?range=30d&scope=full$/);
        await expectScopeDrawn(page, 'full', { week: false });

        await page.reload();
        await expect(page).toHaveURL(/\/activity\?range=30d&scope=full$/);
        await expectScopeDrawn(page, 'full', { week: false });

        await rangeLink(page, '7d').click();
        await expect(page).toHaveURL(/\/activity\?range=7d&scope=full$/);
        await expectScopeDrawn(page, 'full');
    });

    test('picked raids survive a scope switch, and a pick keeps the scope', async ({ page }) => {
        await page.goto('/activity?raids=kings_fall,last_wish');

        await scopeLink(page, 'fresh').click();
        await expect(page).toHaveURL(/\/activity\?range=7d&scope=fresh&raids=kings_fall,last_wish$/);
        await expectScopeDrawn(page, 'fresh');
        expect(await drawnRaids(page)).toEqual(['kings_fall', 'last_wish']);

        // The picker is a client component: wait for hydration before opening it.
        await expect(page.getByTestId('activity-zone')).toContainText('your time zone');
        await page.getByTestId('activity-raid-picker').locator('button[aria-haspopup="listbox"]').click();
        await page.getByRole('option', { name: "Crota's End", exact: true }).click();
        await expect.poll(() => query(page)).toBe('?range=7d&scope=fresh&raids=kings_fall,last_wish,crotas_end');
        await expectScopeDrawn(page, 'fresh');
    });

    test('an unreadable or repeated scope reads as All Attempts, with no redirect', async ({ page }) => {
        for (const search of ['?scope=nonsense', '?scope=Full', '?scope=fresh&scope=full']) {
            await page.goto(`/activity${search}`);
            expect(query(page), search).toBe(search);
            await expectScopeDrawn(page, 'all');
        }
    });

    test('the default raids follow the scope', async ({ page }) => {
        for (const id of ['all', 'fresh', 'full'] as const) {
            await page.goto(id === 'all' ? '/activity' : `/activity?scope=${id}`);
            expect(await drawnRaids(page), id).toEqual([...ACTIVITY_SCOPE_TOP_RAIDS[id]]);
        }
    });

    test('a raid estimated under All Attempts has no estimate under Full Clears, and the note names it', async ({ page }) => {
        // Salvation's Edge has 9 or 10 runs in the training week, and one Full Clear, against
        // the e2e server's minimum of 6.
        const dashed = page.locator(`[data-testid="activity-raid-provisional-line"][data-raid="${RAID_A.key}"]`);
        const note = page.getByTestId('activity-no-estimate-note');

        await page.goto(`/activity?raids=${RAID_A.key}`);
        await expect(dashed).toBeAttached();
        await expect(note).toHaveCount(0);

        await scopeLink(page, 'full').click();
        await expect(page).toHaveURL(new RegExp(`scope=full&raids=${RAID_A.key}$`));
        await expect(dashed).toHaveCount(0);
        await expect(note).toHaveText(`${RAID_A.name}: too few runs in the past week to estimate, so its line stops where counting does.`);
    });

    test.describe('with JavaScript disabled', () => {
        test.use({ javaScriptEnabled: false });

        test('the scope links are plain links that load their scope', async ({ page }) => {
            await page.goto('/activity?range=7d');

            await scopeLink(page, 'full').click();
            await expect(page).toHaveURL(/\/activity\?range=7d&scope=full$/);
            await expectScopeDrawn(page, 'full');

            await scopeLink(page, 'all').click();
            await expect(page).toHaveURL(/\/activity\?range=7d$/);
            await expectScopeDrawn(page, 'all');
        });
    });

    test.describe('at phone width', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('both rows of links fit 360px, and nothing overflows under any scope', async ({ page }) => {
            await page.goto('/activity');

            for (const id of ['full', 'fresh', 'all'] as const) {
                await scopeLink(page, id).click();
                await expectScopeDrawn(page, id);
                await expectInsideViewport(page.getByTestId('activity-range'), `the range presets under ${id}`);
                await expectInsideViewport(page.getByTestId('activity-scope'), `the scope links under ${id}`);
                const range = await page.getByTestId('activity-range').boundingBox();
                const scope = await page.getByTestId('activity-scope').boundingBox();
                expect(scope!.y, 'the scope links sit on their own row, under the presets').toBeGreaterThanOrEqual(range!.y + range!.height);
                await expectNoOverflow(page);
            }
        });
    });
});
