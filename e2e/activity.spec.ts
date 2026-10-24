import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { ACTIVITY_RANGES } from '../src/app/activity/activity-range';
import { CHART_HEIGHT } from '../src/app/activity/activity-geometry';
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
 * The Provisional estimate (#196) is asserted in {@link expectRangeDrawn} for every range
 * (the dashed line's presence and size, its legend, the shade for the last 15 minutes) and
 * in its own test for what the picture means: the dashed line continues the counted one and
 * stops short of the shade. Its values are not asserted — they depend on the hour of day the
 * suite runs in, which the unit tests pin — only its structure and, at 24 hours, that the
 * seeded recent run lifts it off the baseline. Tooltips are a later ticket (#197).
 */

const WEEKDAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const WINDOW = (clock: string) => `${WEEKDAY} \\d{1,2} [A-Z][a-z]{2}, ${clock}–${clock} UTC`;

/**
 * What each preset draws in the seeded world. Vertex counts allow for the clock: the
 * window's edges move with "now", so a range's counted steps vary by one; 30 days starts
 * 6 hours after the oldest report and so holds about 157 three-hour steps of its 240.
 */
const RANGES = {
    '24h': {
        axis: 'hours',
        label: /^Raids in progress per 10 minutes over the last 24 hours, peaking at /,
        peak: new RegExp(`^Busiest 10 minutes: ${ACTIVITY_RECENT_PEAK_RAIDS} raids in progress, ${WINDOW('\\d{2}:\\d{2}')}\\.$`),
        vertices: [131, 132],
        // The estimates between the counted boundary and the 15-minute cutoff: 10 or 11 ten-minute
        // steps, and the dashed line also holds the last counted point it starts from.
        estimateVertices: [11, 12],
        estimateAlways: true,
        tooRecentLegend: 'Shaded: the last 15 to 25 minutes, too recent to estimate.',
        provisionalLegend: 'Dashed: an estimate, from 2 hours to 2 hours 10 minutes ago up to the shaded stretch.',
        beforeData: false,
    },
    '7d': {
        axis: 'days',
        label: /^Raids in progress per hour over the last 7 days, peaking at /,
        peak: new RegExp(`^Busiest hour: ${ACTIVITY_PEAK_RAIDS} raids in progress, ${WINDOW('\\d{2}:00')}\\.$`),
        vertices: [165, 166],
        // One or two hourly estimates, plus the point it starts from.
        estimateVertices: [2, 3],
        estimateAlways: true,
        tooRecentLegend: 'Shaded: the last 15 minutes to 1 hour 15 minutes, too recent to estimate.',
        provisionalLegend: 'Dashed: an estimate, from 2 to 3 hours ago up to the shaded stretch.',
        beforeData: false,
    },
    '30d': {
        axis: 'days',
        label: /^Raids in progress per 3 hours over the last 30 days, peaking at /,
        peak: new RegExp(`^Busiest 3 hours: 1 raid in progress, ${WINDOW('\\d{2}:00')}\\.$`),
        vertices: [150, 160],
        // Zero or one 3-hour estimate: the grid can leave no whole step between the counted
        // boundary and the cutoff. Present, it has the point it starts from and one more.
        estimateVertices: [2, 2],
        estimateAlways: false,
        tooRecentLegend: 'Shaded: the last 15 minutes to 3 hours 15 minutes, too recent to estimate.',
        provisionalLegend: 'Dashed: an estimate, from 2 to 5 hours ago up to the shaded stretch.',
        beforeData: true,
    },
} as const;

type RangeId = keyof typeof RANGES;

/** 15 minutes: nothing is drawn for a step younger than this (the query's cutoff, #196). */
const TOO_RECENT_SECONDS = 15 * 60;

/** The `x,y` of each vertex of a path the chart wrote (`M50,150L150,50`), in order. */
function vertices(d: string): string[] {
    return d.match(/[ML]-?[\d.]+,-?[\d.]+/g)?.map((vertex) => vertex.slice(1)) ?? [];
}

/**
 * The range control's link to a preset, found by the label the control shows for it. The
 * label equals the id today, but only by choice: a renamed label should fail here because
 * the control changed, not because the spec guessed the text.
 */
function rangeLink(page: Page, id: RangeId) {
    const { label } = ACTIVITY_RANGES.find((range) => range.id === id)!;
    return page.getByTestId('activity-range').getByRole('link', { name: label, exact: true });
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

    // One "M" and then an "L" per further vertex: the solid path has a point for every counted step
    // and none for the estimated ones.
    const d = (await page.getByTestId('activity-line').getAttribute('d')) ?? '';
    expect(d.startsWith('M'), 'the line has a starting point').toBe(true);
    const solidVertices = (d.match(/L/g) ?? []).length + 1;
    expect(solidVertices, `${id} vertex count`).toBeGreaterThanOrEqual(range.vertices[0]);
    expect(solidVertices, `${id} vertex count`).toBeLessThanOrEqual(range.vertices[1]);

    // The too-recent shade runs to the right-hand edge and is 15 minutes plus up to one step
    // wide: the line stops at the last whole step that is 15 minutes old.
    const { rangeSeconds, stepSeconds } = ACTIVITY_RANGES.find((preset) => preset.id === id)!;
    const shade = page.getByTestId('activity-too-recent');
    const x = parseFloat((await shade.getAttribute('x')) ?? '');
    const width = parseFloat((await shade.getAttribute('width')) ?? '');
    expect(x + width).toBeCloseTo(100, 6);
    expect(width, `${id} shade width`).toBeGreaterThanOrEqual((TOO_RECENT_SECONDS / rangeSeconds) * 100 - 1e-6);
    expect(width, `${id} shade width`).toBeLessThanOrEqual(((TOO_RECENT_SECONDS + stepSeconds) / rangeSeconds) * 100 + 1e-6);
    await expect(page.getByTestId('activity-too-recent-legend')).toHaveText(range.tooRecentLegend);

    // The dashed estimate: always there at 24 hours and 7 days; at 30 days the 3-hour grid
    // may leave no step to estimate, and then neither the line nor its legend is drawn.
    const dashed = page.getByTestId('activity-provisional-line');
    const dashedCount = await dashed.count();
    if (range.estimateAlways) expect(dashedCount, `${id} has an estimate`).toBe(1);
    else expect(dashedCount, `${id} has at most one estimate line`).toBeLessThanOrEqual(1);
    if (dashedCount === 1) {
        const estimateVertices = vertices((await dashed.getAttribute('d')) ?? '').length;
        expect(estimateVertices, `${id} dashed vertex count`).toBeGreaterThanOrEqual(range.estimateVertices[0]);
        expect(estimateVertices, `${id} dashed vertex count`).toBeLessThanOrEqual(range.estimateVertices[1]);
        await expect(page.getByTestId('activity-provisional-legend')).toHaveText(range.provisionalLegend);
    } else {
        await expect(page.getByTestId('activity-provisional-legend')).toHaveCount(0);
    }

    // Labels are HTML under the axis, in UTC. Hours over 24 hours, the day named at midnight;
    // days otherwise, at least six (a last midnight too near the right-hand edge is unlabelled).
    if (range.axis === 'hours') {
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

/**
 * The default chart, as the page's first visit draws it: the heading, and the 7-day chart
 * drawn from the seeded Tracker ({@link expectRangeDrawn}). Shared by the JavaScript-on,
 * JavaScript-off and phone tests, so they cannot drift apart on what "the chart is drawn"
 * means.
 */
async function expectChartDrawn(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { level: 1, name: 'Raid Activity' })).toBeVisible();
    await expectRangeDrawn(page, '7d');
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

test.describe('the Provisional estimate', () => {
    test('the dashed line continues the counted one and stops 15 minutes short of now', async ({ page }) => {
        // What the estimate means on the picture, at the two ranges that always have one: the
        // dashed line starts exactly where the solid one ends (so the line is continuous and only
        // its style changes), it is dashed in the accent colour while the counted line is solid,
        // and it ends left of the shaded last 15 minutes, which it never enters.
        for (const id of ['24h', '7d'] as const) {
            const { rangeSeconds } = ACTIVITY_RANGES.find((preset) => preset.id === id)!;
            await page.goto(`/activity?range=${id}`);
            await expectRangeDrawn(page, id);

            const solid = vertices((await page.getByTestId('activity-line').getAttribute('d')) ?? '');
            const dashed = page.getByTestId('activity-provisional-line');
            const estimate = vertices((await dashed.getAttribute('d')) ?? '');
            expect(estimate[0], `${id}: the dashed line starts on the last counted point`).toBe(solid.at(-1));

            await expect(dashed, `${id} dashed`).toHaveAttribute('stroke-dasharray', /\d/);
            await expect(dashed, `${id} colour`).toHaveAttribute('stroke', 'var(--ui-accent)');
            await expect(page.getByTestId('activity-line'), `${id} counted line`).not.toHaveAttribute('stroke-dasharray');

            // Positions are in a 1000-wide viewBox; the shade in percent. The last estimate sits
            // at a step's midpoint, so it is clear of the cutoff by half a step as well.
            const lastX = parseFloat(estimate.at(-1)!.split(',')[0]) / 10;
            const shadeX = parseFloat((await page.getByTestId('activity-too-recent').getAttribute('x')) ?? '');
            expect(lastX, `${id}: the estimate ends before the shade`).toBeLessThan(shadeX);
            expect(lastX, `${id}: nothing within 15 minutes of now`).toBeLessThanOrEqual(100 - (TOO_RECENT_SECONDS / rangeSeconds) * 100);

            await expectNoOverflow(page);
        }
    });

    test('the estimate at 24 hours rises off the baseline for the seeded recent runs', async ({ page }) => {
        // The world's runs from the last two hours (the leaderboard world's, and the 20-minute run
        // the activity seed adds) are not counted yet, so the dashed line is the only place they
        // can show: at least one estimated point sits above the chart's floor (y = 200 in the
        // 200-high viewBox). A flat estimate would mean it scaled nothing up.
        await page.goto('/activity?range=24h');

        const d = (await page.getByTestId('activity-provisional-line').getAttribute('d')) ?? '';
        const heights = vertices(d).map((vertex) => parseFloat(vertex.split(',')[1]));
        expect(Math.min(...heights), 'an estimated step above zero').toBeLessThan(CHART_HEIGHT);
    });
});

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
