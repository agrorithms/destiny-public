import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs as parseCliArgs } from 'util';
import { changedFiles, DEFAULT_RANGE, resolveRange, type ResolvedRange } from './lib/git-range';

/**
 * `npm run mutate:diff -- [range] [--files] [--incremental] [--typecheck]`
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
 *   --typecheck     run the TypeScript checker, so a mutant that would not compile is
 *                   discarded as CompileError instead of counted as killed or survived.
 *                   Off by default because it multiplies the wall time (#172's changed
 *                   lines: about 130s with it, 13s without); a score reported at the end
 *                   of a ticket comes from a full run with it on.
 *
 * When the range ends somewhere other than the checked-out commit (a past PR), the
 * changed lines only make sense in that commit's files, so the run happens in a
 * temporary git worktree at the range's head — with that commit's tests too.
 */

const REPO = process.cwd();
const CONFIG = path.join(REPO, 'stryker.config.mjs');
const STRYKER = path.join(REPO, 'node_modules', '.bin', 'stryker');
const REPORT_DIR = path.join(REPO, 'reports', 'mutation');
/** Stryker's default incremental file, kept in this checkout so a past range's worktree can reuse it. */
const INCREMENTAL_FILE = path.join(REPO, 'reports', 'stryker-incremental.json');
/** stryker.config.mjs's `tsconfigFile`. */
const CHECKER_TSCONFIG = 'tsconfig.stryker.json';

/**
 * The pass mark, on the overall score (no-coverage counts against it): 5 of 8. Applied
 * only from THRESHOLD_MIN_SCORED scored mutants up; below that the per-survivor rule in
 * CLAUDE.md is the only bar. Chosen by the user on 2026-10-22, after the #172 baseline.
 */
const THRESHOLD = 0.625;
const THRESHOLD_MIN_SCORED = 8;

/**
 * Which list a changed file belongs in. One rule, so a source file under src/ always lands
 * in exactly one: `vitest` (mutated) or `browser` (rendered code — a `.tsx` component or a
 * `src/hooks/` hook — which no Vitest test can reach, so it is listed as not mutated).
 * Tests, declarations and anything that is not TypeScript are neither.
 */
function reachedBy(file: string): 'vitest' | 'browser' | null {
    if (!file.startsWith('src/') || file.endsWith('.test.ts') || file.endsWith('.d.ts')) return null;
    if (file.endsWith('.tsx')) return 'browser';
    if (!file.endsWith('.ts')) return null;
    return file.startsWith('src/hooks/') ? 'browser' : 'vitest';
}

function parseArgs(argv: string[]) {
    const { values, positionals } = parseCliArgs({
        args: argv,
        options: {
            files: { type: 'boolean', default: false },
            incremental: { type: 'boolean', default: false },
            typecheck: { type: 'boolean', default: false },
        },
        allowPositionals: true,
    });
    if (positionals.length > 1) throw new Error(`One range at most, got: ${positionals.join(' ')}`);
    return {
        range: positionals[0] ?? DEFAULT_RANGE,
        wholeFiles: values.files,
        incremental: values.incremental,
        typecheck: values.typecheck,
    };
}

/**
 * Set by Ctrl+C. The terminal sends it to Stryker too, which stops on its own; this only
 * notes it, so the run still removes a past range's worktree in its `finally`, then exits
 * 130 (128 + SIGINT) with no score. Without a listener node would die on the spot and
 * leave the worktree behind.
 */
let interrupted = false;
process.on('SIGINT', () => {
    interrupted = true;
});

/**
 * Stryker, waited for without blocking. Under `npm run` this script runs as a child of
 * tsx, which forwards a Ctrl+C and SIGKILLs a child that hasn't acknowledged it within
 * ~60ms; a process blocked in spawnSync can't, and was killed mid-cleanup.
 */
function runStryker(args: string[], cwd: string): Promise<{ status: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(STRYKER, args, { cwd, stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (status, signal) => resolve({ status, signal }));
    });
}

/** A checkout of `range.head` to run in, and how to remove it afterwards. */
function workdirFor(range: ResolvedRange): { dir: string; cleanup: () => void } {
    if (range.atHead) return { dir: REPO, cleanup: () => {} };

    // In the OS temp dir, not under the repo: tsconfig.json includes **/*.ts, so a
    // second copy of src/ inside the repo would be type-checked by every build.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-mutate-'));
    try {
        execFileSync('git', ['worktree', 'add', '--detach', dir, range.head], { stdio: 'ignore' });
    } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw err;
    }
    // `--force` because the worktree holds untracked files: reports, the node_modules
    // symlink (which git unlinks and does not follow).
    const cleanup = () => execFileSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' });

    try {
        // The worktree gets this checkout's installed packages rather than a fresh install.
        fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
        // The checker's tsconfig may postdate the range's head. Its paths are relative, so the
        // copy checks the worktree's src/ and tests/, not this checkout's.
        fs.copyFileSync(path.join(REPO, CHECKER_TSCONFIG), path.join(dir, CHECKER_TSCONFIG));
    } catch (err) {
        cleanup();
        throw err;
    }
    return { dir, cleanup };
}

interface ReportMutant {
    mutatorName: string;
    replacement?: string;
    status: string;
    statusReason?: string;
    location: { start: { line: number; column: number } };
}
interface Report {
    files: Record<string, { mutants: ReportMutant[] }>;
}

/**
 * The score as Stryker defines it, the share of mutants each status took, and the
 * threshold's verdict. Returns false only when the threshold applies and is missed.
 */
