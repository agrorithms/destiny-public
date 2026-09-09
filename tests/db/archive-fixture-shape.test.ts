import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureArchive, readArchiveSeed } from '../helpers/archive-seed';
import { closeArchiveDb, getArchiveDb } from '@/lib/db/archive';
import { SUBJECT_MEMBERSHIP_ID } from '@/lib/db/archive/queries';

/**
 * The fixture's *shape*, as opposed to any query's answer.
 *
 * Phase 1's panels each need a population the fixture has to actually contain — a
 * 15-clear floor with Helpers on both sides of it, a median over enough clears to
 * mean anything, monthly buckets including an empty one, and Runs at every
 * participant count from duo to seven-plus. None of that is visible in the diff of a
 * 400-Run seed, and all of it is one careless re-extraction away from vanishing: a
 * sample redrawn from clean six-player clears would leave every panel test below
 * green and every panel untested.
 *
 * So this file asserts the sample rather than the SQL. It is the executable half of
 * the extraction script's `COHORTS` comments — when it fails, the fix is in
 * scripts/extract-archive-fixture.ts, not in a query.
 *
 * Figures are exact wherever the sample is deterministic, because "at least three
 * trios" is a threshold a re-extraction can satisfy while quietly dropping the four
 * duos. Where a figure is genuinely a floor — 15-clear Helpers exist on both sides —
 * it is written as one and the reason is stated.
 */

beforeAll(() => {
    // Build before the first getArchiveDb(): the connection is a per-process singleton,
    // so a rebuild under an open handle would leave the old snapshot in memory.
    closeArchiveDb();
    buildFixtureArchive();
});

function scalar(sql: string): number {
    return (getArchiveDb().prepare(sql).get() as { n: number }).n;
}

describe('the widened fixture', () => {
    it('holds hundreds of Runs, most of them Pinned Full Clears', () => {
        expect(scalar('SELECT COUNT(*) AS n FROM gos_10k_runs')).toBe(406);
        expect(scalar(
            'SELECT COUNT(*) AS n FROM gos_10k_runs r WHERE r.is_full_clear = 1 AND r.completed = 1'
        )).toBe(346);
        // The Clear Numbers are 1..346 over the sample, not the instance's real place
        // among the 10,000 — the ranking rule is what the fixture is for.
        expect(scalar('SELECT COALESCE(MAX(clear_number), 0) AS n FROM gos_10k_runs')).toBe(346);
    });

    it('keeps every hazard row the narrow seed carried', () => {
        const seed = readArchiveSeed();
        const present = new Set(seed.tables.gos_10k_runs.map((run) => String(run.instance_id)));

        // Read `targets` in the seed for what each one is for. A widened sample that
        // drops one of these loses a test that still looks like it passes.
        expect(seed.targets).toHaveLength(9);
        for (const target of seed.targets) {
            expect(present.has(target.instanceId)).toBe(true);
        }
    });
});

describe('the populations Phase 1 panels count', () => {
    it('carries every non-clear population, not only the clears', () => {
        // #93's Resets panel is about these three, and the participants panel is about a
        // population that is not the clears either. A sample of clears alone would leave
        // all of them unexercised.
        expect(scalar(`
            SELECT COUNT(*) AS n FROM gos_10k_runs r
            WHERE (r.activity_was_started_from_beginning = 1 OR r.starting_phase_index = 0)
              AND r.completed = 0 AND r.is_full_clear = 0
        `)).toBe(26);   // 24 from the cohort, plus the two abandoned-run hazard targets.
        expect(scalar(
            'SELECT COUNT(*) AS n FROM gos_10k_runs r WHERE r.is_full_clear = 1 AND r.completed = 0'
        )).toBe(6);
        // Post-pin, flag 0, phase 0, completed: the 20 Runs the disjunctive rule counts
        // and the pinned rule does not. All 20 of them are here, so the two rules differ
        // in the fixture by the same rows they differ by in production.
        expect(scalar(`
            SELECT COUNT(*) AS n FROM gos_10k_runs r
            WHERE r.starting_phase_index = 0 AND COALESCE(r.activity_was_started_from_beginning, 0) = 0
              AND r.completed = 1
              AND r.period > (SELECT period FROM gos_10k_runs WHERE instance_id = '10141395454')
        `)).toBe(20);
        // Checkpoint Runs — he joined partway. There are 8 in the whole Archive and all 8
        // are here; the term barely applies to this dataset, which is itself the point.
        expect(scalar(`
            SELECT COUNT(*) AS n FROM gos_10k_runs r
            WHERE r.starting_phase_index > 0 AND COALESCE(r.activity_was_started_from_beginning, 0) = 0
        `)).toBe(8);
    });

    it('spans every participant bucket from duo to seven-plus', () => {
        const buckets = getArchiveDb().prepare(`
            SELECT CASE WHEN n >= 7 THEN '7+' ELSE CAST(n AS TEXT) END AS bucket, COUNT(*) AS runs
            FROM (
                SELECT r.instance_id, COUNT(DISTINCT p.membership_id) AS n
                FROM gos_10k_runs r
                JOIN gos_10k_pgcr_players p ON p.instance_id = r.instance_id
                WHERE r.is_full_clear = 1 AND r.completed = 1
                GROUP BY r.instance_id
            )
            GROUP BY bucket ORDER BY bucket
        `).all() as Array<{ bucket: string; runs: number }>;

        // The buckets #94's participants panel renders. Six is the overwhelming majority
        // here as it is in production; the interesting rows are the ones that are not.
        expect(buckets).toEqual([
            { bucket: '2', runs: 4 },
            { bucket: '3', runs: 7 },
            { bucket: '4', runs: 4 },
            { bucket: '5', runs: 2 },
            { bucket: '6', runs: 307 },
            { bucket: '7+', runs: 22 },
        ]);
    });
});

