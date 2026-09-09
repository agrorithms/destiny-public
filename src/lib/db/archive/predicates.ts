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
 * ./queries.ts re-exports all three, so `@/lib/db/archive/queries` remains the one place
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
 * {@link PINNED_FULL_CLEAR}, all of them before the flag was reliable.
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
