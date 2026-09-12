import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The timeline (#88) — the half of it that only a browser can see.
 *
 * **This file is #80's decision 4, and it supersedes #88's own criterion.** That
 * criterion — "browser-only behaviour is verified by hand and *recorded* as unverified
 * by automated tests" — was written when the Archive had no harness at all. #96 built
 * one, and #80 names the timeline's shading as "the item with real regression risk", so
 * the shading is asserted here rather than left as tracked debt. The hand verification
 * still happened; what changed is that it is no longer the only thing standing behind
 * the feature. The decision is recorded on #80 rather than only here.
 *
 * **Assertion style: structural, and only about geometry no other seam can see.** The
 * bucket counts, the empty months and the cumulative total are arithmetic over the
 * fixture Archive and are asserted in Vitest (tests/db/archive-timeline.test.ts); the
 * band's position on the axis is asserted in Vitest too
 * (src/app/gos10k/timeline-geometry.test.ts). Repeating any of that here would break on
 * every re-extraction of the fixture and prove nothing extra. What is left is what
 * *rendering twice* can get wrong: whether the band appears at all when a range is
 * active, whether it disappears when none is, and whether the two charts really agree
 * on where it sits. The last one is the ticket's "the shading reads across both charts
 * because they share an axis", and it is a claim about two laid-out elements — invisible
 * to Vitest, which sees one geometry object used twice and cannot see either SVG stretch.
 *
 * No counts, no dates, no durations, per the rule #91 and #92 settled on.
 */
test.describe('the timeline', () => {
    test('draws no shaded band when no range is active', async ({ page }) => {
        await page.goto('/gos10k');

        await expect(page.getByTestId('archive-timeline')).toBeVisible();
        // A band covering the whole chart would read as a selection, so the unfiltered
        // page draws none at all.
        await expect(page.getByTestId('archive-timeline-band')).toHaveCount(0);
    });

    test('shades the same extent in both charts when a range is active', async ({ page }) => {
        // February 2022 — clears 103–143, the window every other Archive test filters on.
        await page.goto('/gos10k?clearFrom=103&clearTo=143');

        const timeline = page.getByTestId('archive-timeline');
        const bands = page.getByTestId('archive-timeline-band');

        // Two: one over the cumulative line, one over the monthly bars.
        await expect(bands).toHaveCount(2);

        const [overLine, overBars] = await Promise.all([
            bands.nth(0).boundingBox(),
            bands.nth(1).boundingBox(),
        ]);
        const chart = await timeline.boundingBox();
        expect(overLine).not.toBeNull();
        expect(overBars).not.toBeNull();
        expect(chart).not.toBeNull();

        // The property the ticket is actually asking for: a reader's eye travels down
        // from the line to the bars and lands on the same window. Sub-pixel tolerance
        // because the two SVGs are laid out independently and stretched to the same
        // column width — the numbers are equal, the layout rounding need not be.
        expect(Math.abs(overLine!.x - overBars!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(overLine!.width - overBars!.width)).toBeLessThanOrEqual(1);

        // And it is a band rather than the whole chart: one month of six years. A
        // shading bug that painted everything would satisfy every assertion above.
        expect(overLine!.width).toBeGreaterThan(0);
        expect(overLine!.width).toBeLessThan(chart!.width / 4);
        expect(overLine!.x).toBeGreaterThanOrEqual(chart!.x - 1);
        expect(overLine!.x + overLine!.width).toBeLessThanOrEqual(chart!.x + chart!.width + 1);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the timeline inside a 360px viewport with the band still visible', async ({
            page,
        }) => {
            await page.goto('/gos10k?clearFrom=103&clearTo=143');

            const timeline = page.getByTestId('archive-timeline');
            await expect(timeline).toBeVisible();

            // The chart's own box first: a full-bleed SVG with 68 bars is exactly the
            // shape that scrolls inside its container while the page measures clean.
            await expectNoElementOverflow(timeline, 'the timeline');
            await expectNoHorizontalPageOverflow(page);

            // "The shaded range is still identifiable" — the criterion's other half, and
            // the reason the band has a one-month minimum width. A day of six years is a
            // third of a pixel here; three is the least that reads as a band at all.
            const band = await page.getByTestId('archive-timeline-band').first().boundingBox();
            expect(band!.width).toBeGreaterThanOrEqual(3);
        });
    });
});
