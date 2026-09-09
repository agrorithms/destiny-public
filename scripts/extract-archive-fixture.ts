import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { deriveClearNumbers } from '../src/lib/db/archive/derive-clear-number';
import { PINNED_FULL_CLEAR, STARTED_FROM_BEGINNING } from '../src/lib/db/archive/predicates';
import { replayArchiveRows, type ArchiveRow } from '../tests/helpers/archive-replay';

/**
 * Extracts a fixture Archive from the GoS 10k master into
 * tests/fixtures/archive-seed.json, which is committed and loaded into a real SQLite
 * file at test-setup time by tests/helpers/archive-seed.ts.
 *
 * JSON rather than a committed binary .db so it matches the nine PGCR fixtures already
 * in that directory — reviewable in a diff — while still testing real SQL against a
 * real file (ADR 0003).
 *
 * The schema is captured from the master too, so there is no second schema definition
 * that can drift from the one the serving copy has.
 *
 * ## Two ways a row gets in
 *
 * **{@link TARGETS}** are hazard rows, named one at a time with a reason each. They are
 * the original nine-run fixture and none of them may be dropped: a fixture drawn only
 * from clean completions cannot catch the bug this dataset actually produces — a
 * full-clear predicate that forgets "and he finished it" and returns a number 30% high
 * that still looks plausible.
 *
 * **{@link COHORTS}** are SQL-defined slices, each one there because a Phase 1 panel
 * needs a population that no nine rows can express: a 15-clear floor with Helpers on
 * both sides, a median over enough clears to mean anything, monthly buckets including
 * an empty one, and Runs at every participant count. Each cohort states what it is for.
 * The sample is deliberately shaped, not random — see tests/db/archive-fixture-shape.test.ts,
 * which asserts the resulting shape so a careless re-extraction fails loudly instead of
 * quietly leaving every panel test green over a population it no longer contains.
 *
 * Weapon rows are pulled for {@link TARGETS} only. They are Phase 2's data, and taking
 * them for all ~400 sampled Runs would add roughly ten thousand lines to a committed
 * file that every future fixture change has to be read in.
 *
 * The sampled rows are then passed through the *production* derivation — the same
 * deriveClearNumbers() the build script runs — in an in-memory database, and the schema is
 * captured back off that. So the seed carries `clear_number` and its index, and a Clear
 * Number test exercises the shipped ranking instead of a re-implementation of it (ADR 0008).
 * The ordinals are 1..N over the sample, not the instance's real place among the 10,000;
 * the ranking rule is what the fixture is for, not the absolute number.
 *
 *   npm run extract-archive-fixture      # needs the master; regenerate and commit
 */

const MASTER_PATH = process.env.GOS10K_MASTER_DB_PATH
    ? path.resolve(process.env.GOS10K_MASTER_DB_PATH)
    : path.join(process.cwd(), 'gos10k', 'destiny_pgcrs.db');

const OUTPUT_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'archive-seed.json');

/** The pin instant. See PINNED_FULL_CLEAR in src/lib/db/archive/predicates.ts. */
const PIN_INSTANCE_ID = 10141395454;

/**
 * The months the {@link COHORTS} spine samples from, inclusive.
 *
 * Chosen for two properties the timeline needs and nothing else can supply: it is a
 * dense grinding stretch, so a handful of Helpers accumulate well past a 15-clear
 * floor while the drop-ins stay below it; and **2022-03 is absent from the master
 * entirely**, so the sampled era contains a genuinely empty monthly bucket in the
 * middle of a busy run rather than at an edge where it could be mistaken for the end
 * of the data.
 */
const SPINE_FIRST_MONTH = '2021-12';
const SPINE_LAST_MONTH = '2022-08';

/** Pinned Full Clears taken per spine month. 40 × 8 months ≈ 320 Runs. */
const SPINE_RUNS_PER_MONTH = 40;

interface Target {
    instanceId: string;
    why: string;
}

