import { beforeEach, describe, expect, it } from 'vitest';
import { getPlayerRaidCompletionSummary } from '@/lib/db/queries';
import type { DestinyPostGameCarnageReportData } from '@/lib/bungie/types';
import { resetTestDb, testDb } from '../helpers/db';
import { readPgcrRow, seedFromFixture } from '../helpers/seed';
import { buildEntry, buildPGCR, swapEntries } from '../helpers/pgcr-builder';

import checkpoint from '../fixtures/pgcr-checkpoint-root-of-nightmares.json';

/**
 * The Entry fold as `insertFullPGCR` applies it (#275, C-01). Every writer passes through
 * `insertFullPGCR`, so these go through it too, by way of the crawler's own mapping
 * (`seedFromFixture`). The fold's rules one by one are in `src/lib/db/entry-fold.test.ts`; this
 * file proves the stored row and what the readers make of it.
 *
 * The committed checkpoint fixture lists its two-character player's finishing Entry first, which
 * is the one order the old first-Entry-wins insert got right. Swapping the two Entries gives the
 * order it got wrong without capturing a new report.
 */

const as = (fixture: unknown) => fixture as DestinyPostGameCarnageReportData;

/** Vick XCII: a Titan Entry that finished and a Warlock Entry that didn't. */
const VICK = '4611686018527934833';
const VICK_TITAN = 3;
const VICK_WARLOCK = 5;

function storedRow(instanceId: string, membershipId: string): Record<string, unknown> | undefined {
    return testDb()
        .prepare('SELECT * FROM pgcr_players WHERE instance_id = ? AND membership_id = ?')
        .get(instanceId, membershipId) as Record<string, unknown> | undefined;
}

beforeEach(() => {
    resetTestDb();
});

describe('a player whose finishing Entry comes second', () => {
    it('is stored as having finished (captured report, Entries swapped)', () => {
        const swapped = swapEntries(as(checkpoint), VICK_TITAN, VICK_WARLOCK);
        // Guard the premise: if a recapture changes the fixture, this fails here rather than
        // leaving the assertion below passing for the wrong reason.
        const vicksEntries = swapped.entries.filter((e) => e.player.destinyUserInfo.membershipId === VICK);
        expect(vicksEntries.map((e) => e.values.completed?.basic.value)).toEqual([0, 1]);

        seedFromFixture(swapped);

        expect(storedRow(swapped.activityDetails.instanceId, VICK)?.completed).toBe(1);
    });

    it('is credited with the Completion of a Full Clear', () => {
        // The checkpoint report above can't show a Completion, because a checkpoint run is not a
        // Full Clear. This is the shape C-01 found 34 of: a Full Clear its finisher wasn't credited
        // for on the leaderboards or the player page.
        const swapper = '4611686018400000009';
        const pgcr = buildPGCR({
            instanceId: '17000000001',
            entries: [
                buildEntry({ membershipId: swapper, characterClass: 'Warlock', completed: false, timePlayedSeconds: 300 }),
                buildEntry({ membershipId: '4611686018400000001', completed: true }),
                buildEntry({ membershipId: swapper, characterClass: 'Titan', completed: true, timePlayedSeconds: 1500 }),
            ],
        });

        seedFromFixture(pgcr);

        expect(getPlayerRaidCompletionSummary(swapper, 24)).toMatchObject([
            { raidKey: 'salvations_edge', completions: 1 },
        ]);
    });
});

describe('the run end time', () => {
    it('is measured from the Entries before they are folded', () => {
        // Tier 2 is MAX(startSeconds + timePlayedSeconds) over Entries. Here the second character
        // joins at 1000s and plays 500s, so the run ran to 1500s. Measured from a folded row it
        // would be 0 + (600 + 500) = 1100s: the fold must not reach the duration tiers.
        const pgcr = buildPGCR({
            instanceId: '17000000002',
            entries: [
                buildEntry({ startSeconds: 0, timePlayedSeconds: 600, activityDurationSeconds: null }),
                buildEntry({ startSeconds: 1000, timePlayedSeconds: 500, activityDurationSeconds: null }),
            ],
        });

        seedFromFixture(pgcr);

        const row = readPgcrRow('17000000002') as { period: number; ended_at: number };
        expect(row.ended_at - row.period).toBe(1500);
    });
});