describe('the shapes the Helper boards need', () => {
    it('has Helpers on both sides of a 15-clear floor', () => {
        // #92's median speed board requires 15 clears within the active range. A fixture
        // whose best Helper had 9 would make the board empty and the floor untestable;
        // one where every Helper cleared the floor would never exercise the exclusion.
        const bands = getArchiveDb().prepare(`
            SELECT clears >= 15 AS above, COUNT(*) AS helpers
            FROM (
                SELECT p.membership_id, COUNT(DISTINCT p.instance_id) AS clears
                FROM gos_10k_pgcr_players p
                JOIN gos_10k_runs r ON r.instance_id = p.instance_id
                WHERE r.is_full_clear = 1 AND r.completed = 1 AND p.membership_id <> ?
                GROUP BY p.membership_id
            )
            GROUP BY above
        `).all(SUBJECT_MEMBERSHIP_ID) as Array<{ above: number; helpers: number }>;

        expect(bands).toEqual([
            { above: 0, helpers: 354 },
            { above: 1, helpers: 28 },
        ]);
    });

    it('gives its busiest Helper enough clears for a median to mean something', () => {
        expect(scalar(`
            SELECT MAX(clears) AS n FROM (
                SELECT COUNT(DISTINCT p.instance_id) AS clears
                FROM gos_10k_pgcr_players p
                JOIN gos_10k_runs r ON r.instance_id = p.instance_id
                WHERE r.is_full_clear = 1 AND r.completed = 1
                  AND p.membership_id <> '${SUBJECT_MEMBERSHIP_ID}'
                GROUP BY p.membership_id
            )
        `)).toBeGreaterThanOrEqual(60);
    });
});

describe('the shape the timeline needs', () => {
    it('covers many months and leaves one inside the dense era empty', () => {
        const months = getArchiveDb().prepare(`
            SELECT strftime('%Y-%m', period, 'unixepoch') AS month, COUNT(*) AS runs
            FROM gos_10k_runs GROUP BY month ORDER BY month
        `).all() as Array<{ month: string; runs: number }>;

        expect(months).toHaveLength(27);
        // 2021-12 through 2022-08 is the sampled dense era, and 2022-03 is absent from
        // the master entirely — a real empty bucket in the middle of a busy stretch,
        // which is the case #88's monthly bars must render rather than skip.
        expect(months.map((month) => month.month)).toContain('2022-02');
        expect(months.map((month) => month.month)).toContain('2022-04');
        expect(months.map((month) => month.month)).not.toContain('2022-03');
    });
});

describe('the fixture stays reviewable', () => {
    it('carries weapon rows for the hazard Runs only', () => {
        // Weapons are Phase 2's. Pulling their rows for all 406 sampled Runs would add
        // roughly ten thousand lines to a committed file every future fixture change has
        // to be read in. The nine hazard Runs keep theirs so the table is not empty.
        const seed = readArchiveSeed();
        const armed = new Set(seed.tables.gos_10k_pgcr_weapons.map((row) => String(row.instance_id)));
        const targets = new Set(seed.targets.map((target) => target.instanceId));

        expect(armed.size).toBeGreaterThan(0);
        for (const instanceId of armed) {
            expect(targets.has(instanceId)).toBe(true);
        }
    });
});
