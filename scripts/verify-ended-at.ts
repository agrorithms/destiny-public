/**
 * Phase 1 writer verification for the denormalized `pgcrs.ended_at` column.
 *
 * Run against a SCRATCH DB so the real dev DB is never touched:
 *   RAID_TRACKER_DB_PATH=/tmp/verify-ended-at.db npx tsx scripts/verify-ended-at.ts
 *
 * Verifies: migration applied the column; the tiered duration computation; ended_at =
 * period + duration; incomplete activities are still populated; degenerate PGCRs stay NULL.
 */
import assert from 'node:assert/strict';
import { getDb } from '../src/lib/db';
import {
    insertFullPGCR,
    computeActivityDurationSeconds,
    type InsertFullPGCRData,
    type InsertFullPGCRPlayer,
} from '../src/lib/db/queries';

if (!process.env.RAID_TRACKER_DB_PATH) {
    console.error('Refusing to run without RAID_TRACKER_DB_PATH set to a scratch path.');
    process.exit(1);
}

const PERIOD = 1_700_000_000; // arbitrary unix seconds
let passed = 0;
function check(name: string, fn: () => void): void {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.error(`  ✗ ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

function player(over: Partial<InsertFullPGCRPlayer>): InsertFullPGCRPlayer {
    return {
        instanceId: '',
        membershipId: 'm',
        membershipType: 3,
        displayName: 'p',
        characterClass: 'Hunter',
        lightLevel: 0,
        completed: true,
        kills: 0,
        deaths: 0,
        assists: 0,
        timePlayedSeconds: 0,
        ...over,
    };
}

function insert(instanceId: string, over: Partial<InsertFullPGCRData>, players: InsertFullPGCRPlayer[]): void {
    const data: InsertFullPGCRData = {
        instanceId,
        activityHash: 1,
        raidKey: 'last_wish',
        period: PERIOD,
        startingPhaseIndex: 0,
        activityWasStartedFromBeginning: true,
        completed: true,
        playerCount: players.length,
        source: 'verify',
        ...over,
    };
    insertFullPGCR(data, players.map((p) => ({ ...p, instanceId })));
}

function endedAtOf(instanceId: string): number | null {
    const row = getDb()
        .prepare('SELECT ended_at AS endedAt FROM pgcrs WHERE instance_id = ?')
        .get(instanceId) as { endedAt: number | null } | undefined;
    return row ? row.endedAt : null;
}

function main(): void {
    console.log('ended_at writer verification');
    const db = getDb();

    check('migration added ended_at column', () => {
        const cols = db.prepare('PRAGMA table_info(pgcrs)').all() as { name: string }[];
        assert.ok(cols.some((c) => c.name === 'ended_at'), 'ended_at column missing');
    });

    check('computeActivityDurationSeconds — Tier 1 (activity-level value)', () => {
        assert.equal(computeActivityDurationSeconds(7099, [player({ timePlayedSeconds: 1 })]), 7099);
    });

    check('computeActivityDurationSeconds — Tier 2 late-joiner MAX(start+time)', () => {
        const players = [
            player({ startSeconds: 98, timePlayedSeconds: 7001 }), // late joiner -> 7099
            player({ startSeconds: 0, timePlayedSeconds: 5000 }),
        ];
        assert.equal(computeActivityDurationSeconds(null, players), 7099);
    });

    check('computeActivityDurationSeconds — Tier 2 degrades to MAX(timePlayed) w/o startSeconds', () => {
        assert.equal(computeActivityDurationSeconds(undefined, [player({ timePlayedSeconds: 5000 })]), 5000);
    });

    check('computeActivityDurationSeconds — Tier 3 degenerate -> null', () => {
        assert.equal(computeActivityDurationSeconds(null, [player({ timePlayedSeconds: 0 })]), null);
        assert.equal(computeActivityDurationSeconds(0, []), null);
    });

    check('insert Tier 1 -> ended_at = period + 7099', () => {
        insert('VERIFY_T1', { activityDurationSeconds: 7099 }, [player({ startSeconds: 98, timePlayedSeconds: 7001 })]);
        assert.equal(endedAtOf('VERIFY_T1'), PERIOD + 7099);
    });

    check('insert Tier 2 late-joiner -> ended_at = period + 7099 (not 7001)', () => {
        insert('VERIFY_T2', {}, [
            player({ startSeconds: 98, timePlayedSeconds: 7001 }),
            player({ startSeconds: 0, timePlayedSeconds: 5000 }),
        ]);
        assert.equal(endedAtOf('VERIFY_T2'), PERIOD + 7099);
    });

    check('insert degenerate -> ended_at NULL', () => {
        insert('VERIFY_T3', {}, [player({ timePlayedSeconds: 0 })]);
        assert.equal(endedAtOf('VERIFY_T3'), null);
    });

    check('insert incomplete activity (completed=false) is still populated', () => {
        insert(
            'VERIFY_INCOMPLETE',
            { completed: false, activityWasStartedFromBeginning: false },
            [player({ completed: false, startSeconds: 10, timePlayedSeconds: 1200 })],
        );
        assert.equal(endedAtOf('VERIFY_INCOMPLETE'), PERIOD + 1210);
    });

    console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
}

main();
