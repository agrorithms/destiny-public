/**
 * The Archive's named full-clear rules, as SQL fragments over `gos_10k_runs r`.
 *
 * These live beside ./queries.ts rather than inside it, and the reason is narrow: the
 * Archive build script and the fixture extractor both have to rank Runs by the *pinned*
 * rule (ADR 0008), and importing ./queries.ts from a `tsx` script would drag in
 * getArchiveDb() and the Tracker's 1,700-line query module for the sake of one string.
 * A predicate that two build-time callers cannot import is a predicate they will
 * re-express inline, and re-expressing this one is exactly the mistake the pinned rule
 * exists to prevent.
 *
 * {@link RESET} and the Resets panel's (#93) other populations sit here for the same
 * reason: the fixture extractor samples by them, and the shape and partition tests count
 * them.
 *
 * ./queries.ts re-exports every one, so `@/lib/db/archive/queries` remains the one place
 * a reader has to look, and the "all SQL in one query module per database" rule still
 * holds for every actual query.
 */

/**
 * **Pinned Full Clear** — the Archive's default, and the rule that reconciles to
 * exactly 10,000.
 *
 * Bungie did not populate `activityWasStartedFromBeginning` for the whole of the
 * covered history: zero runs at or before 2022-02-21 carry it. So the rule trusts the
 * flag after the pin and `starting_phase_index = 0` at or before it. The pin instant
 * is instance 10141395454 — the subject's own last clear before a 40-day gap with no
 * GoS runs at all, which is where the evidence runs out. **The id means nothing else**;
 * it is not a boundary Bungie chose, and a future reader should not look for one.
 *
 * The 7 runs between the two candidate pins (2022-04-02 to 04-05) are all phase 0,
 * flag 0, and raid.report independently shows them as checkpoint runs — which is why
 * pinning at Feb 21 rather than at the first observed `flag = 1` (2022-04-09) is
 * right. That later date is the first *true* reading, not the first meaningful one.
 *
 * The stored `is_full_clear` column holds exactly this rule, so it is what the SQL
 * reads; the CASE is documented here rather than repeated at every call site.
 *
 * `completed = 1` is inside the predicate, not left to the caller. Dropping it leaves
 * `is_full_clear = 1` alone, which returns **10,040**: 40 runs the fireteam cleared
 * from the start *without* him, correctly flagged. (Evaluating the CASE above with no
 * `completed` conjunct would return 12,937 instead — the stored column already folds
 * in "at least one player finished", which is why the shipped gap is 40 and not 3,400.
 * A 40-row error is harder to notice, not less real.)
 */
export const PINNED_FULL_CLEAR = 'r.is_full_clear = 1 AND r.completed = 1';

/**
 * **Disjunctive Full Clear** — the Tracker-comparable rule. Flag set *or* phase index
 * 0, anywhere in the history, with no pin. **10,020**: generous by 20 runs against
 * {@link PINNED_FULL_CLEAR} ({@link UNPINNED_CLEAR}). All 20 are *after* the pin
 * (2022-04-02 to 2024-12-15) — phase 0 with the flag unset, the shape the pin stops
 * trusting — so they only resemble Runs from before the flag was reliable.
 *
 * Kept because the comparison is the interesting thing, and because which number the
 * page headlines is an editorial choice that stays a call site rather than a schema
 * change. Both inputs are stored per row. Carries `completed = 1` for the same reason
 * as its sibling — without it, 13,412.
 */
export const DISJUNCTIVE_FULL_CLEAR =
    '(r.activity_was_started_from_beginning = 1 OR r.starting_phase_index = 0) AND r.completed = 1';

/**
 * The **disjunctive** reading of "started from the first encounter": flag set or phase
 * index 0, anywhere in the history. The start half of {@link DISJUNCTIVE_FULL_CLEAR}.
 *
 * Not what the Resets panel counts with — that is {@link STARTED_FROM_BEGINNING_PINNED}.
 * After the pin every Run in the Archive is phase 0, so this reading accepts every
 * post-pin Run whatever Bungie's flag says, including 483 − 8 = 475 the pinned reading
 * calls Checkpoint Runs. It stays for the two build-time callers that sample the gap
 * between the readings, and for naming that gap.
 */
