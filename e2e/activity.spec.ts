import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { ACTIVITY_PEAK_RAIDS, ACTIVITY_RECENT_PEAK_RAIDS } from './support/seed-world';
import { expectInsideViewport, expectNoOverflow } from './support/viewport';

/**
 * The Raid Activity page (#194, #195): the nav link to it, the chart drawn from the seeded
 * Tracker, the chart with JavaScript off, the page at phone width, and the 24h / 7d / 30d
 * range presets held in `?range=`.
 *
 * The seed world's activity runs (`seedActivityRuns` in ./support/seed-world.ts) give the
 * chart a known peak of {@link ACTIVITY_PEAK_RAIDS} raids in one clock hour two days back,
 * so these assert the chart is drawn *from the Tracker*, not merely that an SVG exists.
 * The hour itself is not pinned: it is two days before whenever the seed ran, and the
 * spec's clock may have crossed an hour since.
 *
 * The range presets (#195) are asserted per range by {@link expectRangeDrawn}: the
 * chart's accessible name, its vertex count, the peak caption, the axis labels and both
 * shades. The seed's 24-hour peak and its oldest report (20 days back, so the 30-day chart
 * shades where its data starts) are there for these.
 *
 * Tooltips and the Provisional estimate are later tickets (#196–#197) and are not covered
 * here.
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

const WEEKDAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const WINDOW = (clock: string) => `${WEEKDAY} \\d{1,2} [A-Z][a-z]{2}, ${clock}–${clock} UTC`;

/**
 * What each preset draws in the seeded world. Vertex counts allow for the clock: the
 * window's edges move with "now", so a range's counted steps vary by one; 30 days starts
 * 6 hours after the oldest report and so holds about 157 three-hour steps of its 240.
 */
const RANGES = {
    '24h': {
        label: /^Raids in progress per 10 minutes over the last 24 hours, peaking at /,
        peak: new RegExp(`^Busiest 10 minutes: ${ACTIVITY_RECENT_PEAK_RAIDS} raids in progress, ${WINDOW('\\d{2}:\\d{2}')}\\.$`),
        vertices: [131, 132],
        // 2 hours plus up to one 10-minute step, of 24 hours.
        shadeFrom: 100 - (130 / 1440) * 100,
        legend: 'Shaded: the last 2 hours to 2 hours 10 minutes, not yet counted.',
        beforeData: false,
    },
    '7d': {
        label: /^Raids in progress per hour over the last 7 days, peaking at /,
        peak: new RegExp(`^Busiest hour: ${ACTIVITY_PEAK_RAIDS} raids in progress, ${WINDOW('\\d{2}:00')}\\.$`),
        vertices: [165, 166],
        shadeFrom: 98.2,
        legend: 'Shaded: the last 2 to 3 hours, not yet counted.',
        beforeData: false,
    },
    '30d': {
        label: /^Raids in progress per 3 hours over the last 30 days, peaking at /,
        peak: new RegExp(`^Busiest 3 hours: 1 raid in progress, ${WINDOW('\\d{2}:00')}\\.$`),
        vertices: [150, 160],
        // 2 hours plus up to one 3-hour step, of 720 hours.
        shadeFrom: 100 - (5 / 720) * 100,
        legend: 'Shaded: the last 2 to 5 hours, not yet counted.',
        beforeData: true,
    },
} as const;

type RangeId = keyof typeof RANGES;

/** The range control's link to a preset. */
function rangeLink(page: Page, id: RangeId) {
    return page.getByTestId('activity-range').getByRole('link', { name: id, exact: true });
}

/**
 * The checks that the chart on screen is `id`'s: the control marks it and only it, and the
 * chart's name, line, caption, axis labels and shades are that range's. Drawn from the
 * seeded Tracker, so a control that changed the URL without changing the query fails here.
 */
