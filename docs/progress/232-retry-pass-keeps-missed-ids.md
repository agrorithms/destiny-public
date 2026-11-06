# #232 — A Retry Pass cut short keeps the Missed Ids it never reached

Spec: `gh issue view 232 --repo agrorithms/destiny-public`. Branch `feat/232-retry-pass-keeps-missed-ids`, base `fix/scanner-id-hole` @ `c5e3275`.
Seams and decisions approved 2026-11-06:

- All seams drive the real `startScanner` loop against a real SQLite file with only `fetch` stubbed (ADR 0003 and 0004 followed; no ADR contradicted or hardened).
- Seam 1: `describe('a retry pass cut short')`, proving AC1, AC2, AC3, the cap-free half of AC4 and part of AC5.
- Seam 2: the two pinned lines gain ` | Position: <id>`, proving AC4 for both lines. The existing `of 2 retried` line also guards against a count taken from `nextIndex`.
- Seam 3: a separate cap test, `SCANNER_MAX_MISSED_IDS=1`, proving AC4's "after any cap count". It goes beyond the ticket's "one cut-short test"; the user chose to keep it as a separate short test.
- Seam 4: the existing `logs nothing for a retry pass that recovers no raid`, unchanged, proving AC5. It is green before and after, so its bite proof is one temporary uncommitted break.
- `retryLines` moves to file scope beside `loggedLines`.

1. Failing tests, red
   - [x] `tests/scanner/scanner-position.test.ts` — seams 1, 2 and 3, `retryLines` moved (red run on the old scanner: 4 of 32 failed. The cut-short test failed on the ids asked for, the two unreached ids never being asked again; the two pinned lines and the cap test failed on the missing suffix)
2. The queue rule and the log lines, green
   - [ ] `src/lib/scanner/index.ts` — the pass keeps the queue, ids leave on `raid` or `not_raid`, `attempted`, `Position:` on both lines, `addMissedIds` and `stillMissingIds` gone
3. Bite proofs and suite
   - [ ] `docs/progress/232-retry-pass-keeps-missed-ids.md` — this file
