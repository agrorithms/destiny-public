# #227 — Widen the pgcrs ended_at index with the scope flags; 30d raid stats are Full Clears only

Spec: `gh issue view 227 --repo agrorithms/destiny-public`. Branch `feat/227-widen-ended-index`, base `main` @ `c65857a`.
Seams and decisions approved 2026-11-07:

- S1: `tests/db/raids-in-progress-index.test.ts` pins `idx_pgcrs_ended_period_raid_clear`'s columns, and that reopening a Tracker carrying the old `idx_pgcrs_ended_period_raid` drops it. Hardens ADR 0009, implements ADR 0006's second 2026-11-07 amendment.
- S2: `tests/db/raid-stats.test.ts` "windows above 168h": `allAttempts` null at 169h, computed at 168h, distinct from an empty `fullClear` at 720h, and the scalar fields still count every instance at 720h. Hardens ADR 0006.
- S3: `tests/routes/raid-stats.test.ts`: `hours=720` carries `"allAttempts": null` on the wire, `hours=168` an object.
- `INDEXED BY` has no Vitest test (decision 2a). It is proven by `EXPLAIN QUERY PLAN` under the backup's stale `sqlite_stat1`, recorded below.
- ADR 0009's "The covering index no longer covers." bullet gets an in-place pointer to #227 (decision 6b).

1. Failing tests, red
   - [x] `tests/db/raids-in-progress-index.test.ts` — S1
   - [x] `tests/db/raid-stats.test.ts` — S2
   - [x] `tests/routes/raid-stats.test.ts` — S3
   - Red run on the old code: 5 of 38 failed. Both index tests (no widened index; the old one not dropped), the 169h and 720h null tests, and the route's `hours=720` null. The 168h boundary, the 720h scalar fields and the route's `hours=168` pass before and after: they guard what must not change
2. The index, the hint and the 30d rule, green
   - [ ] `src/lib/db/schema.ts` — DROP the old index, CREATE the widened one, comment
   - [ ] `src/lib/db/queries.ts` — `ALL_SCOPES_MAX_HOURS`, `RAID_STATS_INDEX`, the per-scope `pgcrs` source, `RaidStatsRow`, comments naming the index
3. Docs, measurements and bite proofs
   - [ ] `docs/adr/0009-raid-activity-is-reconstructed-from-pgcrs.md` — pointer on the covering-index bullet
   - [ ] `docs/progress/227-widen-ended-index.md` — this file, with the real-data hashes, plans and timings
