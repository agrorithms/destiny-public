import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers/db';

/**
 * The covering index the Raid Activity sweep reads (#195).
 *
 * An index changes no result, so no test of `getRaidsInProgress` can tell whether it is
 * there: dropping it only makes the default 7-day chart about a third slower on prod
 * (~330–450 ms → ~210 ms on the 2026-10-23 backup). Adding it was the maintainer's
 * decision for this ticket, so its existence and column order are the spec, and this
 * pins them — the order matters, because `ended_at` leads the range scan and `period`
 * and `raid_key` after it are what let SQLite answer the sweep from the index alone.
 */
describe('the Raid Activity index', () => {
    it('is created on pgcrs as (ended_at, period, raid_key)', () => {
        const columns = testDb()
            .prepare("SELECT name FROM pragma_index_info('idx_pgcrs_ended_period_raid') ORDER BY seqno")
            .all()
            .map((row) => (row as { name: string }).name);

        expect(columns).toEqual(['ended_at', 'period', 'raid_key']);
    });
});