const TARGETS: Target[] = [
    {
        instanceId: '10141395454',
        why: 'The pin itself: 2022-02-21, phase 0, flag 0, completed. Counted by both full-clear rules — the pinned one because it is at or before the pin and phase 0.',
    },
    {
        instanceId: '7072900493',
        why: 'Before the pin, phase 5, completed. A checkpoint run that predates the flag; counted by neither rule. Pins that "no flag" is not read as "full clear".',
    },
    {
        instanceId: '14874351447',
        why: 'After the pin, flag 1, completed. The ordinary full clear, counted by both rules.',
    },
    {
        instanceId: '14537310174',
        why: 'After the pin, flag 0 but phase 0, completed. THE case that separates the two rules: the disjunctive rule counts it, the pinned rule does not. This row is the whole 10,000-vs-10,020 difference in miniature.',
    },
    {
        instanceId: '8249673559',
        why: 'is_full_clear = 1 with completed = 0 — one of the 40 runs the fireteam cleared from the start without him. A predicate that drops the completed conjunct counts this and is wrong by a margin small enough to look right.',
    },
    {
        instanceId: '10014833110',
        why: 'A player brought more than one character. Any count over gos_10k_pgcr_players that is not COUNT(DISTINCT instance_id) inflates on this row.',
    },
    {
        instanceId: '7085305400',
        why: 'Carries a player with a NULL bungie_global_display_name_code. Formatting must fall back rather than render "Name#null".',
    },
    {
        instanceId: '14874226958',
        why: 'source = get_activity_history_unfiltered, completed = 0 — a run he started and abandoned. The population that only exists after the 2026-09-03 crawl; a Run is not a completion.',
    },
    {
        instanceId: '14874038172',
        why: 'A second unfiltered incomplete run, so aggregates over the abandoned population are not a single row.',
    },
];

interface Cohort {
    name: string;
    why: string;
    /** Yields one `instance_id` column. Must be deterministically ordered and bounded. */
    sql: string;
}

/**
 * Distinct people who entered a Run, per Run, over the Pinned Full Clears. The
 * participant buckets are counted this way everywhere — distinct memberships, never
 * player rows, because 217 (instance, player) pairs carry more than one character.
 */
const CLEAR_PARTICIPANT_COUNTS = `
    SELECT r.instance_id AS instance_id, r.period AS period,
           COUNT(DISTINCT p.membership_id) AS participants
    FROM gos_10k_runs r
    JOIN gos_10k_pgcr_players p ON p.instance_id = r.instance_id
    WHERE ${PINNED_FULL_CLEAR}
    GROUP BY r.instance_id
`;

