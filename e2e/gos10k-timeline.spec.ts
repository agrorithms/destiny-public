import type { Locator, Page } from '@playwright/test';
import type { TimelinePart } from '../src/app/gos10k/timeline-geometry';
import { expect, test } from './support/test-fixtures';
import { boxOf, expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The timeline (#88, #113) — the half of it that only a browser can see.
 *
 * **This file is #80's decision 4, and it supersedes #88's own criterion.** That
 * criterion — "browser-only behaviour is verified by hand and *recorded* as unverified
 * by automated tests" — was written when the Archive had no harness at all. #96 built
 * one, and #80 names the timeline's shading as "the item with real regression risk", so
 * the shading is asserted here rather than left as tracked debt.
 *
 * **#113 changed the geometry this file asserts.** Under a range the main chart now zooms
 * to the range, and the shading moved to a whole-Archive overview strip underneath it —
 * one band, on the strip, where #88 had two, one over each chart. The strip shows only
 * while a range is active.
 *
 * **Assertion style: structural, and only about what no other seam can see.** The
 * buckets, their counts and the line's Clear Numbers are arithmetic over the fixture
 * Archive, asserted in Vitest (tests/db/archive-timeline.test.ts); the band's position
 * and the zoomed axis's labels are asserted in Vitest too
 * (src/app/gos10k/timeline-geometry.test.ts). What is left is what only a rendered page
 * can get wrong: which parts appear under which URL, whether the band lands inside the
 * strip it belongs to, and whether any of it fits a phone.
 *
 * **#114 added hover tooltips** on the main chart — the page's first client JavaScript —
 * and the last block asserts them. What a tooltip *says* is Vitest's
 * (src/app/gos10k/timeline-tooltips.test.ts, and tests/db/archive-timeline.test.ts over
 * the real reads); here it is only which half of the chart answered, whether the line and
 * the bar beneath it name the same bucket, whether a tap works, whether the box fits a
 * phone, and whether the chart still draws with JavaScript off. Tooltip text is matched
 * by shape, never by figure, under the same rule as below.
 *
 * **#115 added the drag** that sets the range, and the final block asserts it. Its dates
 * are the one place this file names figures: which dates a drag writes *is* the behaviour,
 * so each is an outer bucket edge on the fixture's own axis, spelt out beside the spec that
 * expects it. The arithmetic behind them is Vitest's (dragDates() in
 * src/app/gos10k/timeline-geometry.test.ts).
 *
 * Every ranged spec navigates straight to a ranged URL rather than through the form: the
 * form sits behind "Change range" below `xl`, and the timeline is above the tabs, so a
 * URL is the whole of what these specs need. No counts, no dates, no durations, per the
 * rule #91 and #92 settled on.
 */

/** February 2022 — clears 103–143, the window every other Archive test filters on. Days. */
const FEBRUARY_2022 = '/gos10k?clearFrom=103&clearTo=143';
/** 12 January to 3 May 2022: weeks, whose month labels are the widest on any axis. */
const WEEKS = '/gos10k?from=2022-01-12&to=2022-05-03';
/** 15 July 2020 to 2 August 2022: over two years, so months. */
const MONTHS = '/gos10k?from=2020-07-15&to=2022-08-02';
/** 2 to 5 April 2022: nine Runs, not one of them a Full Clear. */
const NO_CLEARS = '/gos10k?from=2022-04-02&to=2022-04-05';

test.describe('the timeline', () => {
    test('shows the whole Archive with no overview strip and no band when no range is active', async ({
        page,
    }) => {
        await page.goto('/gos10k');

        await expect(page.getByTestId('archive-timeline')).toBeVisible();
        // Unfiltered, the chart already is the whole Archive; a strip would repeat it,
        // and a band covering the whole chart would read as a selection.
        await expect(page.getByTestId('archive-timeline-overview')).toHaveCount(0);
        await expect(page.getByTestId('archive-timeline-band')).toHaveCount(0);
    });

    test('zooms to a range, and shades that range on the overview strip alone', async ({ page }) => {
        await page.goto(FEBRUARY_2022);

        const zoomed = page.getByTestId('archive-timeline-zoomed');
        const overview = page.getByTestId('archive-timeline-overview');
        const bands = page.getByTestId('archive-timeline-band');

        await expect(zoomed).toBeVisible();
        await expect(overview).toBeVisible();
        // One band, and it is the strip's: the zoomed chart *is* the range, so shading it
        // would shade the whole chart — the reading the unfiltered page avoids.
        await expect(bands).toHaveCount(1);
        await expect(overview.getByTestId('archive-timeline-band')).toHaveCount(1);

        // Below the zoomed chart rather than beside or above it: the strip is context for
        // the chart, read after it.
        const [chartBox, stripBox, bandBox] = await Promise.all([
            boxOf(zoomed),
            boxOf(overview),
            boxOf(bands.first()),
        ]);
        expect(stripBox.y).toBeGreaterThanOrEqual(chartBox.y + chartBox.height - 1);

        // A band rather than the whole strip — one month of six years. A shading bug
        // that painted everything would satisfy every assertion above.
        expect(bandBox.width).toBeGreaterThan(0);
        expect(bandBox.width).toBeLessThan(stripBox.width / 4);
        expect(bandBox.x).toBeGreaterThanOrEqual(stripBox.x - 1);
        expect(bandBox.x + bandBox.width).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1);
    });

    test('says so in words when the range holds Runs but no Full Clears', async ({ page }) => {
        await page.goto(NO_CLEARS);

        // Not an empty chart: a flat line over no bars renders perfectly and reads as a
        // page that broke. The strip still shows where the range sits in the Archive.
        await expect(page.getByTestId('archive-timeline-no-clears')).toBeVisible();
        await expect(page.getByTestId('archive-timeline-zoomed')).toHaveCount(0);
        await expect(page.getByTestId('archive-timeline-overview')).toBeVisible();
        await expect(page.getByTestId('archive-timeline-band')).toHaveCount(1);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the timeline inside a 360px viewport with the band still visible', async ({
            page,
        }) => {
            await page.goto(FEBRUARY_2022);

            const timeline = page.getByTestId('archive-timeline');
            await expect(timeline).toBeVisible();

            // The chart's own box first: a full-bleed SVG under a row of absolutely
            // placed labels is exactly the shape that scrolls inside its container while
            // the page measures clean.
            await expectNoElementOverflow(timeline, 'the timeline');
            await expectNoHorizontalPageOverflow(page);

            // "The shaded range is still identifiable": the reason the band has a
            // one-month minimum width. A day of six years is a third of a pixel here;
            // three is the least that reads as a band at all.
            const band = await boxOf(page.getByTestId('archive-timeline-band'));
            expect(band.width).toBeGreaterThanOrEqual(3);
        });

        test('keeps every bucket size\'s axis labels inside a 360px viewport', async ({ page }) => {
            // Days, weeks and months each label their axis differently. The weekly axis
            // and the short monthly one both draw month labels (`Mar 2022`,
            // `Sept 2022`), the widest any of them draws.
            for (const url of [FEBRUARY_2022, WEEKS, MONTHS]) {
                await page.goto(url);
                const timeline = page.getByTestId('archive-timeline');
                await expect(page.getByTestId('archive-timeline-zoomed')).toBeVisible();
                await expectNoElementOverflow(timeline, `the timeline at ${url}`);
                await expectNoHorizontalPageOverflow(page);
            }
        });
    });
});

