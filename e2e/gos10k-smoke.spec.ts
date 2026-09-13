import { expect, test } from './support/test-fixtures';
import { archiveCanaryDisplayName } from './support/archive-world';

/**
 * The Archive's first browser coverage: proof that the harness works end to end,
 * and nothing more.
 *
 * Issue #96 builds the harness and deliberately not the specs — which of
 * /gos10k's behaviours earn assertions is decided in #80, during #87, #88 and
 * #90, by whoever builds the panels. So this asserts only what a harness smoke
 * test can: the page renders in Chromium against the fixture Archive, the
 * fixture is the one being read, and the page produces no console errors.
 *
 * Deliberately asserts **no counts** — not the run total, not the date range, not
 * the class percentages. Issue #85 widened the fixture Archive from 9 Runs to 406
 * without touching this file, which is the property that made it worth having.
 */
test.describe('the GoS 10k Archive page', () => {
    test('renders in Chromium against the fixture Archive with no console errors', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        // A page error is an uncaught exception rather than a logged one, so it
        // never reaches the handler above and would otherwise pass silently.
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

        await page.goto('/gos10k');

        await expect(page.getByRole('heading', { name: 'The GoS 10k', level: 1 })).toBeVisible();

        // The same canary the setup project checked over HTTP, re-checked through
        // a real render. The setup proves the *server* opened the fixture; this
        // proves the fixture survives into the DOM a spec would assert against.
        //
        // Scoped to the Helper board by testid — the one place the canary is *designed*
        // to appear, deterministically as its first row (see mintCanariedArchive). It is
        // joined to every Run in the seed, so since #91 it also renders as a chip in all
        // ten fastest-clear rows and an unscoped getByText is strict-mode ambiguous.
        // Named rather than `.first()` or an ARIA role: the binding this asserts is that
        // the Helper board read the fixture, and either of those would drift onto
        // whichever panel happened to render first or to use a <table>, silently, as
        // each new panel ships.
        await expect(
            page
                .getByTestId('archive-helper-board')
                .getByText(archiveCanaryDisplayName(), { exact: true })
        ).toBeVisible();

        expect(consoleErrors, 'the page logged console errors').toEqual([]);
    });
});
