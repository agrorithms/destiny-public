import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAndStoreActivity } from '@/lib/crawler/active-sessions';
import type { DestinyProfileResponse, PlayerInfo } from '@/lib/bungie/types';
import { resetTestDb, testDb } from '../helpers/db';
import {
    RAID_HASH,
    buildActiveProfile,
    buildInactiveProfile,
    buildPrivateProfile,
} from '../helpers/bungie-profile-builder';

/**
 * What the crawler's active-session check writes for one Bungie profile.
 *
 * Written before the profile -> activity parsing moved into a module the
 * profile page can import too (#9001), so that move is proved to change
 * nothing the crawler stores. Until then the only test of this function went
 * through a browser-facing route that the same ticket deletes.
 */

const T0 = new Date('2026-11-14T12:00:00Z').getTime();
const PLAYER_ID = '4611686018488900001';
const TEAMMATE_ID = '4611686018488900002';

const player: PlayerInfo = {
    membershipId: PLAYER_ID,
    membershipType: 3,
    displayName: 'CrawlerSeen',
    bungieGlobalDisplayName: 'CrawlerSeen',
    bungieGlobalDisplayNameCode: 4242,
};

interface SessionRow {
    membership_id: string;
    membership_type: number;
    display_name: string;
    activity_hash: number;
    activity_mode_hash: number | null;
    activity_mode_type: number | null;
    raid_key: string | null;
    started_at: string;
    party_members_json: string;
    player_count: number;
}

function storedRow(membershipId = PLAYER_ID): SessionRow | undefined {
    return testDb()
        .prepare('SELECT * FROM active_sessions WHERE membership_id = ?')
        .get(membershipId) as SessionRow | undefined;
}

