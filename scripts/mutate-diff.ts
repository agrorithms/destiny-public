import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { changedFiles, DEFAULT_RANGE, resolveRange, type ResolvedRange } from './lib/git-range';

/**
 * `npm run mutate:diff -- [range] [--files] [--incremental] [--no-typecheck]`
 *
 * Mutation-tests the logic a git range changed (default `main...HEAD`): Stryker breaks
 * each changed line in small ways and reports every break no Vitest test noticed. This
 * replaces the hand-made "bite proof" for anything Vitest can reach.
 *
 * Scope is changed `.ts` under `src/` — not tests, not `.tsx`, not `src/hooks/`. Vitest
 * runs with no DOM here, so no test can reach a component or hook, and mutating one would
 * only report "no coverage" for every mutant and drag the score down. Those files are
 * listed at the end as not mutation-tested; Playwright is what covers them.
 *
 * Flags:
 *   --files         mutate whole changed files, not just the changed lines
 *   --incremental   reuse results from the last run for code and tests that did not
 *                   change (reports/stryker-incremental.json) — for kill-and-rerun loops
 *   --no-typecheck  skip the TypeScript checker (faster; un-compilable mutants then
 *                   count as killed or survived instead of being discarded)
 *
 * When the range ends somewhere other than the checked-out commit (a past PR), the
 * changed lines only make sense in that commit's files, so the run happens in a
 * temporary git worktree at the range's head — with that commit's tests too.
 */

const REPO = process.cwd();
const CONFIG = path.join(REPO, 'stryker.config.mjs');
const STRYKER = path.join(REPO, 'node_modules', '.bin', 'stryker');
const REPORT_DIR = path.join(REPO, 'reports', 'mutation');

/** Changed `.ts` that a Vitest test could reach. */
function isMutable(file: string): boolean {
    return file.startsWith('src/')
        && file.endsWith('.ts')
        && !file.endsWith('.test.ts')
        && !file.endsWith('.d.ts')
        && !file.startsWith('src/hooks/');
}

/** Changed source no Vitest test can reach: rendered code. */
function isBrowserOnly(file: string): boolean {
    return file.startsWith('src/') && (file.endsWith('.tsx') || (file.startsWith('src/hooks/') && file.endsWith('.ts')));
}

function parseArgs(argv: string[]) {
    const flags = new Set(argv.filter((a) => a.startsWith('--')));
    const known = new Set(['--files', '--incremental', '--no-typecheck']);
    for (const flag of flags) {
        if (!known.has(flag)) throw new Error(`Unknown flag ${flag}. Known: ${[...known].join(', ')}`);
    }
    const positional = argv.filter((a) => !a.startsWith('--'));
    if (positional.length > 1) throw new Error(`One range at most, got: ${positional.join(' ')}`);
    return {
        range: positional[0] ?? DEFAULT_RANGE,
        wholeFiles: flags.has('--files'),
        incremental: flags.has('--incremental'),
        typecheck: !flags.has('--no-typecheck'),
    };
}

/** A checkout of `range.head` to run in, and how to remove it afterwards. */
function workdirFor(range: ResolvedRange): { dir: string; cleanup: () => void } {
    if (range.atHead) return { dir: REPO, cleanup: () => {} };

    // In the OS temp dir, not under the repo: tsconfig.json includes **/*.ts, so a
    // second copy of src/ inside the repo would be type-checked by every build.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-mutate-'));
    execFileSync('git', ['worktree', 'add', '--detach', dir, range.head], { stdio: 'ignore' });
    // The worktree gets this checkout's installed packages rather than a fresh install.
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    return {
        dir,
        cleanup: () => execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' }),
    };
}

interface ReportMutant {
    mutatorName: string;
    replacement?: string;
    status: string;
    location: { start: { line: number; column: number } };
}
interface Report {
    files: Record<string, { mutants: ReportMutant[] }>;
}

/** The score as Stryker defines it, and the share of mutants each status took. */
function summarise(report: Report): void {
    const all = Object.entries(report.files).flatMap(([file, { mutants }]) => mutants.map((m) => ({ file, ...m })));
    const count = (status: string) => all.filter((m) => m.status === status).length;
    const killed = count('Killed');
    const timeout = count('Timeout');
    const survived = count('Survived');
    const noCoverage = count('NoCoverage');
    const detected = killed + timeout;
    const valid = detected + survived + noCoverage;
    const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

    console.log('\n── mutate:diff summary ──');
    console.log(`mutants: ${all.length} — killed ${killed}, timeout ${timeout}, survived ${survived}, `
        + `no coverage ${noCoverage}, compile error ${count('CompileError')}, runtime error ${count('RuntimeError')}, `
        + `ignored ${count('Ignored')}`);
    console.log(`mutation score: ${pct(detected, valid)} (of covered code: ${pct(detected, detected + survived)})`);

    const left = all.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');
    if (left.length > 0) {
        console.log('\nNot detected:');
        for (const m of left) {
            const replacement = (m.replacement ?? '').replace(/\s+/g, ' ').slice(0, 60);
            console.log(`  ${m.file}:${m.location.start.line}  ${m.status.padEnd(10)} ${m.mutatorName} → ${replacement}`);
        }
    }
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const range = resolveRange(args.range);
    const changed = changedFiles(range);

    const targets = changed.filter((f) => isMutable(f.path) && f.ranges.length > 0);
    const browserOnly = changed.filter((f) => isBrowserOnly(f.path)).map((f) => f.path);

    console.log(`range ${range.spec}: ${range.base.slice(0, 8)} → ${range.atHead ? 'working tree' : range.head.slice(0, 8)}`);
    if (targets.length === 0) {
        console.log('No changed logic under src/ to mutate.');
    } else {
        const mutate = targets.flatMap((f) =>
            args.wholeFiles ? [f.path] : f.ranges.map(([start, end]) => `${f.path}:${start}-${end}`)
        );
        console.log(`mutating ${args.wholeFiles ? 'whole files' : 'changed lines'}:\n  ${mutate.join('\n  ')}`);

        const { dir, cleanup } = workdirFor(range);
        const started = Date.now();
        let status: number | null;
        try {
            const strykerArgs = ['run', CONFIG, '--mutate', mutate.join(',')];
            if (args.incremental) strykerArgs.push('--incremental');
            if (!args.typecheck) strykerArgs.push('--checkers', '');
            status = spawnSync(STRYKER, strykerArgs, { cwd: dir, stdio: 'inherit' }).status;

            // Reports land in the run's cwd; a worktree is about to be deleted.
            if (dir !== REPO) {
                fs.rmSync(REPORT_DIR, { recursive: true, force: true });
                fs.cpSync(path.join(dir, 'reports', 'mutation'), REPORT_DIR, { recursive: true });
            }
        } finally {
            cleanup();
        }
        const seconds = ((Date.now() - started) / 1000).toFixed(0);

        const reportFile = path.join(REPORT_DIR, 'mutation.json');
        if (fs.existsSync(reportFile)) summarise(JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Report);
        console.log(`\nwall time: ${seconds}s · report: ${path.relative(REPO, path.join(REPORT_DIR, 'mutation.html'))}`);
        if (status !== 0) process.exitCode = status ?? 1;
    }

    if (browserOnly.length > 0) {
        console.log(`\nNot mutation-tested (no Vitest test can render them — Playwright territory):\n  ${browserOnly.join('\n  ')}`);
    }
}

main();
