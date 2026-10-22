import { describe, expect, it } from 'vitest';
import { parseZeroContextDiff } from '../../scripts/lib/git-range';

/**
 * How `npm run mutate:diff` turns a diff into the lines Stryker mutates
 * (scripts/lib/git-range.ts). Nothing else checks this: mutate:diff only mutates src/, so
 * Stryker never reaches scripts/, and a parsing slip would not error — it would mutate the
 * wrong lines, or none, and the run would read "No changed logic under src/ to mutate."
 *
 * Under tests/ rather than next to the script because Vitest's `include` covers only
 * src/ and tests/.
 *
 * The input is real `git diff -U0 --no-color` output, captured from a scratch repo with one
 * edit of each kind, not written by hand: the parser's job is git's format, so the test
 * should be too.
 */
const DIFF = `diff --git a/a.ts b/a.ts
index c4352f8..2dd1f1b 100644
--- a/a.ts
+++ b/a.ts
@@ -3 +3 @@ line 2
-line 3
+changed 3
@@ -10,0 +11,2 @@ line 10
+added A
+added B
@@ -15,2 +16,0 @@ line 14
-line 15
-line 16
@@ -20 +20 @@ line 19
-line 20
+changed 20
diff --git a/brand-new.ts b/brand-new.ts
new file mode 100644
index 0000000..5804e55
--- /dev/null
+++ b/brand-new.ts
@@ -0,0 +1,3 @@
+n1
+n2
+n3
diff --git a/del.ts b/del.ts
deleted file mode 100644
index 8a1218a..0000000
--- a/del.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-1
-2
-3
-4
-5
diff --git a/gone.ts b/gone.ts
index 04df23a..f78243d 100644
--- a/gone.ts
+++ b/gone.ts
@@ -4,2 +3,0 @@ keep 3
-keep 4
-keep 5
diff --git a/old-name.ts b/new-name.ts
similarity index 95%
rename from old-name.ts
rename to new-name.ts
index 949ef0a..aa64948 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -5 +5 @@ r 4
-r 5
+r five
`;

describe('reading a zero-context diff into changed line ranges', () => {
    const files = parseZeroContextDiff(DIFF);
    const rangesOf = (path: string) => files.find((f) => f.path === path)?.ranges;

    it('gives each hunk of a file its own range, in the new file\'s line numbers', () => {
        // Line 3 changed, two lines added after 10 (now 11–12), line 20 changed. The
        // deletion of 15–16 in between adds nothing.
        expect(rangesOf('a.ts')).toEqual([[3, 3], [11, 12], [20, 20]]);
    });

    it('reads a hunk with no ",count" as one line', () => {
        // `@@ -3 +3 @@` — git leaves the count out when it is 1.
        expect(rangesOf('a.ts')?.[0]).toEqual([3, 3]);
    });

    it('lists a file whose hunks only delete lines, with no range: no line is left to mutate', () => {
        expect(rangesOf('gone.ts')).toEqual([]);
    });

    it('takes a new file as wholly changed', () => {
        expect(rangesOf('brand-new.ts')).toEqual([[1, 3]]);
    });

    it('drops a deleted file', () => {
        expect(rangesOf('del.ts')).toBeUndefined();
    });

    it('names a renamed file by its new path, with the lines edited after the rename', () => {
        expect(rangesOf('new-name.ts')).toEqual([[5, 5]]);
        expect(rangesOf('old-name.ts')).toBeUndefined();
    });

    it('lists exactly the files that survive the diff', () => {
        expect(files.map((f) => f.path)).toEqual(['a.ts', 'brand-new.ts', 'gone.ts', 'new-name.ts']);
    });
});
