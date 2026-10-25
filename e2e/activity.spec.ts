import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { ACTIVITY_RANGES } from '../src/app/activity/activity-range';
import { CHART_HEIGHT, CHART_WIDTH, TOO_RECENT_AGE_SECONDS } from '../src/app/activity/activity-geometry';
import { ACTIVITY_PEAK_RAIDS, ACTIVITY_RECENT_PEAK_RAIDS } from './support/seed-world';
import { boxOf, expectInsideViewport, expectNoOverflow } from './support/viewport';

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
 * seeded recent run lifts it off the baseline.
 *
 * The tooltips and local time (#197) are asserted at the end of the file. Every test here runs
 * in a pinned UTC zone ({@link test.use} below) so a developer's own zone cannot change what
 * the JavaScript-on tests read; the local-time tests pin a zone of their own, Asia/Kathmandu
 * (UTC+5:45), whose quarter-hour offset puts every 3-hour mark a quarter past on the UTC clock
 * and so cannot be mistaken for the UTC chart. What they expect is worked out with `Intl`,
 * which shares nothing with the app's formatter.
 */

test.use({ timezoneId: 'UTC' });

const WEEKDAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const WINDOW = (clock: string, zone: Zone) => `${WEEKDAY} \\d{1,2} [A-Z][a-z]{2}, ${clock}–${clock}${zone === 'utc' ? ' UTC' : ''}`;

/**
 * Whether a label is in the reader's zone (JavaScript on) or in UTC and says so (the server's
 * render, which is all a reader without scripts gets).
 */
type Zone = 'local' | 'utc';

/**
 * What each preset draws in the seeded world. Vertex counts allow for the clock: the
 * window's edges move with "now", so a range's counted steps vary by one; 30 days starts
 * 6 hours after the oldest report and so holds about 157 three-hour steps of its 240.
 */
const RANGES = {
    '24h': {
        axis: 'hours',
        label: /^Raids in progress per 10 minutes over the last 24 hours, peaking at /,
        peak: (zone: Zone) => new RegExp(`^Busiest 10 minutes: ${ACTIVITY_RECENT_PEAK_RAIDS} raids in progress, ${WINDOW('\\d{2}:\\d{2}', zone)}\\.$`),
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
        peak: (zone: Zone) => new RegExp(`^Busiest hour: ${ACTIVITY_PEAK_RAIDS} raids in progress, ${WINDOW('\\d{2}:00', zone)}\\.$`),
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
        peak: (zone: Zone) => new RegExp(`^Busiest 3 hours: 1 raid in progress, ${WINDOW('\\d{2}:00', zone)}\\.$`),
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
async function expectRangeDrawn(page: Page, id: RangeId, zone: Zone = 'local'): Promise<void> {
    const range = RANGES[id];
    for (const other of Object.keys(RANGES) as RangeId[]) {
        if (other === id) await expect(rangeLink(page, other)).toHaveAttribute('aria-current', 'page');
        else await expect(rangeLink(page, other), `${other} is not marked`).not.toHaveAttribute('aria-current');
    }

    const chart = page.getByTestId('activity-chart');
    await expect(chart.getByRole('img', { name: range.label })).toBeVisible();
    await expect(page.getByTestId('activity-peak')).toHaveText(range.peak(zone));

    // The solid path has a point for every counted step and none for the estimated ones.
    const d = (await page.getByTestId('activity-line').getAttribute('d')) ?? '';
    expect(d.startsWith('M'), 'the line has a starting point').toBe(true);
    const solidVertices = vertices(d).length;
    expect(solidVertices, `${id} vertex count`).toBeGreaterThanOrEqual(range.vertices[0]);
    expect(solidVertices, `${id} vertex count`).toBeLessThanOrEqual(range.vertices[1]);

    // The too-recent shade runs to the right-hand edge and is 15 minutes plus up to one step
    // wide: the line stops at the last whole step that is 15 minutes old.
    const { rangeSeconds, stepSeconds } = ACTIVITY_RANGES.find((preset) => preset.id === id)!;
    const shade = page.getByTestId('activity-too-recent');
    const x = parseFloat((await shade.getAttribute('x')) ?? '');
    const width = parseFloat((await shade.getAttribute('width')) ?? '');
    expect(x + width).toBeCloseTo(100, 6);
    expect(width, `${id} shade width`).toBeGreaterThanOrEqual((TOO_RECENT_AGE_SECONDS / rangeSeconds) * 100 - 1e-6);
    expect(width, `${id} shade width`).toBeLessThanOrEqual(((TOO_RECENT_AGE_SECONDS + stepSeconds) / rangeSeconds) * 100 + 1e-6);
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

    // Labels are HTML under the axis. Hours over 24 hours, the day named at midnight;
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
            new RegExp(`^Shaded at the left: no data before ${WEEKDAY} \\d{1,2} [A-Z][a-z]{2}, \\d{2}:00${zone === 'utc' ? ' UTC' : ''}\\. Older raid reports are no longer stored\\.$`)
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
async function expectChartDrawn(page: Page, zone: Zone = 'local'): Promise<void> {
    await expect(page.getByRole('heading', { level: 1, name: 'Raid Activity' })).toBeVisible();
    await expectRangeDrawn(page, '7d', zone);
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
            // The chart is server-rendered SVG, and the client step that moves it into the
            // reader's zone does not run, so a reader without scripts gets the same picture
            // — and the copy says it is UTC.
            await page.goto('/activity');

            await expectChartDrawn(page, 'utc');
            await expect(page.getByText('Times are UTC.', { exact: false })).toBeVisible();
            await expectTicksOn(page, 'UTC');
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
            expect(lastX, `${id}: nothing within 15 minutes of now`).toBeLessThanOrEqual(100 - (TOO_RECENT_AGE_SECONDS / rangeSeconds) * 100);

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
            await expectRangeDrawn(page, '24h', 'utc');
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

// ---------------------------------------------------------------------------------------
// Tooltips and local time (#197)
// ---------------------------------------------------------------------------------------

/**
 * A tooltip: the average, then the step's window — `Wed 21 Oct, 12:00–13:00` on the reader's
 * clock, the end naming its weekday when it falls on the next day.
 */
const TOOLTIP = new RegExp(
    `^[\\d,]+ average raids? in progress, ${WEEKDAY} \\d{1,2} [A-Z][a-z]{2}, \\d{2}:\\d{2}–(${WEEKDAY} )?\\d{2}:\\d{2}`
);
const ESTIMATE = / · estimate, still arriving$/;

/** The chart's graphic, the part src/components/chart/ChartHover.tsx puts the pointer over. */
function chartSvg(page: Page) {
    return page.getByTestId('activity-chart').locator('[data-timeline-part="total"]');
}

function tooltip(page: Page) {
    return page.getByTestId('activity-tooltip');
}

/** How far across the chart each vertex of a path is, from 0 to 1. */
function fractions(d: string): number[] {
    return vertices(d).map((vertex) => parseFloat(vertex.split(',')[0]) / CHART_WIDTH);
}

async function solidFractions(page: Page): Promise<number[]> {
    return fractions((await page.getByTestId('activity-line').getAttribute('d')) ?? '');
}

async function dashedFractions(page: Page): Promise<number[]> {
    return fractions((await page.getByTestId('activity-provisional-line').getAttribute('d')) ?? '');
}

/** The vertex of the counted line with the most raids in progress, as a fraction across. */
async function peakFraction(page: Page): Promise<number> {
    const d = (await page.getByTestId('activity-line').getAttribute('d')) ?? '';
    const points = vertices(d).map((vertex) => vertex.split(',').map(parseFloat));
    // Heights are measured down from the top: the peak is the smallest y, the earliest on a tie.
    const peak = points.reduce((best, point) => (point[1] < best[1] ? point : best));
    return peak[0] / CHART_WIDTH;
}

/** Points the mouse `fraction` of the way across the chart, halfway up. */
async function hoverAt(page: Page, fraction: number): Promise<void> {
    const svg = chartSvg(page);
    const box = await boxOf(svg);
    await svg.hover({ position: { x: box.width * fraction, y: box.height / 2 } });
}

/** {@link hoverAt} for a finger. */
async function tapAt(page: Page, fraction: number): Promise<void> {
    const svg = chartSvg(page);
    const box = await boxOf(svg);
    await svg.tap({ position: { x: box.width * fraction, y: box.height / 2 } });
}

/**
 * Waits until the client step has run: the intro line names the reader's zone only once the
 * page has hydrated, and the tooltips and the local ticks come with it. A spec that points
 * the mouse first would otherwise race the script.
 */
async function waitForClientStep(page: Page): Promise<void> {
    await expect(page.getByTestId('activity-zone')).toContainText('your time zone');
}

/**
 * Every tick label sits where the zone's clock says it is. The label's own position gives
 * the instant it marks — the figure's window and the label's percentage across it — and
 * `Intl` says what the zone's clock reads then: `HH:MM` for an hour mark, `Sat 17` at
 * exactly midnight. A gridline sits under each label (to the 1e-3 % the browser keeps when it
 * writes a style back). Shares nothing with the app's formatter.
 */
async function expectTicksOn(page: Page, timeZone: string): Promise<void> {
    const chart = page.getByTestId('activity-chart');
    const from = Number(await chart.getAttribute('data-window-from'));
    const to = Number(await chart.getAttribute('data-window-to'));
    const labels = await page
        .getByTestId('activity-x-labels')
        .locator('span')
        .evaluateAll((spans) =>
            spans.map((span) => ({
                text: span.textContent ?? '',
                left: parseFloat(/left:\s*([\d.]+)%/.exec(span.getAttribute('style') ?? '')?.[1] ?? 'NaN'),
            }))
        );
    const gridlines = await chartSvg(page)
        .locator('line[x1$="%"]')
        .evaluateAll((lines) => lines.map((line) => parseFloat(line.getAttribute('x1') ?? 'NaN')));
    expect(labels.length, 'the axis has labels').toBeGreaterThanOrEqual(4);

    const clock = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    for (const label of labels) {
        const at = Math.round((from + (label.left / 100) * (to - from)) / 60) * 60;
        const parts = Object.fromEntries(clock.formatToParts(new Date(at * 1000)).map((part) => [part.type, part.value]));
        const time = `${parts.hour}:${parts.minute}`;
        if (/^\d{2}:\d{2}$/.test(label.text)) expect(label.text, `the label at ${label.left}%`).toBe(time);
        else {
            expect(label.text, `the label at ${label.left}%`).toBe(`${parts.weekday} ${parts.day}`);
            expect(time, `${label.text} marks a midnight`).toBe('00:00');
        }
        expect(gridlines.some((line) => Math.abs(line - label.left) < 1e-3), `a gridline under ${label.text}`).toBe(true);
    }
}

/** A tooltip's window as minutes since midnight: its start and its end. */
function windowMinutes(text: string): [number, number] {
    const [, start, end] = /(\d{2}:\d{2})–(?:[A-Z][a-z]{2} )?(\d{2}:\d{2})/.exec(text)!;
    const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
    return [minutes(start), minutes(end)];
}

test.describe('the tooltips', () => {
    test('hovering a counted step shows its average and its window', async ({ page }) => {
        await page.goto('/activity');
        await waitForClientStep(page);

        // The busiest hour is the seeded one: its tooltip repeats the caption's number and window.
        await hoverAt(page, await peakFraction(page));
        const caption = (await page.getByTestId('activity-peak').textContent()) ?? '';
        const window = /in progress, (.+)\.$/.exec(caption)![1];
        await expect(tooltip(page)).toHaveText(`${ACTIVITY_PEAK_RAIDS} average raids in progress, ${window}`);

        // The last counted step is a count, not an estimate.
        await hoverAt(page, (await solidFractions(page)).at(-1)!);
        await expect(tooltip(page)).toHaveText(TOOLTIP);
        await expect(tooltip(page)).not.toHaveText(ESTIMATE);

        await page.mouse.move(0, 0);
        await expect(tooltip(page)).toHaveCount(0);
    });

    test('hovering the dashed line says the step is an estimate, still arriving', async ({ page }) => {
        await page.goto('/activity?range=24h');
        await waitForClientStep(page);
        const [lastCounted, firstEstimate] = await dashedFractions(page);

        await hoverAt(page, firstEstimate);
        await expect(tooltip(page)).toHaveText(new RegExp(`${TOOLTIP.source}${ESTIMATE.source}`));
        const [start, end] = windowMinutes((await tooltip(page).textContent()) ?? '');
        expect((end - start + 1440) % 1440, 'a 10-minute step').toBe(10);

        // The dashed line starts on the last counted point, and that step is counted.
        await hoverAt(page, lastCounted);
        await expect(tooltip(page)).toHaveText(TOOLTIP);
        await expect(tooltip(page)).not.toHaveText(ESTIMATE);
    });

    test('a shaded span has no tooltip, and moving into one hides it', async ({ page }) => {
        await page.goto('/activity?range=30d');
        await waitForClientStep(page);

        await hoverAt(page, (await solidFractions(page))[3]);
        await expect(tooltip(page)).toBeVisible();

        // The span before the data starts, shaded at the left.
        const before = page.getByTestId('activity-before-data');
        const beforeWidth = parseFloat((await before.getAttribute('width')) ?? '');
        await hoverAt(page, beforeWidth / 2 / 100);
        await expect(tooltip(page)).toHaveCount(0);

        // The last 15 minutes or so, too recent to estimate, shaded at the right.
        await hoverAt(page, (await solidFractions(page))[3]);
        await expect(tooltip(page)).toBeVisible();
        const shade = page.getByTestId('activity-too-recent');
        const shadeX = parseFloat((await shade.getAttribute('x')) ?? '');
        const shadeWidth = parseFloat((await shade.getAttribute('width')) ?? '');
        await hoverAt(page, (shadeX + shadeWidth / 2) / 100);
        await expect(tooltip(page)).toHaveCount(0);
    });

    test.describe('on a touch screen', () => {
        test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

        test('a tap shows the tooltip, a tap elsewhere dismisses it, and nothing overflows', async ({ page }) => {
            // The widest tooltip texts are the 10-minute and 3-hour ranges'; the overflow
            // check comes once the tooltip is open, which is when something new is on screen.
            for (const id of ['24h', '30d'] as const) {
                await page.goto(`/activity?range=${id}`);
                await waitForClientStep(page);
                const counted = await solidFractions(page);

                await tapAt(page, counted[Math.floor(counted.length / 2)]);
                await expect(tooltip(page)).toHaveText(TOOLTIP);
                await expectInsideViewport(tooltip(page), `the tooltip on ${id}`);
                await expectNoOverflow(page);

                // A tap on the chart moves it rather than closing it.
                const first = await tooltip(page).textContent();
                await tapAt(page, counted[Math.floor(counted.length / 3)]);
                await expect(tooltip(page)).not.toHaveText(first ?? '');
                await expectNoOverflow(page);

                await page.getByRole('heading', { level: 1, name: 'Raid Activity' }).tap();
                await expect(tooltip(page)).toHaveCount(0);
            }
        });

        test('a tap on the dashed line says the step is an estimate', async ({ page }) => {
            await page.goto('/activity?range=24h');
            await waitForClientStep(page);

            await tapAt(page, (await dashedFractions(page))[1]);

            await expect(tooltip(page)).toHaveText(new RegExp(`${TOOLTIP.source}${ESTIMATE.source}`));
            await expectInsideViewport(tooltip(page), 'the estimate tooltip');
            await expectNoOverflow(page);
        });
    });

    test.describe('on a short touch screen', () => {
        test.use({ viewport: { width: 360, height: 480 }, hasTouch: true });

        test('a finger swiped across the chart scrolls the page and opens no tooltip', async ({ page }) => {
            await page.goto('/activity');
            await waitForClientStep(page);
            const svg = chartSvg(page);
            await svg.scrollIntoViewIfNeeded();
            const box = await boxOf(svg);
            const scrolledBefore = await page.evaluate(() => window.scrollY);

            // A real touch gesture through Chromium's input pipeline, as the /gos10k timeline's
            // spec sends it: Playwright's own touch API only taps.
            const session = await page.context().newCDPSession(page);
            const x = box.x + box.width * 0.8;
            const y = box.y + box.height / 2;
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let step = 1; step <= 10; step += 1) {
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: x - step * 4, y: y - step * 12 }],
                });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolledBefore);
            await expect(tooltip(page)).toHaveCount(0);
        });
    });
});

