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

    // Run only the tests that execute each mutant, not all 47 files per mutant. The
    // vitest runner supports per-test coverage, which is what makes a diff-sized run
    // take a minute rather than an hour.
    coverageAnalysis: 'perTest',

    // Vitest strips types without checking them, so a mutant that would not compile
    // (e.g. `return ''` where a number is declared) would still run, and be counted as
    // killed or survived for reasons that mean nothing. The checker discards those as
    // CompileError instead. Costs a whole-project type check at startup.
    checkers: ['typescript'],
    tsconfigFile: 'tsconfig.json',

    reporters: ['clear-text', 'progress', 'html', 'json'],

    // No `break` threshold on purpose: the baseline comes first, the number after.
    thresholds: { high: 80, low: 60, break: null },

    // Each worker is a Vitest process; the dev box has 8 cores and ~5 GB of RAM.
    concurrency: 4,

    // Stryker copies the project into a sandbox per run. It already skips git-ignored
    // files; this is the explicit list of the large ones, because a sandbox that copied
    // data/ (several GB of SQLite) would fill the disk before anything ran.
    ignorePatterns: [
        'data',
        '.next',
        'tmp',
        'dist',
        'gos10k/*.db',
        'test-results',
        'visual-check',
        'reports',
    ],
    tempDirName: '.stryker-tmp',
    cleanTempDir: true,
};

export default config;