async function expectRangeDrawn(page: Page, id: RangeId): Promise<void> {
    const range = RANGES[id];
    for (const other of Object.keys(RANGES) as RangeId[]) {
        if (other === id) await expect(rangeLink(page, other)).toHaveAttribute('aria-current', 'page');
        else await expect(rangeLink(page, other), `${other} is not marked`).not.toHaveAttribute('aria-current');
    }

    const chart = page.getByTestId('activity-chart');
    await expect(chart.getByRole('img', { name: range.label })).toBeVisible();
    await expect(page.getByTestId('activity-peak')).toHaveText(range.peak);

    const d = (await page.getByTestId('activity-line').getAttribute('d')) ?? '';
    const vertices = (d.match(/L/g) ?? []).length + 1;
    expect(vertices, `${id} vertex count`).toBeGreaterThanOrEqual(range.vertices[0]);
    expect(vertices, `${id} vertex count`).toBeLessThanOrEqual(range.vertices[1]);

    const shade = page.getByTestId('activity-not-yet-counted');
    expect(parseFloat((await shade.getAttribute('x')) ?? '')).toBeGreaterThan(range.shadeFrom);
    await expect(page.getByTestId('activity-not-yet-counted-legend')).toHaveText(range.legend);

    if (id === '24h') {
        // Hours under the axis, and the day named at midnight.
        expect(await chart.getByText(/^\d{2}:00$/).count()).toBeGreaterThanOrEqual(4);
    } else {
        expect(await chart.getByText(new RegExp(`^${WEEKDAY} \\d{1,2}$`)).count()).toBeGreaterThanOrEqual(6);
    }

    const before = page.getByTestId('activity-before-data');
    if (range.beforeData) {
        // The oldest report started 20 days before the seed's clock hour, and counting starts
        // at the first 3-hour step at least 6 hours after it: 245 to 249 hours into the
        // 720-hour window, give or take the minutes since seeding. 34.0% to 34.6%.
        expect(parseFloat((await before.getAttribute('x')) ?? '')).toBe(0);
        const width = parseFloat((await before.getAttribute('width')) ?? '');
        expect(width).toBeGreaterThan(33.5);
        expect(width).toBeLessThan(35);
        await expect(page.getByTestId('activity-before-data-legend')).toHaveText(
            new RegExp(`^Shaded at the left: no data before ${WEEKDAY} \\d{1,2} [A-Z][a-z]{2}, \\d{2}:00 UTC\\. Older raid reports are no longer stored\\.$`)
        );
    } else {
        await expect(before).toHaveCount(0);
        await expect(page.getByTestId('activity-before-data-legend')).toHaveCount(0);
    }
}

test.describe('the range presets', () => {
    test('each preset sets ?range= and redraws the chart for its range', async ({ page }) => {
        // The reader switches between 24h, 7d and 30d, and the URL says which, so the choice
        // survives a reload and a shared link. 7d is clicked last so it too is shown to set
        // `?range=`, not left as the bare default URL.
        await page.goto('/activity');
        await expectRangeDrawn(page, '7d');

        for (const id of ['24h', '30d', '7d'] as const) {
            await rangeLink(page, id).click();
            await expect(page).toHaveURL(new RegExp(`/activity\\?range=${id}$`));
            await expectRangeDrawn(page, id);
        }
    });

    test('a reload keeps the range', async ({ page }) => {
        await page.goto('/activity');
        await rangeLink(page, '30d').click();
        await expect(page).toHaveURL(/\?range=30d$/);

        await page.reload();

        await expect(page).toHaveURL(/\?range=30d$/);
        await expectRangeDrawn(page, '30d');
    });

    test('an unreadable range shows the 7-day chart', async ({ page }) => {
        // A mangled shared link still shows a chart: the default one.
        await page.goto('/activity?range=nonsense');

        await expectRangeDrawn(page, '7d');
    });

    test.describe('with JavaScript disabled', () => {
        test.use({ javaScriptEnabled: false });

        test('the presets are plain links that load their range', async ({ page }) => {
            // With no client navigation, each preset is still a link the browser follows.
            await page.goto('/activity');

            await rangeLink(page, '24h').click();

            await expect(page).toHaveURL(/\?range=24h$/);
            await expectRangeDrawn(page, '24h');
        });
    });

    test.describe('at phone width', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('the control fits 360px, and nothing overflows on any range', async ({ page }) => {
            await page.goto('/activity');
            await expectInsideViewport(page.getByTestId('activity-range'), 'the range control');

            for (const id of ['30d', '24h'] as const) {
                await rangeLink(page, id).click();
                await expect(page).toHaveURL(new RegExp(`\\?range=${id}$`));
                await expectRangeDrawn(page, id);
                await expectInsideViewport(page.getByTestId('activity-range'), `the range control on ${id}`);
                await expectNoOverflow(page);
            }
        });
    });
});