test.describe('in the reader\'s time zone', () => {
    test.describe('in Kathmandu, UTC+5:45', () => {
        test.use({ timezoneId: 'Asia/Kathmandu' });

        test('the gridlines and labels fall on the reader\'s clock at every range, and the page says whose', async ({ page }) => {
            for (const id of ['24h', '7d', '30d'] as const) {
                await page.goto(`/activity?range=${id}`);
                await waitForClientStep(page);

                // Chromium spells the zone by its older name, Asia/Katmandu.
                await expect(page.getByTestId('activity-zone')).toHaveText(/^Times are in your time zone \(Asia\/Kath?mandu\)\.$/);
                await expectTicksOn(page, 'Asia/Kathmandu');
            }
        });

        test('a tooltip and the caption are 5 hours 45 minutes ahead of the UTC the chart is named in', async ({ page }) => {
            await page.goto('/activity');
            await waitForClientStep(page);

            // The accessible name is read before any script runs, and stays UTC.
            const name = (await chartSvg(page).getAttribute('aria-label')) ?? '';
            expect(name).toMatch(/ UTC$/);
            const [utcStart, utcEnd] = windowMinutes(name);

            await hoverAt(page, await peakFraction(page));
            const [localStart, localEnd] = windowMinutes((await tooltip(page).textContent()) ?? '');
            expect((localStart - utcStart + 1440) % 1440).toBe(345);
            expect((localEnd - utcEnd + 1440) % 1440).toBe(345);
            await expect(tooltip(page)).not.toContainText('UTC');

            // The caption names the same window on the same clock, with no UTC in it.
            const caption = (await page.getByTestId('activity-peak').textContent()) ?? '';
            expect(windowMinutes(caption)).toEqual([localStart, localEnd]);
            expect(caption).not.toContain('UTC');
        });

        test('the 30-day legend names where the data starts on the reader\'s clock', async ({ page }) => {
            await page.goto('/activity?range=30d');
            await waitForClientStep(page);

            // Counting starts on a 3-hour boundary in UTC, a quarter to the hour in Kathmandu.
            const legend = page.getByTestId('activity-before-data-legend');
            await expect(legend).toHaveText(/^Shaded at the left: no data before [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{2}:45\./);
            await expect(legend).not.toContainText('UTC');
        });
    });

    test.describe('where the browser names no zone, in Kathmandu', () => {
        test.use({ timezoneId: 'Asia/Kathmandu' });

        // A browser that names no zone gets "Times are UTC.", so every label has to be UTC to
        // match it, even though the browser's offset is still Kathmandu's.
        test.beforeEach(async ({ page }) => {
            await page.addInitScript(() => {
                const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
                Intl.DateTimeFormat.prototype.resolvedOptions = function () {
                    return { ...resolvedOptions.call(this), timeZone: '' };
                };
            });
        });

        test('every label is UTC and says so, as the intro does', async ({ page }) => {
            await page.goto('/activity?range=24h');

            // A tooltip shows only once the page has hydrated, so what follows is the client's render.
            await hoverAt(page, await peakFraction(page));
            await expect(tooltip(page)).toHaveText(new RegExp(`${TOOLTIP.source} UTC$`));

            await expect(page.getByTestId('activity-zone')).toHaveText('Times are UTC.');
            await expect(page.getByTestId('activity-peak')).toContainText(' UTC.');
            await expectTicksOn(page, 'UTC');
        });
    });

    test.describe('with JavaScript disabled, in Kathmandu', () => {
        test.use({ javaScriptEnabled: false, timezoneId: 'Asia/Kathmandu' });

        test('the labels are still UTC, and say so', async ({ page }) => {
            await page.goto('/activity?range=24h');

            await expect(page.getByTestId('activity-zone')).toHaveText('Times are UTC.');
            await expect(page.getByTestId('activity-peak')).toContainText(' UTC.');
            await expectTicksOn(page, 'UTC');
        });
    });
});