/** The main chart's line or bars: the SVG ./TimelineHover.tsx explains. */
function chartPart(page: Page, part: TimelinePart): Locator {
    return page.getByTestId('archive-timeline').locator(`[data-timeline-part="${part}"]`);
}

/** Points the mouse `fraction` of the way across one half of the main chart. */
async function hoverAt(page: Page, part: TimelinePart, fraction: number): Promise<void> {
    const target = chartPart(page, part);
    const box = await boxOf(target);
    await target.hover({ position: { x: box.width * fraction, y: box.height / 2 } });
}

/** The line's tooltip, by shape: a Clear Number (or none yet), then the bucket's name. */
const LINE_TOOLTIP = /^(Clear [\d,]+|No clears yet) · \S/;
/** The bar's tooltip, by shape: the bucket's name, then its clears — and a span if any. */
const BAR_TOOLTIP = /^\S.* · (no clears|1 clear · #[\d,]+|[\d,]+ clears · #[\d,]+–#[\d,]+)$/;

test.describe('the timeline\'s tooltips (#114)', () => {
    test('hovering the line names the bucket under the pointer, and leaving hides it', async ({ page }) => {
        await page.goto('/gos10k');
        const tooltip = page.getByTestId('archive-timeline-tooltip');

        // Nothing until the pointer arrives: the tooltip is not part of the page.
        await expect(tooltip).toHaveCount(0);

        await hoverAt(page, 'line', 0.5);
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText(LINE_TOOLTIP);

        await page.getByRole('heading', { level: 2, name: 'Six years, month by month' }).hover();
        await expect(tooltip).toHaveCount(0);
    });

    test('hovering a bar gives its clears, and names the same bucket as the line above it', async ({ page }) => {
        await page.goto(FEBRUARY_2022);
        const tooltip = page.getByTestId('archive-timeline-tooltip');

        // A tenth of the way across 21 days is inside the third — and the line and the
        // bar are asked at the same x, so they must describe the same bucket. The line's
        // point for a bucket sits at the slot's right-hand edge; a tooltip that chose the
        // nearest vertex would disagree with the bar here.
        await hoverAt(page, 'line', 0.1);
        await expect(tooltip).toHaveText(LINE_TOOLTIP);
        const lineLabel = (await tooltip.innerText()).split(' · ')[1];

        await hoverAt(page, 'bar', 0.1);
        await expect(tooltip).toHaveText(BAR_TOOLTIP);
        const barLabel = (await tooltip.innerText()).split(' · ')[0];

        expect(barLabel).toBe(lineLabel);
    });

    test('says nothing over the overview strip', async ({ page }) => {
        await page.goto(FEBRUARY_2022);

        // Tooltips belong to the main chart; the strip is context.
        const strip = page.getByTestId('archive-timeline-overview').getByRole('img');
        await strip.hover();
        await expect(page.getByTestId('archive-timeline-tooltip')).toHaveCount(0);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the tooltip inside the viewport at both ends of the chart', async ({ page }) => {
            // A tooltip centred over the first or last bar hangs half off the chart; it
            // must be slid back inside. Weeks draw the longest names (`week of 10 Jan
            // 2022`), and the unfiltered chart and a monthly range are the other two
            // shapes of axis.
            const tooltip = page.getByTestId('archive-timeline-tooltip');
            for (const url of ['/gos10k', WEEKS, MONTHS]) {
                await page.goto(url);
                const timeline = await boxOf(page.getByTestId('archive-timeline'));
                for (const part of ['line', 'bar'] as const) {
                    for (const fraction of [0.001, 0.999]) {
                        await hoverAt(page, part, fraction);
                        await expect(tooltip).toBeVisible();
                        const box = await boxOf(tooltip);
                        const where = `${url}, ${part}, ${fraction}`;
                        expect(box.x, `left edge at ${where}`).toBeGreaterThanOrEqual(timeline.x - 1);
                        expect(box.x + box.width, `right edge at ${where}`).toBeLessThanOrEqual(
                            timeline.x + timeline.width + 1
                        );
                        expect(box.x + box.width, `viewport at ${where}`).toBeLessThanOrEqual(360);
                    }
                }
                await expectNoHorizontalPageOverflow(page);
            }
        });
    });

    test.describe('on a touch screen', () => {
        test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

        test('a tap shows the tooltip, a tap elsewhere dismisses it, and neither changes the range', async ({
            page,
        }) => {
            await page.goto(FEBRUARY_2022);
            const tooltip = page.getByTestId('archive-timeline-tooltip');
            const url = page.url();

            const bars = chartPart(page, 'bar');
            const barsBox = await boxOf(bars);
            await bars.tap({ position: { x: barsBox.width * 0.5, y: barsBox.height / 2 } });
            await expect(tooltip).toBeVisible();
            await expect(tooltip).toHaveText(BAR_TOOLTIP);

            // A tap on the line moves the tooltip to the line's reading, not away.
            const line = chartPart(page, 'line');
            const lineBox = await boxOf(line);
            await line.tap({ position: { x: lineBox.width * 0.5, y: lineBox.height / 2 } });
            await expect(tooltip).toHaveText(LINE_TOOLTIP);

            await page.getByRole('heading', { level: 2, name: /^The range, / }).tap();
            await expect(tooltip).toHaveCount(0);

            // The chart has nothing to navigate to: the URL — where the range lives — is
            // exactly what it was.
            expect(page.url()).toBe(url);
        });

        test('closes a tapped tooltip when the chart changes width, rather than leaving it adrift', async ({
            page,
        }) => {
            // A tapped tooltip stays up until the next tap, so a phone rotated under it
            // would keep a position measured on the old width.
            await page.goto(FEBRUARY_2022);
            const tooltip = page.getByTestId('archive-timeline-tooltip');

            const bars = chartPart(page, 'bar');
            const barsBox = await boxOf(bars);
            await bars.tap({ position: { x: barsBox.width * 0.99, y: barsBox.height / 2 } });
            await expect(tooltip).toBeVisible();

            await page.setViewportSize({ width: 320, height: 780 });
            await expect(tooltip).toHaveCount(0);
            await expectNoHorizontalPageOverflow(page);
        });
    });

    test.describe('with JavaScript disabled', () => {
        test.use({ javaScriptEnabled: false });

        test('still draws the whole chart, named as before, with no tooltip', async ({ page }) => {
            // Progressive enhancement: the SVGs are rendered on the server, and only the
            // pointer handling needs the browser. The charts' accessible names are
            // asserted too — #58's audit starts from them and #114 must not lose them.
            for (const url of ['/gos10k', FEBRUARY_2022]) {
                await page.goto(url);
                await expect(page.getByRole('img', { name: /^Cumulative Full Clears/ })).toBeVisible();
                await expect(page.getByRole('img', { name: /^Full Clears per (month|day)/ }).first()).toBeVisible();

                await hoverAt(page, 'bar', 0.5);
                await expect(page.getByTestId('archive-timeline-tooltip')).toHaveCount(0);
            }
            await expect(page.getByTestId('archive-timeline-overview')).toBeVisible();
        });
    });
});

