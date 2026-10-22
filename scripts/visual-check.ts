import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';

/**
 * `npm run visual:check -- [--nobuild]`
 *
 * Screenshots every page at 360 / 768 / 1280px in light and dark, into
 * visual-check/<route>/<route>--<width>--<theme>.png, and fails if anything on a page
 * overflows the viewport or is clipped by an ancestor (e2e/support/viewport.ts,
 * expectNoOverflow). The screenshots are for review; the overflow check is the gate.
 *
 * Every page, every time: the whole matrix runs in about a minute after the build, so
 * picking pages from a diff's import graph saved too little to be worth being wrong about.
 * e2e/visual.spec.ts finds the pages and says which are skipped and why.
 *
 * Flags:
 *   --nobuild   reuse .next instead of building (wrong if .next is stale, as e2e:nobuild)
 *
 * Runs through `npm run e2e` / `e2e:nobuild`, so it gets that build (with its dummy public
 * key) and the e2e suite's seeded fixture databases, never the dev database.
 */

const REPO = process.cwd();
/** Where e2e/visual.spec.ts writes the screenshots. */
const VISUAL_DIR = path.join(REPO, 'visual-check');

function main(): void {
    const { values } = parseArgs({ options: { nobuild: { type: 'boolean', default: false } } });

    fs.rmSync(VISUAL_DIR, { recursive: true, force: true });
    // VISUAL_CHECK makes playwright.config.ts define the six visual-* projects.
    const run = spawnSync('npm', ['run', values.nobuild ? 'e2e:nobuild' : 'e2e', '--', '--project=visual-*'], {
        stdio: 'inherit',
        env: { ...process.env, VISUAL_CHECK: '1' },
    });

    const shots = fs.existsSync(VISUAL_DIR)
        ? fs.readdirSync(VISUAL_DIR, { recursive: true }).filter((f) => String(f).endsWith('.png')).length
        : 0;
    console.log(`\n${shots} screenshot(s) in ${path.relative(REPO, VISUAL_DIR)}/`);
    process.exit(run.status ?? 1);
}

main();
