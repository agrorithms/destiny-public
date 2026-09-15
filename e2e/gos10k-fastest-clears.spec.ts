import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

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
    // Deliberately only the phone spec. An earlier draft also asserted that every row
    // carries a non-empty participant list; that is not a browser-only fact — it is what
    // tests/db/archive-fastest-clears.test.ts checks with actual names — and #81 rules
    // browser coverage out of Phase 1 except where a behaviour has no other seam. The
    // chip wrapping is the one behaviour here that qualifies, so it is the only one here.
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
            await expectNoElementOverflow(chipList, 'the chip row');

            // And the page itself, since a wide chip row is exactly how a panel breaks
            // the phone layout the shell spec pins.
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