function sessionCount(): number {
    return (testDb().prepare('SELECT COUNT(*) AS n FROM active_sessions').get() as { n: number }).n;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resetTestDb();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('parseAndStoreActivity', () => {
    it('stores a raiding fireteam as one row for the polled player, Roster as Bungie sent it', () => {
        const startTime = new Date(T0 - 20 * 60_000).toISOString();
        const profile = buildActiveProfile({
            membershipId: PLAYER_ID,
            startTime,
            partyMembers: [
                { membershipId: PLAYER_ID, displayName: 'CrawlerSeen', status: 9 },
                { membershipId: TEAMMATE_ID, status: 1 },
            ],
        });

        const result = parseAndStoreActivity(player, profile);

        expect(result.status).toBe('active');
        expect(result.session).toEqual({
            sessionKey: `${RAID_HASH}-${[PLAYER_ID, TEAMMATE_ID].sort().join('-')}`,
            activityHash: RAID_HASH,
            activityModeHash: null,
            activityModeType: 4,
            raidName: "Salvation's Edge",
            raidKey: 'salvations_edge',
            players: profile.profileTransitoryData!.data!.partyMembers,
            startedAt: startTime,
            playerCount: 2,
        });

        const row = storedRow();
        expect(row).toMatchObject({
            membership_id: PLAYER_ID,
            membership_type: 3,
            display_name: 'CrawlerSeen',
            activity_hash: RAID_HASH,
            activity_mode_hash: null,
            activity_mode_type: 4,
            raid_key: 'salvations_edge',
            started_at: startTime,
            player_count: 2,
        });
        expect(JSON.parse(row!.party_members_json)).toEqual(profile.profileTransitoryData!.data!.partyMembers);
        // One row per polled player: the teammate gets none from this check.
        expect(sessionCount()).toBe(1);
    });

    it('fills in a Roster of one when Bungie lists no party members', () => {
        const profile = buildActiveProfile({ membershipId: PLAYER_ID, partyMembers: [] });

        const result = parseAndStoreActivity(player, profile);

        const solo = [{ membershipId: PLAYER_ID, displayName: 'CrawlerSeen', status: 1, emblemHash: 0 }];
        expect(result.session?.sessionKey).toBe(`${RAID_HASH}-${PLAYER_ID}`);
        expect(result.session?.players).toEqual(solo);
        expect(result.session?.playerCount).toBe(1);
        expect(JSON.parse(storedRow()!.party_members_json)).toEqual(solo);
        expect(storedRow()!.player_count).toBe(1);
    });

    it('names the solo member by the Bungie name when the player has no display name, else "Unknown"', () => {
        const profile = buildActiveProfile({ membershipId: PLAYER_ID, partyMembers: [] });

        parseAndStoreActivity({ ...player, displayName: '' }, profile);
        expect(storedRow()!.display_name).toBe('CrawlerSeen');

        parseAndStoreActivity(
            { ...player, displayName: '', bungieGlobalDisplayName: undefined },
            profile
        );
        expect(storedRow()!.display_name).toBe('CrawlerSeen'); // the first insert's name is kept on conflict
        expect(JSON.parse(storedRow()!.party_members_json)[0].displayName).toBe('Unknown');
    });

    it('reads the most recently started character', () => {
        const older = new Date(T0 - 90 * 60_000).toISOString();
        const newer = new Date(T0 - 5 * 60_000).toISOString();
        const profile: DestinyProfileResponse = {
            ...buildActiveProfile({ membershipId: PLAYER_ID }),
            characterActivities: {
                data: {
                    a: { currentActivityHash: 1374392663, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: older },
                    b: { currentActivityHash: RAID_HASH, currentActivityModeHash: 7, currentActivityModeType: 4, dateActivityStarted: newer },
                    c: { currentActivityHash: 910380154, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: '' },
                },
            },
        };

        const result = parseAndStoreActivity(player, profile);

        expect(result.session?.activityHash).toBe(RAID_HASH);
        expect(result.session?.activityModeHash).toBe(7);
        expect(storedRow()).toMatchObject({ activity_hash: RAID_HASH, activity_mode_hash: 7, started_at: newer });
    });

    it('falls back to the transitory activity when no character reports one', () => {
        const startTime = new Date(T0 - 10 * 60_000).toISOString();
        const base = buildActiveProfile({ membershipId: PLAYER_ID, startTime });
        const profile: DestinyProfileResponse = { ...base, characterActivities: { privacy: 2 } };

        const result = parseAndStoreActivity(player, profile);

        expect(result.status).toBe('active');
        expect(storedRow()).toMatchObject({
            activity_hash: RAID_HASH,
            activity_mode_type: 4,
            started_at: startTime,
        });
    });

    it('stamps the current time when no start time is reported', () => {
        const profile = buildActiveProfile({ membershipId: PLAYER_ID, startTime: '' });

        const result = parseAndStoreActivity(player, profile);

        expect(result.session?.startedAt).toBe(new Date(T0).toISOString());
        expect(storedRow()!.started_at).toBe(new Date(T0).toISOString());
    });

    it('stores a non-raid activity with no raid key', () => {
        const profile = buildActiveProfile({ membershipId: PLAYER_ID, activityHash: 12345 });

        const result = parseAndStoreActivity(player, profile);

        expect(result.status).toBe('active');
        expect(result.session?.raidKey).toBe('unknown');
        expect(result.session?.raidName).toBe('Unknown Raid');
        expect(storedRow()).toMatchObject({ activity_hash: 12345, raid_key: null });
    });

    it('stores nothing and reports inactive when Bungie sends no transitory data', () => {
        const result = parseAndStoreActivity(player, buildInactiveProfile({ membershipId: PLAYER_ID }));

        expect(result).toEqual({ status: 'inactive', session: null });
        expect(sessionCount()).toBe(0);
    });

    it('stores nothing and reports inactive when transitory data names no activity', () => {
        // A private profile: transitory data present, activity hash 0, character activities withheld.
        const result = parseAndStoreActivity(player, buildPrivateProfile({ membershipId: PLAYER_ID }));

        expect(result).toEqual({ status: 'inactive', session: null });
        expect(sessionCount()).toBe(0);
    });
});