export const STARTED_FROM_BEGINNING =
    '(r.activity_was_started_from_beginning = 1 OR r.starting_phase_index = 0)';

/**
 * `period` of the pin instance, 10141395454 (see {@link PINNED_FULL_CLEAR}). The next Run
 * in the Archive is at 1645707493, so any bound between the two selects the same Runs.
 */
const PIN_PERIOD = 1645438571;

/**
 * The **pinned** reading of "started from the first encounter" — `starting_phase_index = 0`
 * at or before the pin, Bungie's flag after it. The start half of
 * {@link PINNED_FULL_CLEAR}, spelled out because the stored `is_full_clear` cannot be
 * read for it: that column is this rule **and** "at least one player completed", so for a
 * Run nobody finished it reads 0 whichever way it started.
 *
 * This is the one place outside the Archive's master that restates the pin. The stored
 * column is the authority, and tests/db/archive-resets.test.ts asserts that
 * `is_full_clear` equals this predicate plus "someone finished" on every fixture Run, so
 * a revised pin fails a test rather than silently moving Runs between populations.
 * Production matches on all 13,420.
 */
export const STARTED_FROM_BEGINNING_PINNED =
    `(CASE WHEN r.period <= ${PIN_PERIOD} THEN r.starting_phase_index = 0 ` +
    `ELSE r.activity_was_started_from_beginning = 1 END)`;

/**
 * **Reset** — a Run he started from the first encounter that nobody completed. **2,897**,
 * median 2:56, 2,621 of them over inside ten minutes: overwhelmingly a restart, not a
 * fireteam collapsing an hour in (#93).
 *
 * Three conjuncts, and each one is load-bearing:
 *
 * - {@link STARTED_FROM_BEGINNING_PINNED} — the same start rule the 10,000 uses. The
 *   disjunctive reading gives #81's 3,352, which holds 455 post-pin Runs with Bungie's
 *   flag unset. The pinned rule calls the *finished* version of those Runs a checkpoint
 *   entry, so counting the unfinished ones as Resets judged one kind of Run two ways
 *   depending on whether it ended — and 9 of the 455 had 4–6 finishers, which a Reset
 *   cannot have. They are {@link CHECKPOINT_RUN}s.
 * - `completed = 0` — he did not finish it.
 * - `is_full_clear = 0` — and neither did anyone else. Under the pinned start rule this
 *   is exact: the stored column is that rule plus "at least one player completed". Without
 *   it, the 40 Runs his fireteam cleared from the start without him are Resets too.
 */
export const RESET = `${STARTED_FROM_BEGINNING_PINNED} AND r.completed = 0 AND r.is_full_clear = 0`;

/**
 * **Cleared without him** — started from the beginning and cleared by his fireteam, but
 * not finished by him. **40.** Exactly the gap between `is_full_clear = 1` alone and
 * {@link PINNED_FULL_CLEAR}.
 */
export const CLEARED_WITHOUT_SUBJECT = 'r.is_full_clear = 1 AND r.completed = 0';

/**
 * Finished Runs the Disjunctive rule counts and the Pinned rule rejects — **20**, all
 * after the pin (see {@link DISJUNCTIVE_FULL_CLEAR}). #81 and #85 call them "pre-pin
 * clears"; they are not. Under the pinned reading they are {@link CHECKPOINT_RUN}s he
 * finished, so this is not one of the Resets panel's populations — it names the gap
 * between the two rules, which the fixture extractor samples whole.
 *
 * Written as the difference of the two named rules rather than by re-deriving the pin
 * boundary, so it stays right if the pin is ever revised.
 */
export const UNPINNED_CLEAR = `${DISJUNCTIVE_FULL_CLEAR} AND NOT (${PINNED_FULL_CLEAR})`;

/**
 * **Checkpoint Run** — not started from the first encounter under
 * {@link STARTED_FROM_BEGINNING_PINNED}, finished or not. **483**: 8 before the pin with
 * a later phase index, and 475 after it with Bungie's flag unset. Of the 483, he finished
 * 23 and others finished 11 without him.
 *
 * Neither raw column is nullable in practice (0 NULLs across 13,420 Runs, and the Archive
 * cannot gain a row), so the negation needs no COALESCE.
 */
export const CHECKPOINT_RUN = `NOT ${STARTED_FROM_BEGINNING_PINNED}`;
