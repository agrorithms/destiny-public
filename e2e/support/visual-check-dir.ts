/**
 * Where `npm run visual:check` puts its screenshots, relative to the repo root. One name
 * for both sides: e2e/visual.spec.ts writes here and scripts/visual-check.ts wipes it
 * first, so if they disagreed, last run's screenshots would be reviewed as this run's.
 * `.gitignore` and stryker.config.mjs's ignorePatterns can't import it and name it by hand.
 *
 * Plain TypeScript with no imports: the script loads it through tsx and
 * tsconfig.scripts.json as well as Playwright.
 */
export const VISUAL_CHECK_DIR = 'visual-check';
