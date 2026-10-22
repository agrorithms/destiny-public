import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * What a git range changed, for `mutate:diff`. A module of its own because it is the
 * part of that script with rules worth reading on their own: what a range means, and
 * how hunks become line ranges.
 *
 * A range is `A...B` (B's changes since it left A — the default, `main...HEAD`, is "this
 * branch"), or `A..B` (B against A exactly). To re-run a merged PR, give its merge
 * commit's parents: `<merge>^1...<merge>^2`.
 */

export interface ResolvedRange {
    /** The commit the changes are measured from. */
    base: string;
    /** The commit whose files the changes are in. */
    head: string;
    /**
     * True when `head` is the checked-out commit. The diff is then taken against the
     * working tree instead of `head`, so uncommitted and untracked edits count and line
     * numbers match the files on disk. When false, nothing on disk matches `head`, so
     * mutate:diff runs in a worktree checked out at it.
     */
    atHead: boolean;
}

export interface ChangedFile {
    /** Repo-relative path in `head` (or the working tree). */
    path: string;
    /**
     * 1-based inclusive line ranges added or changed in `path`. A hunk that only deletes
     * lines contributes nothing: there is no line left to point at.
     */
    ranges: Array<[start: number, end: number]>;
}

export const DEFAULT_RANGE = 'main...HEAD';

function git(args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function resolveRange(spec: string): ResolvedRange {
    const match = /^(.+?)(\.{2,3})(.*)$/.exec(spec);
    if (!match) throw new Error(`Not a git range: "${spec}". Expected A...B or A..B (default ${DEFAULT_RANGE}).`);
    const [, left, dots, right] = match;

    const head = git(['rev-parse', '--verify', `${right || 'HEAD'}^{commit}`]);
    // `A...B` measures from where B left A; `A..B` from A itself.
    const base = dots === '...' ? git(['merge-base', left, head]) : git(['rev-parse', '--verify', `${left}^{commit}`]);
    const atHead = head === git(['rev-parse', 'HEAD']);
    return { base, head, atHead };
}

/**
 * Parses `git diff -U0` output into the added/changed line ranges of each surviving file.
 * Exported for tests/scripts/git-range.test.ts: it decides which lines get mutated, and a
 * slip here reads as "no changed logic" rather than as an error.
 */
export function parseZeroContextDiff(diff: string): ChangedFile[] {
    const files: ChangedFile[] = [];
    let current: ChangedFile | null = null;

    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            current = null;
        } else if (line.startsWith('+++ ')) {
            // `+++ /dev/null` is a deleted file: nothing in it to mutate.
            const target = line.slice(4);
            current = target === '/dev/null' ? null : { path: target.replace(/^b\//, ''), ranges: [] };
            if (current) files.push(current);
        } else if (line.startsWith('@@ ') && current) {
            // @@ -a,b +c,d @@ — `d` defaults to 1 when omitted; `d` of 0 is a pure deletion.
            const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
            if (!match) continue;
            const start = Number(match[1]);
            const count = match[2] === undefined ? 1 : Number(match[2]);
            if (count > 0) current.ranges.push([start, start + count - 1]);
        }
    }
    return files;
}

/** Every file the range adds or changes, with the lines it touched. */
export function changedFiles(range: ResolvedRange): ChangedFile[] {
    const diffArgs = ['diff', '-U0', '--no-color', '--no-ext-diff', range.base];
    if (!range.atHead) diffArgs.push(range.head);
    const files = parseZeroContextDiff(git(diffArgs));

    if (range.atHead) {
        // `git diff <base>` against the working tree does not list files git has never
        // seen. A brand-new file not yet `git add`ed is wholly changed.
        const untracked = git(['ls-files', '--others', '--exclude-standard']);
        for (const path of untracked.split('\n').filter(Boolean)) {
            files.push({ path, ranges: [[1, readFileSync(path, 'utf8').split('\n').length]] });
        }
    }
    return files;
}
