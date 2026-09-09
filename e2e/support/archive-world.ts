import Database from 'better-sqlite3';
import { buildFixtureArchive, readArchiveSeed } from '../../tests/helpers/archive-seed';
import { replayArchiveRows } from '../../tests/helpers/archive-replay';
import { fixtureArchiveDbPath, fixtureRunId } from './fixture-db';

/**
 * The fixture Archive every /gos10k spec asserts against, plus the canary that
 * proves the running server actually opened it.
 *
 * The file is built by the *shared* loader in tests/helpers/archive-seed.ts —
 * unmodified, and deliberately so: the same committed seed and the same replay
 * path back both runners, so a fixture that drifts drifts for both at once.
 *
 * The canary is added here rather than in that loader because the Vitest
 * Archive must stay byte-deterministic. tests/db/archive-clear-number.test.ts
 * asserts exact ordinals and getArchiveOverview() counts helpers; a per-run
 * nonce in the shared seed would make those assertions depend on which runner
 * built the file. So the e2e Archive is knowingly *not* identical to the Vitest
 * one — it carries one extra helper — and that difference lives on this side of
 * the fence where it can be read.
 *
 * ## The read-only wrinkle, and why it is smaller than it looks
 *
 * The Tracker's canary is a row written into a database the app also writes to.
 * The Archive is opened `readonly` by getArchiveDb(), so the obvious reading is
 * that it cannot carry a canary and the mechanism has to be replaced.
 *
 * It does not. `readonly` is a property of the *app's* connection, not of the
 * file: this module mints the file before the server boots and opens it
 * read-write to do so, exactly as buildFixtureArchive() already does. So the
 * Tracker's mechanism transfers unchanged — a per-run nonce baked into a row,
 * observed back through the running server. Nothing about the Archive's
 * read-only posture is weakened, because the app's connection is still readonly
 * and still `fileMustExist`.
 *
 * What was rejected: proving the binding by asserting a fixture-only *magnitude*
 * ("406 runs entered" against production's 13,420). That has no nonce, so a server
 * left over from an earlier e2e run holds an equally valid 406-run fixture and the
 * check passes green against the wrong database. The nonce is the whole point of
 * the Tracker's canary and it survives the move.
 */

/** Sorts before every real Bungie membership id (they all start `4611686018…`),
 *  so the canary wins getTopHelpers' `ORDER BY runs DESC, fullClears DESC,
 *  membershipId` tiebreak rather than landing wherever the data puts it. */
const CANARY_MEMBERSHIP_ID = '0000000000000000001';
const CANARY_CHARACTER_ID = '0000000000000000002';
const CANARY_CODE = 9999;

/** The bare global display name, carrying this run's nonce. Not exported: the
 *  Archive's canary is only ever matched in rendered HTML, as `Name#Code`. */
function archiveCanaryName(): string {
    return `Gos10kCanary${fixtureRunId()}`;
}

/** `Name#Code` as formatBungieDisplayName renders it into the Helper board. */
export function archiveCanaryDisplayName(): string {
    return `${archiveCanaryName()}#${CANARY_CODE}`;
}

/**
 * Builds the fixture Archive at the minted path and adds the canary helper.
 *
 * The canary is joined to *every* Run in the seed. The fixture has 553 distinct
 * helpers and the page renders getTopHelpers(25), so a canary on one Run would
 * not rank and the check would fail for a reason unrelated to the binding.
 * Joined to all of them it holds the maximum possible `runs` — 406, comfortably
 * clear of the busiest real Helper's 97 — and the membership id above settles any
 * tie, so the canary is deterministically the first row of the Helper board.
 */
export function mintCanariedArchive(): string {
    const dbPath = fixtureArchiveDbPath();
    buildFixtureArchive(dbPath);

    const seed = readArchiveSeed();
    const instanceIds = seed.tables.gos_10k_runs.map((run) => String(run.instance_id));
    if (instanceIds.length === 0) {
        throw new Error(
            'The committed Archive seed contains no runs, so the canary helper would rank ' +
            'nowhere and prove nothing. Re-extract with `npm run extract-archive-fixture`.'
        );
    }

    // Only the columns the canary's job needs. Everything else — class_hash,
    // light_level, the kill and duration columns, the weapon rows — is omitted
    // *deliberately* and lands NULL: this row exists to be found by name, not to be
    // analysed, and inventing plausible stats for it would make it indistinguishable
    // from the real sampled rows the fixture is built from. A panel that reads those
    // columns (#94's class split, #88's timeline) should expect one NULL-heavy helper
    // here and take it as a reminder that this Archive carries a synthetic row.
    // `character_class` is the one exception, set so the Helper board renders it like
    // any other row.
    const name = archiveCanaryName();
    const canaryRows = instanceIds.map((instanceId) => ({
        instance_id: instanceId,
        character_id: CANARY_CHARACTER_ID,
        membership_id: CANARY_MEMBERSHIP_ID,
        membership_type: 3,
        display_name: name,
        bungie_global_display_name: name,
        bungie_global_display_name_code: CANARY_CODE,
        character_class: 'Titan',
        completed: 1,
    }));

    const db = new Database(dbPath);
    try {
        // Through the shared replay helper rather than a literal INSERT: that module
        // exists so everything writing rows into this Archive agrees on how a row
        // becomes SQL, and a third hand-written writer is the drift it was created to
        // prevent. An empty schema array is a no-op — buildFixtureArchive() above
        // already replayed the DDL.
        replayArchiveRows(db, [], { gos_10k_pgcr_players: canaryRows });
    } finally {
        db.close();
    }

    return dbPath;
}
