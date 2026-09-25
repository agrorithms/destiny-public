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
