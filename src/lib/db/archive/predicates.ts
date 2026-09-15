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
 * Runs he started from the first encounter, whatever became of them.
 *
 * Deliberately **not** the negation of `is_full_clear`: the stored column folds in
 * "at least one player completed", so 2,897 started-from-the-start runs nobody
 * finished read `is_full_clear = 0`. Any question about *attempts* — wipes, abandoned
 * runs, how long a failed run lasted — must read the two raw columns like this.
 */
export const STARTED_FROM_BEGINNING =
    '(r.activity_was_started_from_beginning = 1 OR r.starting_phase_index = 0)';

/**
 * **Reset** — a Run he started from the first encounter that nobody completed. **3,352**,
 * averaging 7:47: overwhelmingly a restart, not a fireteam collapsing an hour in (#93).
 *
 * Three conjuncts, and each one is load-bearing:
 *
 * - {@link STARTED_FROM_BEGINNING} rather than `is_full_clear`, for the reason given
 *   there — this is a question about attempts.
 * - `completed = 0` — he did not finish it.
 * - `is_full_clear = 0` — and neither did anyone else, which is what the stored column's
 *   "at least one player completed" fold contributes. Without it, the 40 Runs his
 *   fireteam cleared from the start without him are counted as Resets too.
 *
 * **That third conjunct is not exact, and 9 Resets are known to be wrong.** The stored
 * column folds "someone completed" in only where the *pinned* start rule holds. A post-pin
 * Run at phase 0 with Bungie's flag unset reads `is_full_clear = 0` whoever finished it,
 * so 9 such Runs with 4–6 finishers each (10646916167, 10656806604, 10661768568,
 * 10680966329, 10732193084, 10732584295, 10760818572, 12680551981, 16202192642) are
 * counted here rather than as {@link CLEARED_WITHOUT_SUBJECT}. None is in the fixture.
 *
 * Here rather than in ./queries.ts for the reason at the top of this file: the fixture
 * extractor samples by it, and a population two callers spell separately is one they can
 * spell differently.
 *
 * **Uses the disjunctive reading of "started from the beginning", not the pinned one**,
 * because #81's 3,352 was counted that way. Under the pinned reading, 455 of these —
 * phase 0 with Bungie's flag unset, after the pin — would not count as started from the
 * beginning, and 9 of those 455 were in fact finished by other players. The pinned rule
 * treats the *finished* version of exactly those Runs as not-a-clear (the 20 below the
 * headline), so the two readings disagree about the same kind of Run depending on
 * whether it ended — and the 9 above are exactly where that disagreement shows. Recorded
 * rather than resolved; it changes #81's reference figure, so it is the user's call.
 */
export const RESET = `${STARTED_FROM_BEGINNING} AND r.completed = 0 AND r.is_full_clear = 0`;

/**
 * **Cleared without him** — started from the beginning and cleared by his fireteam, but
 * not finished by him. **40.** Exactly the gap between `is_full_clear = 1` alone and
 * {@link PINNED_FULL_CLEAR}.
 */
export const CLEARED_WITHOUT_SUBJECT = 'r.is_full_clear = 1 AND r.completed = 0';

/**
 * Finished Runs the Disjunctive rule counts and the Pinned rule rejects — **20**, all
 * after the pin (see {@link DISJUNCTIVE_FULL_CLEAR}). #81 and #85 call them "pre-pin
 * clears"; they are not. Written as the difference of the two named rules rather than by
 * re-deriving the pin boundary, so it stays right if the pin is ever revised.
 */
export const UNPINNED_CLEAR = `${DISJUNCTIVE_FULL_CLEAR} AND NOT (${PINNED_FULL_CLEAR})`;

/**
 * **Checkpoint Run** — not started from the first encounter, finished or not. **8.**
 * Neither raw column is nullable in practice (0 NULLs across 13,420 Runs, and the Archive
 * cannot gain a row), so the negation needs no COALESCE.
 */
export const CHECKPOINT_RUN = `NOT ${STARTED_FROM_BEGINNING}`;
