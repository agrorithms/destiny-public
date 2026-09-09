# Derived analytics for the Archive are computed at build time, not per request

The GoS 10k Archive (ADR 0007) is served by `scripts/build-gos10k-serving-db.ts`, which reads the
119 MB master under `gos10k/` and `VACUUM INTO`s a serving copy at `data/gos-10k.db`. Until now that
script only *removed* things — it dropped `gos_10k_pgcr_raw` and shipped the rest unchanged.

The analytics UI needs three things the raw tables do not hold: a stable ordinal for each of the
10,000 full clears, a weapon-use table keyed by player rather than character, and resolved names for
weapon hashes. Each could be derived per request. **None of them is.** The build script computes
them once and the serving copy ships them, and `getArchiveDb()` asserts the results at open.

## Why this is safe here and would be wrong on the Tracker

A derived column is a cache, and a cache is a correctness problem the moment its input can change.
The Tracker's input changes every two minutes; anything precomputed there needs invalidation, and
the invalidation is where the bugs live.

**The Archive's input cannot change.** The master is finished, the serving copy is rebuilt by one
committed script, and the file is copied into place by hand. There is no window in which a derived
value can disagree with the rows it was derived from, because nothing writes to either file. That
turns "derive at build time" from an optimisation with a maintenance cost into the plainly correct
option — the same reasoning that already made `is_full_clear` a stored column rather than an inline
`CASE`.

## What is derived, and why each one is not left to the query

**`clear_number`** — the ordinal of each Pinned Full Clear by `period` ascending, 1 to 10,000, NULL
for the 3,420 runs that are not one. The UI's range filter speaks in clear numbers ("clears
9,001–10,000"), so *every* panel on the page inherits this ranking. Computed per request it is a
`ROW_NUMBER()` window over all 13,420 rows before any filter can apply, paid six to eight times per
render; stored and indexed it is a range scan. The stronger argument is not speed: an ordinal that
eight call sites each re-derive is an ordinal eight call sites can re-derive *differently*, and the
predicate it ranks over is the one this codebase has already got wrong twice.

**`gos_10k_weapon_use`** — one row per (instance, membership, weapon), collapsing the 217
(instance, player) pairs where someone brought more than one character. Weapon meta is weighted per
player-run, not per character-run, which against the raw tables means joining 435,816 weapon rows to
`gos_10k_pgcr_players` for a `membership_id` and then a `COUNT(DISTINCT …)` over the result: **1.78 s
unfiltered**, measured, on every uncached first visit. The same aggregate over a pre-deduped table
is a plain scan at ~0.5 s. But the reason it is a table rather than an index is the hazard: counting
per character instead of per player is Hazard 1 in `src/lib/db/archive/queries.ts` wearing a
different hat, and a shape that cannot express the wrong count is worth more than a comment asking
future queries to remember the right one.

**Resolved weapon names** — the ~1,300 distinct weapon hashes in this dataset, resolved once against
the Destiny manifest and committed as source. Bungie has stopped shipping content, so this mapping
is as frozen as the runs it describes; there is no runtime manifest dependency and no cache to
invalidate. This follows `RAID_DEFINITIONS` in `src/lib/bungie/manifest.ts`, which is a hardcoded
literal for the same reason: resolved reference data is source code, not runtime data.

## Why row counts are no longer enough verification

`getArchiveDb()` verifies the serving copy's table counts against the committed manifest, and that
check is what stands in for the build-time failure ADR 0007 gave up by rendering dynamically. It
catches a truncated or stale `scp`.

**It cannot catch a wrong derivation.** A `clear_number` column ranked over the disjunctive rule
instead of the pinned one has exactly the right number of rows, exactly the right number of
non-NULLs, and a maximum of 10,020 instead of 10,000. So the manifest gains **invariant assertions**
alongside the counts — `MAX(clear_number) = 10000` and `COUNT(clear_number IS NOT NULL) = 10000` —
which are one line each and fail loudly on the only mistakes that are plausible.

Full checksums of the derived tables were rejected: they must be regenerated on every build, and
they report *that* something changed rather than *what*, which for a hand-run script is friction
without insight.

## Consequences

- **The build script is now load-bearing, not just a trimmer.** Re-running it is required after any
  change to the master, and the runbook in `docs/decisions.md` already says so; what is new is that
  skipping it can now produce wrong *analytics*, not just stale counts.
- **The serving copy grows.** `gos_10k_weapon_use` is a near-copy of `gos_10k_pgcr_weapons` at
  ~435k rows; the weapon table plus its indexes was already the largest object in the file at 49 MB.
  If size becomes a constraint, the raw weapons table is the redundant one, not the derived one.
- **Derived values are only as good as their rebuild.** Nothing in CI regenerates them, deliberately
  — CI never touches either database (ADR 0007). The invariant assertions are the only automated
  thing standing between a bad build and a plausible wrong number on the page.
- **This does not license precomputation on the Tracker.** The whole argument rests on an input that
  cannot change. Applied to a live database it would be an unmaintained cache, and the two cases
  should not be reasoned about together.
