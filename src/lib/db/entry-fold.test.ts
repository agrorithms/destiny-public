import { describe, expect, it } from 'vitest';
import { foldEntriesIntoPlayerRuns } from './entry-fold';
import type { InsertFullPGCRPlayer } from './queries';

/**
 * The fold that turns a PGCR's Entries into one `pgcr_players` row per player (#275, ADR 0006's
 * 2026-11-23 amendment). Before it, `insertFullPGCR` kept whichever Entry came first, so a player
 * whose finishing character was listed second was stored as not finishing.
 *
 * Every case gives the player at least one Entry that differs from the first, because "take the
 * first Entry" is the bug, and a test the first Entry would satisfy cannot catch it coming back.
 */

const INSTANCE = '17091462346';

function entry(over: Partial<InsertFullPGCRPlayer> = {}): InsertFullPGCRPlayer {
    return {
        instanceId: INSTANCE,
        membershipId: 'A',
        membershipType: 3,
        displayName: 'Alpha',
        bungieGlobalDisplayName: 'Alpha',
        characterClass: 'Hunter',
        lightLevel: 2000,
        completed: false,
        kills: 10,
        deaths: 1,
        assists: 5,
        timePlayedSeconds: 600,
        startSeconds: 0,
        ...over,
    };
}

describe('players with one Entry each', () => {
    it('keeps every field but the join offset, one row per player in first-seen order', () => {
        const a = entry({ membershipId: 'A', completed: true, kills: 7 });
        const b = entry({ membershipId: 'B', displayName: 'Bravo', characterClass: 'Titan', startSeconds: 90 });

        const withoutStart = (e: InsertFullPGCRPlayer) =>
            Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'startSeconds'));
        expect(foldEntriesIntoPlayerRuns([a, b])).toStrictEqual([withoutStart(a), withoutStart(b)]);
    });

    it('never merges two different players, even when their Entries interleave', () => {
        const rows = foldEntriesIntoPlayerRuns([
            entry({ membershipId: 'A', kills: 1 }),
            entry({ membershipId: 'B', kills: 20 }),
            entry({ membershipId: 'A', kills: 2 }),
        ]);

        expect(rows.map((r) => [r.membershipId, r.kills])).toEqual([['A', 3], ['B', 20]]);
    });

    it('returns no rows for a report with no Entries', () => {
        expect(foldEntriesIntoPlayerRuns([])).toEqual([]);
    });
});

describe('completed', () => {
    it('is true when the finishing Entry comes second', () => {
        // The C-01 shape: Entry order is not time order, so the non-finishing character can be
        // listed first. In the Archive it is, for 40% of multi-character players who finished.
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ characterClass: 'Warlock', completed: false }),
            entry({ characterClass: 'Titan', completed: true }),
        ]);

        expect(row.completed).toBe(true);
    });

    it('is true when the finishing Entry sits between two that did not finish', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ completed: false }),
            entry({ completed: true }),
            entry({ completed: false }),
        ]);

        expect(row.completed).toBe(true);
    });

    it('is false when none of the Entries finished', () => {
        const [row] = foldEntriesIntoPlayerRuns([entry({ completed: false }), entry({ completed: false })]);

        expect(row.completed).toBe(false);
    });
});

describe('kills, deaths, assists and time played', () => {
    it('are summed over every Entry', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ kills: 10, deaths: 1, assists: 5, timePlayedSeconds: 600 }),
            entry({ kills: 3, deaths: 4, assists: 0, timePlayedSeconds: 50 }),
            entry({ kills: 25, deaths: 0, assists: 2, timePlayedSeconds: 1200 }),
        ]);

        expect([row.kills, row.deaths, row.assists, row.timePlayedSeconds]).toEqual([38, 5, 7, 1850]);
    });
});

describe('class and light level', () => {
    it('both come from the Entry played longest when it is in the middle', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ characterClass: 'Hunter', lightLevel: 479, timePlayedSeconds: 981 }),
            entry({ characterClass: 'Warlock', lightLevel: 543, timePlayedSeconds: 1494 }),
            entry({ characterClass: 'Titan', lightLevel: 451, timePlayedSeconds: 549 }),
        ]);

        expect([row.characterClass, row.lightLevel]).toEqual(['Warlock', 543]);
    });

    it('both come from the Entry played longest when it is last', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ characterClass: 'Hunter', lightLevel: 543, timePlayedSeconds: 557 }),
            entry({ characterClass: 'Warlock', lightLevel: 475, timePlayedSeconds: 988 }),
            entry({ characterClass: 'Titan', lightLevel: 538, timePlayedSeconds: 1916 }),
        ]);

        expect([row.characterClass, row.lightLevel]).toEqual(['Titan', 538]);
    });

    it('go to the first of two Entries tied on time played', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ characterClass: 'Hunter', lightLevel: 500, timePlayedSeconds: 600 }),
            entry({ characterClass: 'Titan', lightLevel: 510, timePlayedSeconds: 600 }),
        ]);

        expect([row.characterClass, row.lightLevel]).toEqual(['Hunter', 500]);
    });

    it('still move to a later Entry that beats a tie', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ characterClass: 'Hunter', lightLevel: 500, timePlayedSeconds: 600 }),
            entry({ characterClass: 'Titan', lightLevel: 510, timePlayedSeconds: 600 }),
            entry({ characterClass: 'Warlock', lightLevel: 520, timePlayedSeconds: 601 }),
        ]);

        expect([row.characterClass, row.lightLevel]).toEqual(['Warlock', 520]);
    });
});

describe('membership and name fields', () => {
    it('come from the first Entry, even where a later one differs', () => {
        const [row] = foldEntriesIntoPlayerRuns([
            entry({ membershipType: 3, displayName: 'First', bungieGlobalDisplayName: undefined }),
            entry({ membershipType: 2, displayName: 'Second', bungieGlobalDisplayName: 'Second', instanceId: 'other' }),
        ]);

        expect(row).toMatchObject({ instanceId: INSTANCE, membershipId: 'A', membershipType: 3, displayName: 'First' });
        expect(row.bungieGlobalDisplayName).toBeUndefined();
    });
});
