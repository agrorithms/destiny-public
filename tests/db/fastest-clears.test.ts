import { beforeEach, describe, expect, it } from 'vitest';
import { runFastestClearRows } from '@/lib/cache/leaderboard-cache';
import { resetTestDb } from '../helpers/db';
import { hoursAgo, seedPlayer, seedRun } from '../helpers/seed';

/**
 * The Fastest Clears board (#130, #132): one row per player per raid, holding that
 * player's fastest Clear Time among the Completions the filters match.
 *
 * Like the Full Clears tests next door, these assert the rows a raider would see —
 * who is on the board, in what order, at what rank and with what Clear Time — because
 * a wrong-but-plausible board is the failure nobody would report.
 *
 * Every run here is a Salvation's Edge run unless it says otherwise (seedRun's default
 * hash), so the board under test is always `salvations_edge`.
 */
const RAID = 'salvations_edge';
const CROTAS_END = 1566480315;
const HOURS_BACK = 24;

beforeEach(() => {
    resetTestDb();
});

describe('who appears on the Fastest Clears board', () => {
    it('ranks a player by their fastest Clear Time, and their slower clears add no rows', () => {
        // The row unit is the player, not the run: three clears of one raid are one row
        // holding the best of them, never three rows crowding the board.
        seedRun({ instanceId: '1', completedBy: ['p1'], activityDurationSeconds: 2400 });
        seedRun({ instanceId: '2', completedBy: ['p1'], activityDurationSeconds: 1500 });
        seedRun({ instanceId: '3', completedBy: ['p1'], activityDurationSeconds: 1800 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.membershipId, r.clearTimeSeconds])).toEqual([['p1', 1500]]);
    });

    it('excludes a checkpoint run, however fast', () => {
        // A checkpoint run is the shortest run there is — it skips encounters — so if it
        // leaked in it would sit at the top of every board.
        seedRun({ instanceId: '1', completedBy: ['p1'], startedFromBeginning: false, activityDurationSeconds: 300 });
        seedRun({ instanceId: '2', completedBy: ['p1'], activityDurationSeconds: 1800 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.membershipId, r.clearTimeSeconds])).toEqual([['p1', 1800]]);
    });

    it('excludes a player who was present but did not finish', () => {
        // pgcrs.completed means "someone finished", so being in a clear is not having
        // cleared it. p2 must not inherit the fireteam's time.
        seedRun({ instanceId: '1', completedBy: ['p1'], incompleteBy: ['p2'] });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => r.membershipId)).toEqual(['p1']);
    });

    it('excludes a run that nobody finished', () => {
        // A wipe-and-leave is short, and the most common shape in the table.
        seedRun({ instanceId: '1', incompleteBy: ['p1', 'p2'], activityDurationSeconds: 240 });

        expect(runFastestClearRows(HOURS_BACK, RAID, 10)).toEqual([]);
    });

    it('credits a late joiner who finished a fresh run with the run\'s Clear Time', () => {
        // Clear Time is the run's duration, not the player's time played (CONTEXT.md):
        // someone who joined at the last encounter and finished shares the fireteam's time.
        seedRun({ instanceId: '1', completedBy: ['p1'], activityDurationSeconds: 1800 });
        seedRun({
            instanceId: '2',
            completedBy: ['late'],
            activityDurationSeconds: 1800,
            startSeconds: 1500,
            timePlayedSeconds: 300,
        });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.find((r) => r.membershipId === 'late')?.clearTimeSeconds).toBe(1800);
    });

    it('excludes a run with no stored end time', () => {
        // With no duration from Bungie and no time played to fall back on, ended_at stays
        // NULL and there is no Clear Time to rank — the run cannot appear at all.
        seedRun({
            instanceId: '1',
            completedBy: ['p1'],
            activityDurationSeconds: null,
            timePlayedSeconds: 0,
        });

        expect(runFastestClearRows(HOURS_BACK, RAID, 10)).toEqual([]);
    });

    it('ranks a 2-minute suspected-cheated clear like any other run', () => {
        // Pins a decision, not an accident (#130): there is no duration floor and no
        // plausibility filter. Thousands of 2–4 minute Desert Perpetual clears are
        // believed cheated and are ranked anyway, so a reader can open them. Adding a
        // floor would make this fail, which is the point.
        seedRun({ instanceId: '1', completedBy: ['honest'], activityDurationSeconds: 1800 });
        seedRun({ instanceId: '2', completedBy: ['suspect'], activityDurationSeconds: 120 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.membershipId, r.clearTimeSeconds, r.rank])).toEqual([
            ['suspect', 120, 1],
            ['honest', 1800, 2],
        ]);
    });

    it('returns the instance id and end time of the run that set the Clear Time', () => {
        // The raid.report link and the date tooltip (#133) both hang off these, so they
        // must be the fastest run's, not whichever run the GROUP happened to keep.
        const period = hoursAgo(5);
        seedRun({ instanceId: 'slow', completedBy: ['p1'], period: hoursAgo(3), activityDurationSeconds: 2400 });
        seedRun({ instanceId: 'fast', completedBy: ['p1'], period, activityDurationSeconds: 1500 });

        const [row] = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(row.instanceId).toBe('fast');
        expect(row.endedAt).toBe(period + 1500);
    });

    it('links the earliest of a player\'s equal-fastest runs', () => {
        // Two runs with the same Clear Time give one row, and #133 says it must point at
        // the run that got there first — the same rule the board uses between players.
        // The ids sort the other way, so the instance-id fallback can't be doing the work.
        const early = hoursAgo(10);
        seedRun({ instanceId: 'a-late', completedBy: ['p1'], period: hoursAgo(2), activityDurationSeconds: 1500 });
        seedRun({ instanceId: 'z-early', completedBy: ['p1'], period: early, activityDurationSeconds: 1500 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.instanceId, r.endedAt])).toEqual([['z-early', early + 1500]]);
    });
});