const COHORTS: Cohort[] = [
    {
        name: 'spine',
        why: `Up to ${SPINE_RUNS_PER_MONTH} Pinned Full Clears from each month of ${SPINE_FIRST_MONTH}..${SPINE_LAST_MONTH}. The bulk of the fixture, and the only cohort large enough to give the Helper boards a 15-clear floor with people on both sides of it and a median over a meaningful number of clears. 2022-03 has no Runs in the master, so the era carries an empty monthly bucket in its middle.`,
        sql: `
            SELECT instance_id FROM (
                SELECT r.instance_id AS instance_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY strftime('%Y-%m', r.period, 'unixepoch')
                           ORDER BY r.period, r.instance_id
                       ) AS rn
                FROM gos_10k_runs r
                WHERE ${PINNED_FULL_CLEAR}
                  AND strftime('%Y-%m', r.period, 'unixepoch')
                      BETWEEN '${SPINE_FIRST_MONTH}' AND '${SPINE_LAST_MONTH}'
            ) WHERE rn <= ${SPINE_RUNS_PER_MONTH}
        `,
    },
    {
        name: 'duo-clears',
        why: 'All four duo Pinned Full Clears in the Archive. They are the rarest participant bucket and the one #94 headlines alongside the trios; none of them falls inside the spine era, so without this cohort the bucket would be empty.',
        sql: `SELECT instance_id FROM (${CLEAR_PARTICIPANT_COUNTS}) WHERE participants = 2`,
    },
    {
        name: 'trio-clears',
        why: 'The six earliest trio Pinned Full Clears. The most impressive population statistic in the dataset, and the bucket #94 calls out.',
        sql: `SELECT instance_id FROM (${CLEAR_PARTICIPANT_COUNTS}) WHERE participants = 3 ORDER BY period, instance_id LIMIT 6`,
    },
    {
        name: 'undermanned-clears',
        why: 'Up to three of each of the four- and five-participant Pinned Full Clears, so no bucket between duo and six is empty and a bucketing that collapses the middle is visible. Taken per participant count rather than as one LIMIT over both: the master holds exactly four four-participant clears today, and a flat limit would quietly empty the five bucket the day a fifth appeared.',
        sql: `
            SELECT instance_id FROM (
                SELECT instance_id, participants,
                       ROW_NUMBER() OVER (PARTITION BY participants ORDER BY period, instance_id) AS rn
                FROM (${CLEAR_PARTICIPANT_COUNTS})
                WHERE participants IN (4, 5)
            ) WHERE rn <= 3
        `,
    },
    {
        name: 'crowded-clears',
        why: 'The earliest six Pinned Full Clears with seven or more distinct participants — people left and were replaced. The bucket exists to stop the column being read as fireteam size.',
        sql: `SELECT instance_id FROM (${CLEAR_PARTICIPANT_COUNTS}) WHERE participants >= 7 ORDER BY period, instance_id LIMIT 6`,
    },
    {
        name: 'resets',
        why: 'Up to three Runs per spine month that he started from the first encounter and nobody finished. #93 reports how many there were and how long they lasted; a fixture with none would make both figures untestable. Not the negation of is_full_clear — that column folds in "somebody completed".',
        sql: `
            SELECT instance_id FROM (
                SELECT r.instance_id AS instance_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY strftime('%Y-%m', r.period, 'unixepoch')
                           ORDER BY r.period, r.instance_id
                       ) AS rn
                FROM gos_10k_runs r
                WHERE ${STARTED_FROM_BEGINNING} AND r.completed = 0 AND r.is_full_clear = 0
                  AND strftime('%Y-%m', r.period, 'unixepoch')
                      BETWEEN '${SPINE_FIRST_MONTH}' AND '${SPINE_LAST_MONTH}'
            ) WHERE rn <= 3
        `,
    },
    {
        name: 'cleared-without-him',
        why: 'Six of the 40 Runs his fireteam cleared from the start without him. One of them is already a target; the rest are here so an aggregate over this population is not a single row, and so dropping the completed conjunct is wrong by a visible margin rather than by one.',
        sql: 'SELECT instance_id FROM gos_10k_runs r WHERE r.is_full_clear = 1 AND r.completed = 0 ORDER BY r.period, r.instance_id LIMIT 6',
    },
    {
        // #85 calls this population "pre-pin clears". It is not: every one of these Runs
        // is *after* the pin, and what makes them look pre-pin is that they carry phase 0
        // with the flag unset, which is the shape the pin exists to stop trusting. Named
        // for the rule that counts them rather than for the ticket's wording.
        name: 'disjunctive-only-clears',
        why: 'All 20 Runs after the pin that carry phase 0 with the flag unset and completed — the entire population the disjunctive rule counts and the pinned rule does not. Taking all of them means the two rules differ in the fixture by exactly the rows they differ by in production. #85 calls these "pre-pin clears"; they are post-pin, and only resemble pre-pin Runs.',
        sql: `
            SELECT r.instance_id FROM gos_10k_runs r
            WHERE r.starting_phase_index = 0
              AND COALESCE(r.activity_was_started_from_beginning, 0) = 0
              AND r.completed = 1
              AND r.period > (SELECT period FROM gos_10k_runs WHERE instance_id = '${PIN_INSTANCE_ID}')
        `,
    },
    {
        name: 'checkpoint-runs',
        why: 'All 8 Checkpoint Runs in the Archive — he joined partway through. There are only 8 in 13,420, which is itself the fact #93 reports, so the whole population fits and nothing has to be sampled.',
        sql: `
            SELECT r.instance_id FROM gos_10k_runs r
            WHERE r.starting_phase_index > 0
              AND COALESCE(r.activity_was_started_from_beginning, 0) = 0
        `,
    },
];

