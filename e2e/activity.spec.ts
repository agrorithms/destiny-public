import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { ACTIVITY_PEAK_RAIDS } from './support/seed-world';
import { expectInsideViewport, expectNoOverflow } from './support/viewport';

/**
 * The Raid Activity page (#194): the nav link to it, the chart drawn from the seeded
 * Tracker, the chart with JavaScript off, and the page at phone width.
 *
 * The seed world's activity runs (`seedActivityRuns` in ./support/seed-world.ts) give the
 * chart a known peak of {@link ACTIVITY_PEAK_RAIDS} raids in one clock hour two days back,
 * so these assert the chart is drawn *from the Tracker*, not merely that an SVG exists.
 * The hour itself is not pinned: it is two days before whenever the seed ran, and the
 * spec's clock may have crossed an hour since.
 *
 * Tooltips, range presets and the Provisional estimate are later tickets (#195–#197) and
 * are not covered here.
 */

/** Every step the chart can draw over 7 days at 1-hour steps, the newest two hours aside. */
const MIN_COUNTED_STEPS = 165;

/** The caption's sentence for the busiest hour, its UTC window spelled out. */
const PEAK_CAPTION = new RegExp(
    `^Busiest hour: ${ACTIVITY_PEAK_RAIDS} raids in progress, (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d{1,2} [A-Z][a-z]{2}, \\d{2}:00–\\d{2}:00 UTC\\.$`
);

/**
 * The checks that the chart drew from the seeded Tracker: one line with a vertex per
 * counted hour, the seeded peak in the caption, the shade at the right-hand edge, and day
 * labels under the axis. Shared by the JavaScript-on and JavaScript-off tests, so the two
 * cannot drift apart on what "the chart is drawn" means.
 */
async function expectChartDrawn(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { level: 1, name: 'Raid Activity' })).toBeVisible();

    const chart = page.getByTestId('activity-chart');
    await expect(chart.getByRole('img', { name: new RegExp(`^Raids in progress per hour over the last 7 days, peaking at ${ACTIVITY_PEAK_RAIDS} raids in progress`) })).toBeVisible();

    // One "M" and then an "L" per further vertex: the path has a point for every hour.
    const d = (await page.getByTestId('activity-line').getAttribute('d')) ?? '';
    expect(d.startsWith('M'), 'the line has a starting point').toBe(true);
    expect((d.match(/L/g) ?? []).length + 1).toBeGreaterThanOrEqual(MIN_COUNTED_STEPS);

    await expect(page.getByTestId('activity-peak')).toHaveText(PEAK_CAPTION);

    // The not-yet-counted shade starts where the last counted hour ends, two to three hours
    // before now of 168, so past 98.2% of the way across, and runs to the right-hand edge.
    const shade = page.getByTestId('activity-not-yet-counted');
    const x = parseFloat((await shade.getAttribute('x')) ?? '');
    const width = parseFloat((await shade.getAttribute('width')) ?? '');
    expect(x).toBeGreaterThan(98.2);
    expect(x + width).toBeCloseTo(100, 6);

    // Day labels are HTML under the axis, in UTC: a 7-day window holds at least six (the
    // seventh is dropped when the last midnight is too near the right-hand edge).
    const dayLabels = await chart.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}$/).count();
    expect(dayLabels).toBeGreaterThanOrEqual(6);
}

test.describe('the Raid Activity page', () => {
    test('the nav links to it beside Leaderboard and Active Sessions', async ({ page }) => {
        await page.goto('/leaderboard');
        const nav = page.getByRole('navigation');
        await expect(nav.getByRole('link', { name: 'Leaderboard', exact: true })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Active Sessions', exact: true })).toBeVisible();

        await nav.getByRole('link', { name: 'Activity', exact: true }).click();

        await expect(page).toHaveURL(/\/activity$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Raid Activity' })).toBeVisible();
    });

    test('draws the total Raids in Progress line from the seeded Tracker', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

        await page.goto('/activity');

        await expectChartDrawn(page);
        expect(consoleErrors).toEqual([]);
    });

    test.describe('with JavaScript disabled', () => {
        test.use({ javaScriptEnabled: false });

        test('still draws the chart, labelled in UTC', async ({ page }) => {
            // The chart is server-rendered SVG with no client step in this ticket, so a
            // reader without scripts gets the same picture — and the copy says it is UTC.
            await page.goto('/activity');

            await expectChartDrawn(page);
            await expect(page.getByText('Times are UTC.', { exact: false })).toBeVisible();
        });
    });

    test.describe('at phone width', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('the nav link and the chart fit 360px with nothing overflowing', async ({ page }) => {
            await page.goto('/activity');

            const link = page.getByRole('navigation').getByRole('link', { name: 'Activity', exact: true });
            await expect(link).toBeVisible();
            await expectInsideViewport(link, 'the Activity nav link');
            await expectInsideViewport(page.getByTestId('activity-chart'), 'the chart');
            await expectChartDrawn(page);
            await expectNoOverflow(page);
        });
    });
});