function summarise(report: Report): boolean {
    const all = Object.entries(report.files).flatMap(([file, { mutants }]) => mutants.map((m) => ({ file, ...m })));
    const count = (status: string) => all.filter((m) => m.status === status).length;
    const killed = count('Killed');
    const timeout = count('Timeout');
    const survived = count('Survived');
    const noCoverage = count('NoCoverage');
    const detected = killed + timeout;
    const valid = detected + survived + noCoverage;
    const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

    // .github/workflows/mutation.yml reads this block back out of the log: the header, and
    // the lines starting `mutation score:` and `threshold:`. Reword them together.
    console.log('\n── mutate:diff summary ──');
    console.log(`mutants: ${all.length} — killed ${killed}, timeout ${timeout}, survived ${survived}, `
        + `no coverage ${noCoverage}, compile error ${count('CompileError')}, runtime error ${count('RuntimeError')}, `
        + `ignored ${count('Ignored')}`);
    // ignoreStatic (stryker.config.mjs) skips these unscored; say so, so the score's
    // denominator is never quietly smaller than the mutant count. Stryker's reason text is
    // the only signal that tells them apart: a disable comment's mutant is Ignored too, and
    // the report's `static: true` is set on a disabled static mutant as well (Stryker 10,
    // mutants/mutant-test-planner.js). If Stryker rewords the reason, this prints 0.
    const skippedStatic = all.filter((m) => m.status === 'Ignored' && m.statusReason?.startsWith('Static mutant')).length;
    console.log(`static mutants skipped (ignoreStatic): ${skippedStatic}`);
    // The overall score is the threshold number: no-coverage counts against it. The
    // covered score leaves no-coverage out, so it measures only the tests that exist.
    console.log(`mutation score: ${pct(detected, valid)} overall (covered code: ${pct(detected, detected + survived)})`);

    let passed = true;
    if (valid < THRESHOLD_MIN_SCORED) {
        // On a handful of mutants one survivor swings the score by 15+ points, so the
        // percentage says more about luck than about the tests.
        console.log(`threshold: not applied (${valid} scored mutant(s), fewer than ${THRESHOLD_MIN_SCORED}); `
            + 'every survivor is still killed or justified');
    } else {
        passed = detected >= THRESHOLD * valid;
        console.log(`threshold: ${passed ? 'PASS' : 'FAIL'} (${pct(detected, valid)} overall against ${THRESHOLD * 100}%)`);
    }

    const left = all.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');
    if (left.length > 0) {
        console.log('\nNot detected:');
        for (const m of left) {
            const replacement = (m.replacement ?? '').replace(/\s+/g, ' ').slice(0, 60);
            console.log(`  ${m.file}:${m.location.start.line}  ${m.status.padEnd(10)} ${m.mutatorName} → ${replacement}`);
        }
    }
    return passed;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const range = resolveRange(args.range);
    const changed = changedFiles(range);

    // A file whose hunks only delete lines has no line left to mutate (git-range.ts).
    const targets = changed.filter((f) => reachedBy(f.path) === 'vitest' && f.ranges.length > 0);
    const browserOnly = changed.filter((f) => reachedBy(f.path) === 'browser').map((f) => f.path);

    console.log(`range ${args.range}: ${range.base.slice(0, 8)} → ${range.atHead ? 'working tree' : range.head.slice(0, 8)}`);
    if (targets.length === 0) {
        // Matched by .github/workflows/mutation.yml, like the summary block.
        console.log('No changed logic under src/ to mutate.');
    } else {
        const mutate = targets.flatMap((f) =>
            args.wholeFiles ? [f.path] : f.ranges.map(([start, end]) => `${f.path}:${start}-${end}`)
        );
        console.log(`mutating ${args.wholeFiles ? 'whole files' : 'changed lines'}:\n  ${mutate.join('\n  ')}`);

        // Cleared first, so a run that dies before writing its report leaves no report rather
        // than the last run's, which would be summarised below as if it were this one's.
        fs.rmSync(REPORT_DIR, { recursive: true, force: true });

        const { dir, cleanup } = workdirFor(range);
        const started = Date.now();
        let run: Awaited<ReturnType<typeof runStryker>>;
        try {
            const strykerArgs = ['run', CONFIG, '--mutate', mutate.join(',')];
            // Named explicitly so a past range's worktree, deleted below, reads and writes
            // the incremental file in this checkout rather than its own throwaway copy.
            if (args.incremental) strykerArgs.push('--incremental', '--incrementalFile', INCREMENTAL_FILE);
            if (args.typecheck) strykerArgs.push('--checkers', 'typescript');
            run = await runStryker(strykerArgs, dir);

            // Reports land in the run's cwd; a worktree is about to be deleted.
            const worktreeReport = path.join(dir, 'reports', 'mutation');
            if (!range.atHead && fs.existsSync(worktreeReport)) {
                fs.cpSync(worktreeReport, REPORT_DIR, { recursive: true });
            }
        } finally {
            cleanup();
        }
        const seconds = ((Date.now() - started) / 1000).toFixed(0);

        const reportFile = path.join(REPORT_DIR, 'mutation.json');
        if (interrupted) {
            console.log('\ninterrupted: no score');
            process.exitCode = 130;
        } else if (fs.existsSync(reportFile)) {
            const passed = summarise(JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Report);
            console.log(`\nwall time: ${seconds}s · report: ${path.relative(REPO, path.join(REPORT_DIR, 'mutation.html'))}`);
            if (run.status !== 0) process.exitCode = run.status ?? 1;
            else if (!passed) process.exitCode = 1;
        } else {
            // Nothing to summarise, so no score and no verdict: a missing report is a failure.
            console.log(`\nno report: Stryker failed before scoring (exit ${run.status ?? run.signal}) — see its output above`);
            process.exitCode = run.status || 1;
        }
    }

    if (browserOnly.length > 0) {
        console.log(`\nNot mutation-tested (no Vitest test can render them — Playwright territory):\n  ${browserOnly.join('\n  ')}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
