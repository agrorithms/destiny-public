import { expect, test } from './support/test-fixtures';

/**
 * The fastest-clears panel (#91) — the half of it that only a browser can see.
 *
 * The ranking, the durations, the participant lists and the range scoping are all
 * arithmetic over the fixture Archive and are asserted in Vitest
 * (tests/db/archive-fastest-clears.test.ts) with specific instances and specific
 * numbers. Repeating any of that here would buy nothing and break on every
 * re-extraction of the fixture.
 *
 * What is left is one acceptance criterion no other seam can reach: **the chips wrap
 * rather than overflow on a phone.** `flex-wrap` is a computed-layout property — a
 * server-rendered DOM contains the class either way, and a JSDOM test would report
 * every element as zero-wide. So the assertion is that the chip row grows downward
 * onto more than one visual line at 360px while staying inside its own box, which is
 * the thing that is actually true or false about the rendered page.
 *
 * Asserts no counts, no names and no dates, for the same reason gos10k-shell.spec.ts
 * does not: the fixture's figures belong to the Vitest seam.
 */
test.describe('the fastest clears panel', () => {
    test('lists Runs with their whole fireteam named on each row', async ({ page }) => {
        await page.goto('/gos10k');

        const rows = page.getByTestId('archive-fastest-clear-row');
        await expect(rows.first()).toBeVisible();

        // Structural: every row carries a participant list, and the lists are not
        // empty. A row whose fireteam failed to render is the panel's most plausible
        // silent failure — the record would still look right.
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            const chips = rows.nth(i).getByTestId('archive-fastest-clear-participants').locator('li');
            expect(await chips.count(), `row ${i + 1} named nobody`).toBeGreaterThan(0);
        }
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('wraps the participant chips instead of overflowing', async ({ page }) => {
            await page.goto('/gos10k');

            const chipList = page
                .getByTestId('archive-fastest-clear-row')
                .first()
                .getByTestId('archive-fastest-clear-participants');
            await expect(chipList).toBeVisible();

            // Six or more `Name#Code` chips cannot fit on one 360px line, so if the row
            // is still one line tall it is overflowing rather than wrapping. Measured as
            // distinct top offsets rather than as a height in pixels, which would encode
            // the chip's padding into the assertion.
            const lines = await chipList.evaluate((list) => {
                const tops = Array.from(list.children).map((chip) =>
                    Math.round(chip.getBoundingClientRect().top)
                );
                return new Set(tops).size;
            });
            expect(lines, 'the chips sit on a single line at 360px').toBeGreaterThan(1);

            // Wrapping and still overflowing is possible — a chip wider than the box, or
            // `flex-wrap` defeated by a `min-width`. This is the criterion's other half.
            const overflow = await chipList.evaluate((el) => el.scrollWidth - el.clientWidth);
            expect(overflow, 'the chip row scrolls sideways at 360px').toBeLessThanOrEqual(0);

            // And the page itself, since a wide chip row is exactly how a panel breaks
            // the phone layout the shell spec pins.
            const pageOverflow = await page.evaluate(() => {
                const root = document.documentElement;
                return root.scrollWidth - root.clientWidth;
            });
            expect(pageOverflow, 'the page scrolls horizontally at 360px').toBeLessThanOrEqual(0);
        });
    });
});
