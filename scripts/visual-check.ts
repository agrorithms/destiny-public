import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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
 *
 * Flags:
 *   --nobuild   reuse .next instead of building (wrong if .next is stale, as e2e:nobuild)
 *
 * Runs against the e2e suite's seeded fixture databases, never the dev database.
 * /admin/stats is skipped: it sits behind basic auth.
 */

const REPO = process.cwd();
const APP = path.join('src', 'app');
const VISUAL_DIR = path.join(REPO, 'visual-check');

/** Where a dynamic route points in the e2e seed world (e2e/support/seed-world.ts). */
const DYNAMIC_ROUTE_FIXTURES: Record<string, string> = {
    // FixtureAlpha#4242 in LEADERBOARD_PLAYERS: seeded with clears, so the page has content.
    '/player/[membershipType]/[membershipId]': '/player/3/4611686018400010001',
};

const SKIPPED_ROUTES = new Set(['/admin/stats']);

interface Route {
    /** Folder- and filename-safe name: `home`, `active-sessions`, `player`. */
    slug: string;
    path: string;
}

function findPages(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) findPages(full, found);
        else if (entry.name === 'page.tsx') found.push(full);
    }
    return found;
}

function allRoutes(): Route[] {
    const routes: Route[] = [];
    for (const page of findPages(APP)) {
        const pattern = '/' + path.relative(APP, path.dirname(page)).split(path.sep).filter(Boolean).join('/');
        if (pattern.startsWith('/api') || SKIPPED_ROUTES.has(pattern)) continue;

        let url = pattern;
        if (pattern.includes('[')) {
            url = DYNAMIC_ROUTE_FIXTURES[pattern];
            if (!url) throw new Error(`No fixture URL for ${pattern}; add one to DYNAMIC_ROUTE_FIXTURES.`);
        }
        const slug = pattern === '/' ? 'home' : pattern.split('/').filter((s) => s && !s.startsWith('[')).join('-');
        routes.push({ slug, path: url });
    }
    return routes.sort((a, b) => a.slug.localeCompare(b.slug));
}

function parseArgs(argv: string[]) {
    const known = new Set(['--nobuild']);
    for (const arg of argv) {
        if (!known.has(arg)) throw new Error(`Unknown argument ${arg}. Known: ${[...known].join(', ')}`);
    }
    return { build: !argv.includes('--nobuild') };
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const routes = allRoutes();
    console.log(`pages:\n  ${routes.map((r) => r.path).join('\n  ')}`);

    if (args.build) {
        // The same dummy public key `npm run e2e` pins: Next inlines NEXT_PUBLIC_* at build
        // time, and client code throws on a missing key before the Bungie stub can answer.
        const build = spawnSync('npm', ['run', 'next-build'], {
            stdio: 'inherit',
            env: { ...process.env, NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY: 'e2e-not-a-real-bungie-key' },
        });
        if (build.status !== 0) process.exit(build.status ?? 1);
    }

    fs.rmSync(VISUAL_DIR, { recursive: true, force: true });
    const projects = [360, 768, 1280].flatMap((w) => [`--project=visual-${w}-light`, `--project=visual-${w}-dark`]);
    const run = spawnSync('npx', ['playwright', 'test', ...projects], {
        stdio: 'inherit',
        env: { ...process.env, VISUAL_ROUTES: JSON.stringify(routes) },
    });

    const shots = fs.existsSync(VISUAL_DIR)
        ? fs.readdirSync(VISUAL_DIR, { recursive: true }).filter((f) => String(f).endsWith('.png')).length
        : 0;
    console.log(`\n${shots} screenshot(s) in ${path.relative(REPO, VISUAL_DIR)}/`);
    process.exit(run.status ?? 1);
}

main();
