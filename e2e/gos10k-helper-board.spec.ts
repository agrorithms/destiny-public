import { expect, test } from './support/test-fixtures';
import { expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * The Helper board (#90) — the half of it that only a browser can see.
 *
 * The ranking, the overlap arithmetic, the distinct-instance counting and the
 * `Name#Code` fallback are properties of the query and are asserted in Vitest
 * (tests/db/archive-helper-board.test.ts) with named Helpers and specific durations;
 * the URL grammar behind both controls is asserted in
 * src/app/gos10k/helper-board-view.test.ts. Neither is repeated here — this file
 * asserts no counts, no names and no durations, the same rule the fastest-clears and
 * median-speed specs follow, so a re-extraction of the fixture cannot break it.
 *
 * What is left is the three things no other seam reaches.
 *
 * #90 lists the time-column toggle and the show-all expansion as "browser-only
 * behaviour, verified by hand and recorded as unverified by automated tests — see #80".
 * That was written when the obvious implementation was client state. Both controls
 * shipped as links into this same URL (see src/app/gos10k/helper-board-view.ts), which
 * makes them assertable in Chromium, so they are asserted here instead and #80's
 * decision-2 record says so — the same substitution #88 made for its shaded band.
 * The point is not that a link is easier to test: it is that "unverified" is a claim
 * this repo should only make when it is true.
 *
 * The third is #90's phone criterion. This is a four-column table whose first column
 * holds `Name#Code` in full — one column wider than the median speed board below it,
 * and the one most likely to push a table past a 360px viewport. A table that
 * overflows is invisible to every other seam: the server-rendered DOM is identical
 * either way and there is no jsdom in the Vitest run to measure a width in.
 */
test.describe('the Helper board', () => {
    test('opens on the first page of rows, measuring time alongside him', async ({ page }) => {
        await page.goto('/gos10k?tab=rankings');

        const board = page.getByTestId('archive-helper-board');
        await expect(board).toBeVisible();

        // 25 rows, not "some rows": the default page size is the criterion, and a board
        // that quietly rendered all 553 would still pass a `toBeVisible`.
        await expect(board.locator('tbody tr')).toHaveCount(25);

        // The header names the measure rather than saying "Time", because the two
        // readings differ — asserting the text is asserting that a reader can tell
        // which one they are looking at.
        await expect(page.getByTestId('archive-helper-time-header')).toHaveText('Time with him');
    });

    test('swaps the time column without losing the range', async ({ page }) => {
        // Loaded with a range, so the assertion is about both halves of the link: the
        // measure it writes and the filter it must carry forward. A toggle that dropped
        // the range would still swap the column, and the board underneath would silently
        // become the whole Archive's.
        await page.goto('/gos10k?clearFrom=1&clearTo=5000&tab=rankings');

        await page.getByTestId('archive-helper-time-toggle').getByRole('link', { name: 'Time in Run' }).click();

        await expect(page.getByTestId('archive-helper-time-header')).toHaveText('Time in Run');
        await expect(page).toHaveURL(/clearFrom=1&clearTo=5000/);
        await expect(page).toHaveURL(/helperTime=inRun/);
        // And the tab: the board lives on Rankings (#112), and a link that dropped it
        // would land on Overview, where there is no board to have toggled.
        await expect(page).toHaveURL(/tab=rankings/);

        // Still the same board, still the same page of it: the toggle changes which of
        // two numbers the third column reads, never the ranking or the row count.
        await expect(page.getByTestId('archive-helper-board').locator('tbody tr')).toHaveCount(25);
    });

    test('expands to every guardian and back', async ({ page }) => {
        await page.goto('/gos10k?tab=rankings');

        const board = page.getByTestId('archive-helper-board');
        const expand = page.getByTestId('archive-helper-board-expand');

        await expect(expand).toBeVisible();
        await expand.click();

        // Waited on the link's own label rather than on a row count, because a bare
        // `count()` does not retry and would read the pre-navigation DOM — which is
        // exactly how this spec failed on its first run, reporting 25 rows against a
        // board that expands correctly.
        await expect(page.getByTestId('archive-helper-board-expand')).toHaveText(/^Show the top /);

        // More than the first page, without pinning the fixture's exact population —
        // that number moves on every re-extraction and is already asserted in Vitest.
        await expect
            .poll(() => board.locator('tbody tr').count(), {
                message: 'the expanded board should hold more than one page',
            })
            .toBeGreaterThan(25);

        // And the affordance reverses, which is what makes it an expansion rather than
        // a one-way door: a reader who expanded by accident can get their page back.
        await page.getByTestId('archive-helper-board-expand').click();
        await expect(board.locator('tbody tr')).toHaveCount(25);
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 360, height: 780 } });

        test('keeps the board inside a 360px viewport', async ({ page }) => {
            await page.goto('/gos10k?tab=rankings');

            // By testid rather than by role: `getByRole('table')` binds to whatever is in
            // a `<table>`, and three panels on this page render one
            // (docs/handoffs/260803-playwright-e2e.md).
            const board = page.getByTestId('archive-helper-board');
            await expect(board).toBeVisible();

            // The table's own box first — a wide unbreakable cell scrolls the table
            // rather than the page when an ancestor has its own overflow.
            await expectNoElementOverflow(board, 'the board');

            // The toggle too: it is a row of pills beside a label, and the row that
            // wraps at 360px is the one that would otherwise widen the section.
            await expectNoElementOverflow(
                page.getByTestId('archive-helper-time-toggle'),
                'the time toggle'
            );

            // And the page, which is how a wide table usually announces itself.
            await expectNoHorizontalPageOverflow(page);
        });

        test('keeps the expanded board inside a 360px viewport too', async ({ page }) => {
            // A separate case because it is the one that actually broke. A Bungie name is
            // up to 26 characters plus `#dddd`, and the first 31-character unbreakable one
            // is far enough down the board that only show-all renders it: against the
            // production Archive this view overflowed the page by 11px while the table's
            // own box measured clean, because the table had *grown* rather than scrolled.
            // The cell is `wrap-anywhere` now.
            //
            // Stated plainly: this assertion is a guard, not a reproduction. The fixture's
            // longest name is `DayMan,Champion of the Sun`, which has spaces and so wraps
            // on its own; the run-scoped canary in row one is unbreakable but shorter. What
            // found the bug was measuring the real Archive by hand, and it would be
            // dishonest to imply this spec would have.
            await page.goto('/gos10k?tab=rankings&helperRows=all');

            const board = page.getByTestId('archive-helper-board');
            await expect(board).toBeVisible();
            await expectNoElementOverflow(board, 'the expanded board');
            await expectNoHorizontalPageOverflow(page);
        });
    });
});