describe('ranks and ties', () => {
    it('gives every member of one fireteam the same rank', () => {
        // Clear Time belongs to the run, so the six who finished it tied — the board
        // must not pretend one of them was faster. Competition ranking: 1, 1, 1, 4.
        seedRun({ instanceId: '1', completedBy: ['a', 'b', 'c'], activityDurationSeconds: 1500 });
        seedRun({ instanceId: '2', completedBy: ['d'], activityDurationSeconds: 1600 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.membershipId, r.rank])).toEqual([
            ['a', 1],
            ['b', 1],
            ['c', 1],
            ['d', 4],
        ]);
    });

    it('breaks a tie in favour of the run that ended first', () => {
        // Same rule as the Full Clears board: whoever got there first lists first. The
        // tie still shares a rank — only the order within it is decided. The ids sort the
        // other way, so this fails if the membership-id fallback is doing the work.
        seedRun({ instanceId: '1', period: hoursAgo(1), completedBy: ['a-late'], activityDurationSeconds: 1500 });
        seedRun({ instanceId: '2', period: hoursAgo(10), completedBy: ['z-early'], activityDurationSeconds: 1500 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.membershipId, r.rank])).toEqual([
            ['z-early', 1],
            ['a-late', 1],
        ]);
    });

    it('breaks a remaining tie by membership id so the order is never arbitrary', () => {
        seedRun({ instanceId: '1', completedBy: ['bbb', 'aaa'], activityDurationSeconds: 1500 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => r.membershipId)).toEqual(['aaa', 'bbb']);
    });

    it('returns at most the requested number of players', () => {
        seedRun({ instanceId: '1', completedBy: ['p1', 'p2', 'p3'] });

        expect(runFastestClearRows(HOURS_BACK, RAID, 2)).toHaveLength(2);
    });

    it('renders the full Name#Code, zero-padding the code', () => {
        // Same formatter as the Full Clears board; pinned here because this runner has
        // its own SELECT and could drop the code without the other board noticing.
        seedPlayer('p1', 'Guardian', 42);
        seedRun({ instanceId: '1', completedBy: ['p1'] });

        expect(runFastestClearRows(HOURS_BACK, RAID, 10)[0].displayName).toBe('Guardian#0042');
    });
});

describe('the time window', () => {
    it('judges the window by when a run ended, as the Full Clears board does', () => {
        // A run that began before the cutoff but finished inside it counts; one that
        // finished before the cutoff does not, however fast it was.
        const cutoff = Math.floor(Date.now() / 1000) - HOURS_BACK * 3600;
        seedRun({ instanceId: '1', period: cutoff - 600, completedBy: ['inside'], activityDurationSeconds: 1200 });
        seedRun({ instanceId: '2', period: cutoff - 1000, completedBy: ['outside'], activityDurationSeconds: 900 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => r.membershipId)).toEqual(['inside']);
    });

    it('ignores a faster clear of the player\'s that fell out of the window', () => {
        // The board answers "fastest in this window", so an old personal best must not
        // stand in for this week's time.
        seedRun({ instanceId: '1', period: hoursAgo(48), completedBy: ['p1'], activityDurationSeconds: 1200 });
        seedRun({ instanceId: '2', period: hoursAgo(2), completedBy: ['p1'], activityDurationSeconds: 1800 });

        expect(runFastestClearRows(HOURS_BACK, RAID, 10)[0].clearTimeSeconds).toBe(1800);
    });
});

describe('filters', () => {
    it('counts only the requested raid', () => {
        // A fast Crota's End clear must not land on the Salvation's Edge board.
        seedRun({ instanceId: '1', completedBy: ['p1'], activityDurationSeconds: 1800 });
        seedRun({ instanceId: '2', completedBy: ['p1'], activityHash: CROTAS_END, activityDurationSeconds: 900 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10);

        expect(rows.map((r) => [r.membershipId, r.clearTimeSeconds])).toEqual([['p1', 1800]]);
    });

    it('exactPlayers keeps only runs of that fireteam size', () => {
        // Solo board: a faster six-player clear of the same player must not count.
        seedRun({ instanceId: '1', completedBy: ['p1'], uniquePlayerCount: 1, activityDurationSeconds: 2400 });
        seedRun({ instanceId: '2', completedBy: ['p1'], uniquePlayerCount: 6, activityDurationSeconds: 1200 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10, { exactPlayers: 1 });

        expect(rows.map((r) => [r.membershipId, r.clearTimeSeconds])).toEqual([['p1', 2400]]);
    });

    it('maxPlayers (lowman) keeps solos, duos and trios and drops bigger fireteams', () => {
        seedRun({ instanceId: '1', completedBy: ['trio'], uniquePlayerCount: 3, activityDurationSeconds: 2000 });
        seedRun({ instanceId: '2', completedBy: ['duo'], uniquePlayerCount: 2, activityDurationSeconds: 2200 });
        seedRun({ instanceId: '3', completedBy: ['full'], uniquePlayerCount: 6, activityDurationSeconds: 1200 });

        const rows = runFastestClearRows(HOURS_BACK, RAID, 10, { maxPlayers: 3 });

        expect(rows.map((r) => r.membershipId)).toEqual(['trio', 'duo']);
    });
});
