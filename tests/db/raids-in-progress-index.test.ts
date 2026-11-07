import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers/db';
import { initializeSchema } from '../../src/lib/db/schema';

/**
 * The covering index the Raid Activity sweep reads (#195), widened by #227 so raid stats can
 * read the Full Clear flags from it too.
 *
 * An index changes no result, so no test of `getRaidsInProgress` or `getRaidStats` can tell
 * whether it is there: dropping it only makes them slower on prod. Its existence and column
 * order are the spec, and this pins them. The order matters: `ended_at` leads the range scan,
 * and the four columns after it let SQLite answer the sweep (#204 included, once it reads the
 * two flags) from the index alone, and let the Full Clears scope filter without touching the
 * table. Why it's forced with `INDEXED BY` in `getRaidStats`, and measured, is in ADR 0006's
 * second 2026-11-07 amendment.
 */
function indexColumns(name: string): string[] {
    return testDb()
        .prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
        .all(name)
        .map((row) => (row as { name: string }).name);
}

describe('the Raid Activity index', () => {
    it('is created on pgcrs as (ended_at, period, raid_key, completed, activity_was_started_from_beginning)', () => {
        expect(indexColumns('idx_pgcrs_ended_period_raid_clear')).toEqual([
            'ended_at', 'period', 'raid_key', 'completed', 'activity_was_started_from_beginning',
        ]);
    });

    // Prod already has the narrower index from #195. The widened one starts with the same three
    // columns, so keeping both would only cost disk and write time on every PGCR insert.
    it('replaces the narrower (ended_at, period, raid_key) index when a Tracker that has it is opened', () => {
        const db = testDb();
        db.exec('CREATE INDEX IF NOT EXISTS idx_pgcrs_ended_period_raid ON pgcrs(ended_at, period, raid_key)');

        initializeSchema(db);

        expect(indexColumns('idx_pgcrs_ended_period_raid')).toEqual([]);
        expect(indexColumns('idx_pgcrs_ended_period_raid_clear')).toHaveLength(5);
    });
});