/**
 * Where slot `index` of `count` is, as a fraction of the chart's width: its middle, so a
 * spec lands inside the bucket it names rather than on a boundary a rounding pixel
 * could put in either neighbour.
 */
function slotFraction(index: number, count: number): number {
    return (index + 0.5) / count;
}

/** Presses the mouse `from` of the way across `target`, and moves it to `to` of the way. */
async function pressAndMove(page: Page, target: Locator, from: number, to: number): Promise<void> {
    // Into view first: the mouse presses at viewport coordinates, and at 1280×720 the
    // main chart's bars sit across the bottom edge — a press there lands on the page.
    await target.scrollIntoViewIfNeeded();
    const box = await boxOf(target);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 8 });
}

/** A whole drag: press, move and release. */
async function dragAcross(page: Page, target: Locator, from: number, to: number): Promise<void> {
    await pressAndMove(page, target, from, to);
    await page.mouse.up();
}

/**
 * Every navigation of the main frame from now on, by URL. A drag must make exactly one,
 * on release: #108 ruled out a slider because a render per drag tick is what URL-driven
 * server rendering costs.
 */
function recordNavigations(page: Page): string[] {
    const urls: string[] = [];
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) urls.push(pathAndQuery(frame.url()));
    });
    return urls;
}

function pathAndQuery(url: string): string {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
}