/** A cohort as the seed records it: what it was for, and how many Runs it brought. */
type SelectedCohort = Omit<Cohort, 'sql'> & { runs: number };

/** The committed seed's shape, as {@link serializeSeed} writes it. */
interface ArchiveSeedFile {
    generatedAt: string;
    generatedBy: string;
    source: string;
    pinInstanceId: string;
    targets: Target[];
    cohorts: SelectedCohort[];
    schema: string[];
    tables: Record<string, unknown[]>;
}

const TABLES = ['gos_10k_runs', 'gos_10k_pgcr_players', 'gos_10k_pgcr_weapons'] as const;

function readSchema(db: Database.Database, tables: readonly string[]): string[] {
    return (db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE sql IS NOT NULL AND tbl_name IN (${tables.map(() => '?').join(', ')})
        ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name
    `).all(...tables) as Array<{ sql: string }>).map((row) => row.sql);
}

/**
 * Replays the sampled rows into an in-memory database, derives, and reads both the rows
 * and the schema back out. In-memory because there is nothing to keep: the artifact is
 * the JSON, and a temp file on disk would be one more thing to clean up after a throw.
 */
function deriveSample(
    schema: string[],
    tables: Record<string, unknown[]>
): { schema: string[]; tables: Record<string, unknown[]> } {
    // Replayed through the same helper tests/helpers/archive-seed.ts uses to rebuild the
    // committed result, so the two ends of the round trip cannot disagree about how a row
    // becomes SQL.
    const db = new Database(':memory:');
    replayArchiveRows(db, schema, tables as Record<string, ArchiveRow[]>);

    deriveClearNumbers(db);

    const derivedTables: Record<string, unknown[]> = {};
    for (const table of Object.keys(tables)) {
        derivedTables[table] = db.prepare(`SELECT * FROM ${table} ORDER BY instance_id`).all();
    }
    const derivedSchema = readSchema(db, Object.keys(tables));
    db.close();

    return { schema: derivedSchema, tables: derivedTables };
}

/**
 * JSON with the envelope indented and every data row on one line.
 *
 * `JSON.stringify(seed, null, 4)` would spread ~2,500 player rows over ~70,000 lines,
 * and a committed fixture nobody can read the diff of is a fixture that changes without
 * being reviewed. One row per line keeps the whole file around the size the nine-run
 * seed already was, and makes an added or removed Run exactly one line of diff.
 */
function serializeSeed({ tables, ...envelope }: ArchiveSeedFile): string {
    const entries = Object.entries(envelope).map(([key, value]) => {
        const rendered = JSON.stringify(value, null, 4).split('\n').join('\n    ');
        return `    ${JSON.stringify(key)}: ${rendered}`;
    });

    const tableBlocks = Object.entries(tables).map(([table, rows]) => {
        if (rows.length === 0) return `        ${JSON.stringify(table)}: []`;
        const lines = rows.map((row) => `            ${JSON.stringify(row)}`).join(',\n');
        return `        ${JSON.stringify(table)}: [\n${lines}\n        ]`;
    });
    entries.push(`    "tables": {\n${tableBlocks.join(',\n')}\n    }`);

    return `{\n${entries.join(',\n')}\n}\n`;
}

function main(): void {
    if (!fs.existsSync(MASTER_PATH)) {
        throw new Error(`No master at ${MASTER_PATH}. Set GOS10K_MASTER_DB_PATH to point elsewhere.`);
    }

    const db = new Database(MASTER_PATH, { readonly: true, fileMustExist: true });

    // Captured, not hand-written: the fixture's schema is the master's schema by
    // construction, so it cannot drift from what the serving copy actually has.
    const schema = readSchema(db, TABLES);

    const targetIds = TARGETS.map((target) => target.instanceId);
    const selected = new Set<string>(targetIds);
    const cohortSizes: SelectedCohort[] = [];

    for (const cohort of COHORTS) {
        const ids = (db.prepare(cohort.sql).all() as Array<{ instance_id: string }>)
            .map((row) => row.instance_id);
        if (ids.length === 0) {
            throw new Error(`Cohort "${cohort.name}" selected no Runs. The master or the cohort is wrong.`);
        }
        for (const id of ids) selected.add(id);
        cohortSizes.push({ name: cohort.name, why: cohort.why, runs: ids.length });
    }

    // Sorted so the committed file's row order is a property of the sample, not of the
    // order the cohorts happened to run in.
    const ids = [...selected].sort();
    const placeholders = ids.map(() => '?').join(', ');

    const tables: Record<string, unknown[]> = {
        gos_10k_runs: db.prepare(
            `SELECT * FROM gos_10k_runs WHERE instance_id IN (${placeholders}) ORDER BY instance_id`
        ).all(...ids),
        gos_10k_pgcr_players: db.prepare(
            `SELECT * FROM gos_10k_pgcr_players WHERE instance_id IN (${placeholders}) ORDER BY instance_id, character_id`
        ).all(...ids),
        // Targets only — see the header. The weapon table stays populated (the FK to
        // the player rows still resolves, because every target is in the sample) without
        // the fixture growing a table Phase 1 does not read.
        gos_10k_pgcr_weapons: db.prepare(
            `SELECT * FROM gos_10k_pgcr_weapons
             WHERE instance_id IN (${targetIds.map(() => '?').join(', ')})
             ORDER BY instance_id, character_id, weapon_hash`
        ).all(...targetIds),
    };

    const missing = targetIds.filter(
        (id) => !(tables.gos_10k_runs as Array<{ instance_id: string }>).some((r) => r.instance_id === id)
    );
    if (missing.length > 0) {
        throw new Error(`Not in the master: ${missing.join(', ')}. The targets are stale.`);
    }

    db.close();

    // The build script's derivation, over the sample, in memory. Reading the schema back
    // off this database rather than off the master is what puts `clear_number` and its
    // index into the seed's DDL, so tests/helpers/archive-seed.ts needs no knowledge of
    // either.
    const derived = deriveSample(schema, tables);

    const seed: ArchiveSeedFile = {
        generatedAt: new Date().toISOString(),
        generatedBy: 'scripts/extract-archive-fixture.ts',
        source: path.relative(process.cwd(), MASTER_PATH),
        pinInstanceId: String(PIN_INSTANCE_ID),
        targets: TARGETS,
        cohorts: cohortSizes,
        schema: derived.schema,
        tables: derived.tables,
    };

    fs.writeFileSync(OUTPUT_PATH, serializeSeed(seed));

    console.log(`📝 ${path.relative(process.cwd(), OUTPUT_PATH)}`);
    for (const cohort of cohortSizes) {
        console.log(`   ${cohort.name.padEnd(24)} ${String(cohort.runs).padStart(5)} runs selected`);
    }
    for (const table of TABLES) {
        console.log(`   ${table.padEnd(24)} ${String(derived.tables[table].length).padStart(5)} rows`);
    }
    const clears = (derived.tables.gos_10k_runs as Array<{ clear_number: number | null }>)
        .filter((run) => run.clear_number !== null).length;
    console.log(`   ${'clear_number'.padEnd(24)} ${String(clears).padStart(5)} runs ranked`);
}

main();
