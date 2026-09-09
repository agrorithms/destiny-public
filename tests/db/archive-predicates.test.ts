import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive, readArchiveSeed } from '../helpers/archive-seed';
import { closeArchiveDb } from '@/lib/db/archive';
import {
    getArchiveOverview,
    getTopHelpers,
    getClassDistribution,
    getRunsByYear,
} from '@/lib/db/archive/queries';

/**
 * Pins the Archive's two full-clear rules against each other, and the three data
 * hazards documented in src/lib/db/archive/queries.ts.
 *
 * The fixture is 406 real Runs from the master: nine hazard rows chosen one at a time
 * because each is a case where a plausible-looking query gives the wrong answer, plus
 * nine SQL-defined cohorts sized so Phase 1's panels have a population to count at all.
 * Read `targets` and `cohorts` in tests/fixtures/archive-seed.json, and
 * ./archive-fixture-shape.test.ts for the shape those cohorts are there to guarantee.
 * What makes the pair of rules worth testing together is that
 * neither rule is wrong: the pinned rule reconciles to 10,000 and the disjunctive rule
 * to 10,020 on the real data, and a change that quietly collapses them onto one another
 * still returns a number that looks right.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

describe('the Archive fixture', () => {
    it('is the throwaway file, built from the committed seed', () => {
        const seed = readArchiveSeed();
        expect(seed.tables.gos_10k_runs).toHaveLength(406);
        expect(getArchiveOverview().runs).toBe(406);
    });
});

describe('the two full-clear rules', () => {
    it('disagree by exactly the flag-0 / phase-0 runs after the pin', () => {
        const overview = getArchiveOverview();

        // After the pin, flag 0, phase 0, completed. The disjunctive rule reads phase 0
        // as a fresh start; the pinned rule trusts only the flag once the flag is live.
        // There are 20 such Runs in the whole Archive — the 10,000-vs-10,020 difference —
        // and the fixture carries all 20, so the gap here is that difference itself
        // rather than a sample of it. 14537310174 is the one named in `targets`.
        expect(overview.disjunctiveFullClears - overview.pinnedFullClears).toBe(20);
    });

    it('both exclude the run he did not finish himself', () => {
        const overview = getArchiveOverview();

        // 8249673559 carries is_full_clear = 1 with completed = 0 — the fireteam cleared
        // from the start without him. Dropping the completed conjunct from either rule
        // adds it, which on the real data is a 0.4% error: too small to notice, and the
        // exact reason the conjunct lives inside the named predicate.
        expect(overview.completions).toBe(369);
        expect(overview.pinnedFullClears).toBe(346);
        expect(overview.disjunctiveFullClears).toBe(366);
        // 352 of the 406 Runs carry is_full_clear = 1, and six of those are Runs the
        // fireteam cleared without him. Reading the stored column alone gives 352, not
        // 346 — a 1.7% error here, and a 0.4% one on the real data.
        expect(readArchiveSeed().tables.gos_10k_runs.filter((run) => run.is_full_clear === 1))
            .toHaveLength(352);
    });

    it('count a pre-pin phase-0 run and reject a pre-pin checkpoint run', () => {
        // Before 2022-02-21 no run carries the flag at all, so a rule reading the flag
        // alone would return zero clears for the first two years of the dataset. None of
        // the fixture's 20 Runs in 2020 is flagged, and 8 of them start past phase 0 —
        // the whole Checkpoint Run population, 7072900493 among them. So 11 of the 20 are
        // Pinned Full Clears on the strength of the phase index alone, and a flag-only
        // rule would report 0 for the year.
        expect(getRunsByYear()).toContainEqual({ year: '2020', runs: 20, fullClears: 11 });
    });
});

describe('the data hazards', () => {
    it('counts a helper once per run however many characters they brought', () => {
        const helpers = getTopHelpers(100);

        // 10014833110 has a player with two character rows. COUNT(*) would give them
        // one more run than they played.
        const totalRuns = helpers.reduce((sum, helper) => sum + helper.runs, 0);
        const playerRows = readArchiveSeed().tables.gos_10k_pgcr_players.length;
        expect(totalRuns).toBeLessThan(playerRows);

        for (const helper of helpers) {
            expect(helper.runs).toBeLessThanOrEqual(getArchiveOverview().runs);
            expect(helper.fullClears).toBeLessThanOrEqual(helper.runs);
        }
    });

    it('never renders a name with a missing code as Name#null', () => {
        // 7085305400 carries a player whose bungie_global_display_name_code is NULL.
        for (const helper of getTopHelpers(100)) {
            expect(helper.displayName).not.toContain('#null');
            expect(helper.displayName).not.toContain('undefined');
            expect(helper.displayName.length).toBeGreaterThan(0);
        }
    });

    it('excludes the subject from the helper list', () => {
        const helpers = getTopHelpers(100);
        expect(helpers.some((helper) => helper.membershipId === '4611686018437585442')).toBe(false);
    });

    it('reports a class for every player-run, unknown included', () => {
        const distribution = getClassDistribution();
        const total = distribution.reduce((sum, row) => sum + row.playerRuns, 0);
        expect(total).toBe(readArchiveSeed().tables.gos_10k_pgcr_players.length);
    });
});

describe('a Run is not a completion', () => {
    it('counts runs he abandoned alongside the ones he finished', () => {
        const overview = getArchiveOverview();

        // The 2026-09-03 crawl added 3,397 runs he started and did not complete. Before
        // it, every row in this table was a completion and `AND he completed it` was
        // implicit and free. It is neither now.
        expect(overview.runs).toBeGreaterThan(overview.completions);
    });
});