/**
 * Waits for the timeline's client JavaScript to be running, by the one thing it does
 * that the server's HTML cannot: a hover tooltip. A drag started before hydration would
 * press on inert SVGs and prove nothing.
 */
async function waitForTimelineScript(page: Page): Promise<void> {
    await hoverAt(page, 'line', 0.5);
    await expect(page.getByTestId('archive-timeline-tooltip')).toBeVisible();
    await page.mouse.move(0, 0);
}

/** The overview strip's bars. */
function strip(page: Page): Locator {
    return page.getByTestId('archive-timeline-overview').getByRole('img');
}

/**
 * The fixture Archive runs from 4 July 2020 to 23 February 2026: 68 monthly slots,
 * July 2020 first, on the unfiltered chart and on the strip.
 */
const ARCHIVE_MONTHS = 68;
/**
 * {@link WEEKS} in weekly slots: the first is the Monday before the range, 10 January
 * 2022, and the seventeenth the week of 2 May.
 */
const WEEK_SLOTS = 17;

test.describe('dragging across the timeline (#115)', () => {
    test('draws the selection while dragging, and navigates once, on release, to the outer edges of the buckets touched', async ({
        page,
    }) => {
        await page.goto(WEEKS);
        await waitForTimelineScript(page);
        const navigations = recordNavigations(page);
        const bars = chartPart(page, 'bar');

        // Weeks 1 to 3 of the axis — the weeks of 10, 17 and 24 January. The first begins
        // two days before the range does: the selection snaps outward to whole buckets.
        await pressAndMove(page, bars, slotFraction(0, WEEK_SLOTS), slotFraction(2, WEEK_SLOTS));

        // Drawn while dragging, over the three weeks and no further; and nothing has
        // navigated yet.
        const selection = page.getByTestId('archive-timeline-selection');
        await expect(selection).toBeVisible();
        const [barsBox, selectionBox] = await Promise.all([boxOf(bars), boxOf(selection)]);
        expect(selectionBox.x).toBeCloseTo(barsBox.x, 0);
        expect(selectionBox.width).toBeCloseTo((barsBox.width * 3) / WEEK_SLOTS, 0);
        // No hover tooltip over a drag: the selection is what the reader is looking at.
        await expect(page.getByTestId('archive-timeline-tooltip')).toBeHidden();
        expect(navigations).toEqual([]);

        await page.mouse.up();

        // The week of 24 January ends on Sunday the 30th: `to` is an inclusive day.
        await expect(page).toHaveURL(/\/gos10k\?from=2022-01-10&to=2022-01-30$/);
        expect(navigations).toEqual(['/gos10k?from=2022-01-10&to=2022-01-30']);
        // And the page is the new range: the chart zooms to it (#113), days now.
        await expect(page.getByRole('heading', { level: 2, name: 'The range, day by day' })).toBeVisible();
    });

    test('selects the same buckets dragged right to left', async ({ page }) => {
        await page.goto(WEEKS);
        await waitForTimelineScript(page);

        // From the week of 7 March back to the week of 31 January.
        await dragAcross(page, chartPart(page, 'line'), slotFraction(8, WEEK_SLOTS), slotFraction(3, WEEK_SLOTS));

        await expect(page).toHaveURL(/\/gos10k\?from=2022-01-31&to=2022-03-13$/);
    });

    test('picks any span of the whole Archive on the overview strip, wider than the range and clamped to its ends', async ({
        page,
    }) => {
        await page.goto(WEEKS);
        await waitForTimelineScript(page);
        const navigations = recordNavigations(page);

        // July 2020 to May 2023: far wider than the range. July 2020 begins on the 1st,
        // but the Archive begins on the 4th.
        await dragAcross(page, strip(page), slotFraction(0, ARCHIVE_MONTHS), slotFraction(34, ARCHIVE_MONTHS));

        await expect(page).toHaveURL(/\/gos10k\?from=2020-07-04&to=2023-05-31$/);
        expect(navigations).toEqual(['/gos10k?from=2020-07-04&to=2023-05-31']);
    });

    test('writes dates, and no Clear Number, when dragged under a Clear Number range', async ({ page }) => {
        await page.goto(FEBRUARY_2022);
        await waitForTimelineScript(page);

        // 21 days from 1 February; the 3rd to the 7th.
        await dragAcross(page, chartPart(page, 'bar'), slotFraction(2, 21), slotFraction(6, 21));

        await expect(page).toHaveURL(/\/gos10k\?from=2022-02-03&to=2022-02-07$/);
    });

    test('keeps the tab, and drops the Helper board\'s own parameters', async ({ page }) => {
        await page.goto('/gos10k?tab=rankings&helperTime=inRun&helperRows=all');
        await waitForTimelineScript(page);

        // The unfiltered chart is the whole Archive by month: March to June 2022.
        await dragAcross(page, chartPart(page, 'bar'), slotFraction(20, ARCHIVE_MONTHS), slotFraction(23, ARCHIVE_MONTHS));

        await expect(page).toHaveURL(/\/gos10k\?from=2022-03-01&to=2022-06-30&tab=rankings$/);
    });

    test('does nothing for a press that moves less than the threshold', async ({ page }) => {
        await page.goto(WEEKS);
        await waitForTimelineScript(page);
        const navigations = recordNavigations(page);
        const bars = chartPart(page, 'bar');
        await bars.scrollIntoViewIfNeeded();
        const box = await boxOf(bars);

        // Three pixels sideways: a click, not a drag, and there is no click-to-filter.
        const x = box.x + box.width * slotFraction(5, WEEK_SLOTS);
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 3, y);
        await expect(page.getByTestId('archive-timeline-selection')).toHaveCount(0);
        await page.mouse.up();

        // A navigation is asynchronous, so absence is proved by what comes next: the
        // next navigation there is must be this drag's, and the only one.
        await dragAcross(page, bars, slotFraction(1, WEEK_SLOTS), slotFraction(1, WEEK_SLOTS) + 0.02);
        await expect(page).toHaveURL(/\/gos10k\?from=2022-01-17&to=2022-01-23$/);
        expect(navigations).toEqual(['/gos10k?from=2022-01-17&to=2022-01-23']);
    });

    test('cancels a drag in progress on Escape', async ({ page }) => {
        await page.goto(WEEKS);
        await waitForTimelineScript(page);
        const navigations = recordNavigations(page);
        const bars = chartPart(page, 'bar');

        await pressAndMove(page, bars, slotFraction(2, WEEK_SLOTS), slotFraction(9, WEEK_SLOTS));
        await expect(page.getByTestId('archive-timeline-selection')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('archive-timeline-selection')).toHaveCount(0);
        // Releasing afterwards is the end of a cancelled drag, not the end of a drag.
        await page.mouse.up();

        await dragAcross(page, bars, slotFraction(1, WEEK_SLOTS), slotFraction(1, WEEK_SLOTS) + 0.02);
        await expect(page).toHaveURL(/\/gos10k\?from=2022-01-17&to=2022-01-23$/);
        expect(navigations).toEqual(['/gos10k?from=2022-01-17&to=2022-01-23']);
    });

    test.describe('on a touch screen', () => {
        test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

        test('a finger dragged across the chart scrolls the page and selects nothing', async ({ page }) => {
            await page.goto(WEEKS);
            const url = page.url();
            const bars = chartPart(page, 'bar');
            await bars.scrollIntoViewIfNeeded();
            const box = await boxOf(bars);
            const scrolledBefore = await page.evaluate(() => window.scrollY);

            // A real touch gesture, through Chromium's input pipeline: a thumb swiping up
            // and across the chart, the way it scrolls past it. Playwright's own touch API
            // only taps, and CDP's synthesizeScrollGesture scrolled nothing here — not
            // even over a heading — so the touch points are sent one by one.
            const session = await page.context().newCDPSession(page);
            const x = box.x + box.width * 0.8;
            const y = box.y + box.height / 2;
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let step = 1; step <= 10; step += 1) {
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: x - step * 15, y: y - step * 25 }],
                });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolledBefore);
            await expect(page.getByTestId('archive-timeline-selection')).toHaveCount(0);
            expect(page.url()).toBe(url);
        });
    });
});
