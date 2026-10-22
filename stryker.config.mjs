// @ts-check

/**
 * Mutation testing. Stryker makes small breaks in the source (a `<` becomes `<=`, a
 * condition becomes `true`), runs the Vitest tests that cover each one, and reports the
 * breaks no test noticed — the "bite proof" this repo used to do by hand, done for every
 * changed line instead of the few someone thought of.
 *
 * Not run on its own: `npm run mutate:diff` (scripts/mutate-diff.ts) supplies `mutate` from
 * a git range. A bare `npx stryker run` falls back to Stryker's default `mutate` glob —
 * every file under src/, .tsx included — which is hours of mostly "no coverage".
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
const config = {
    testRunner: 'vitest',
    vitest: { configFile: 'vitest.config.ts' },

    // Run only the tests that execute each mutant, not every test file per mutant. The
    // vitest runner supports per-test coverage, which is what makes a diff-sized run
    // take a minute rather than an hour.
    coverageAnalysis: 'perTest',

    // Vitest strips types without checking them, so a mutant that would not compile
    // (e.g. `return ''` where a number is declared) would still run, and be counted as
    // killed or survived for reasons that mean nothing. The checker discards those as
    // CompileError instead. tsconfig.stryker.json narrows the check to src/ and tests/:
    // the project tsconfig.json includes every **/*.ts, scripts/, e2e/ and gos10k/ too.
    // Even narrowed it multiplies the wall time, so it is off here and mutate:diff turns it
    // on with --typecheck, which the score reported at the end of a ticket uses.
    checkers: [],
    tsconfigFile: 'tsconfig.stryker.json',

    // A static mutant is one that runs only while a module loads (a top-level constant, a
    // literal table), so per-test coverage can't say which tests reach it and Stryker would
    // rerun every test for each. Those are skipped as Ignored; mutate:diff reports how many.
    ignoreStatic: true,

    reporters: ['clear-text', 'progress', 'html', 'json'],

    // No `break`: the pass mark (62.5% overall, from 8 scored mutants up) needs a minimum
    // count Stryker can't express, so mutate:diff applies it. high/low only colour the report.
    thresholds: { high: 80, low: 60, break: null },

    // Each worker is a Vitest process; the dev box has 8 cores and ~5 GB of RAM.
    concurrency: 4,

    // Stryker copies the project into a sandbox per run, skipping only a short built-in list
    // (node_modules, .git, .next) and this one: it does not read .gitignore. So every large or generated
    // directory is named here; a sandbox that copied data/ (several GB of SQLite) would
    // fill the disk before anything ran. Keep it in step with .gitignore by hand: a large
    // folder added there and not here is copied into every run. 'visual-check' is
    // VISUAL_CHECK_DIR in e2e/support/visual-check-dir.ts.
    ignorePatterns: [
        'data',
        '.next',
        'tmp',
        'dist',
        'gos10k/*.db*',
        'coverage',
        'test-results',
        'playwright-report',
        'blob-report',
        'maintenance-snapshots',
        'visual-check',
        'reports',
    ],
    tempDirName: '.stryker-tmp',
    cleanTempDir: true,
};

export default config;
