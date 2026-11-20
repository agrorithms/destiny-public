import { describe, expect, it } from 'vitest';
import type { DestinyProfileResponse } from '../bungie/types';
import {
    MAX_NAME_LOOKUP_IDS,
    PRIVATE_ACTIVITY_NAME,
    includesPlayer,
    isActivityWithheld,
    isLinkable,
    linkedPlayerName,
    liveCard,
    pickHeaderPlayer,
    profileOwner,
    provisionalCard,
    readProfileActivity,
    teammatesToProbe,
    unnamedMemberIds,
    withNames,
    type ProfileActivity,
    type ProfileCard,
} from './live-profile';
import {
    RAID_HASH,
    buildActiveProfile,
    buildInactiveProfile,
    buildPrivateProfile,
} from '../../../tests/helpers/bungie-profile-builder';

/**
 * What the profile page draws from the viewer's own Bungie response (#9001). The browser never
 * sends any of it to the server, so these rules are the whole of how a live card is built:
 * what counts as an activity (the same reading the crawler stores, see
 * tests/db/parse-and-store-activity.test.ts), how the Roster is named, and whom a private
 * player's page may probe.
 */

const SELF = '4611686018488930001';
const MATE = '4611686018488930002';
const STRANGER = '4611686018488930003';
const NOW = new Date('2026-11-14T12:00:00Z');

const subject = { membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042' };

function activity(overrides: Partial<ProfileActivity> = {}): ProfileActivity {
    return {
        activityHash: RAID_HASH,
        activityModeHash: null,
        activityModeType: 4,
        startedAt: '2026-11-14T11:30:00.000Z',
        partyMembers: [
            { membershipId: SELF, displayName: 'Viewed', status: 9, emblemHash: 0 },
            { membershipId: MATE, displayName: 'MateOnBungie', status: 1, emblemHash: 0 },
            { membershipId: STRANGER, displayName: STRANGER, status: 1, emblemHash: 0 },
        ],
        ...overrides,
    };
}

function cardWith(members: ProfileCard['partyMembers']): ProfileCard {
    return {
        membershipId: SELF,
        membershipType: 3,
        displayName: 'Viewed#0042',
        activityHash: RAID_HASH,
        raidKey: 'salvations_edge',
        raidName: "Salvation's Edge",
        startedAt: NOW.toISOString(),
        playerCount: members.length,
        partyMembers: members,
    };
}

describe('readProfileActivity', () => {
    it('reads the raid, start time and Roster of an active profile', () => {
        const startTime = '2026-11-14T11:40:00.000Z';
        const profile = buildActiveProfile({ membershipId: SELF, startTime });

        expect(readProfileActivity(profile)).toEqual({
            activityHash: RAID_HASH,
            activityModeHash: null,
            activityModeType: 4,
            startedAt: startTime,
            partyMembers: profile.profileTransitoryData!.data!.partyMembers,
        });
    });

    it('is null when Bungie sends no transitory data', () => {
        expect(readProfileActivity(buildInactiveProfile({ membershipId: SELF }))).toBeNull();
    });

    it('is null when transitory data names no activity', () => {
        expect(readProfileActivity(buildPrivateProfile({ membershipId: SELF }))).toBeNull();
    });

    it('reads the most recently started character, and its mode hash', () => {
        const profile: DestinyProfileResponse = {
            ...buildActiveProfile({ membershipId: SELF }),
            characterActivities: {
                data: {
                    a: { currentActivityHash: 1374392663, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: '2026-11-14T10:00:00Z' },
                    b: { currentActivityHash: RAID_HASH, currentActivityModeHash: 7, currentActivityModeType: 4, dateActivityStarted: '2026-11-14T11:55:00Z' },
                    c: { currentActivityHash: 910380154, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: 'not a date' },
                },
            },
        };

        expect(readProfileActivity(profile)).toMatchObject({
            activityHash: RAID_HASH,
            activityModeHash: 7,
            startedAt: '2026-11-14T11:55:00Z',
        });
    });

    describe('picks the most recently started character whatever order Bungie lists them in', () => {
        const older = { currentActivityHash: 1374392663, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: '2026-11-14T10:00:00Z' };
        const newer = { currentActivityHash: RAID_HASH, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: '2026-11-14T11:55:00Z' };
        const unreadable = { currentActivityHash: 910380154, currentActivityModeHash: 0, currentActivityModeType: 4, dateActivityStarted: 'not a date' };

        it.each([
            ['older first', [older, newer]],
            ['newer first', [newer, older]],
            ['an unreadable start first', [unreadable, newer]],
            ['an unreadable start last', [newer, unreadable]],
            ['an unreadable start between', [older, unreadable, newer]],
        ])('%s', (_label, list) => {
            const profile: DestinyProfileResponse = {
                ...buildActiveProfile({ membershipId: SELF }),
                characterActivities: { data: Object.fromEntries(list.map((c, i) => [`c${i}`, c])) },
            };

            expect(readProfileActivity(profile)?.activityHash).toBe(RAID_HASH);
        });
    });

    // The crawler reads every profile it polls through this function, so a malformed character
    // map must not throw: a null entry sorts last, as the crawler always treated it.
    describe('passes over a null character entry wherever Bungie lists it', () => {
        const newer = { currentActivityHash: RAID_HASH, currentActivityModeHash: 7, currentActivityModeType: 4, dateActivityStarted: '2026-11-14T11:55:00Z' };
        const missing = null as unknown as typeof newer;

        it.each([
            ['null first', [missing, newer]],
            ['null last', [newer, missing]],
        ])('%s', (_label, list) => {
            const profile: DestinyProfileResponse = {
                ...buildActiveProfile({ membershipId: SELF }),
                characterActivities: { data: Object.fromEntries(list.map((c, i) => [`c${i}`, c])) },
            };

            expect(readProfileActivity(profile)).toMatchObject({
                activityHash: RAID_HASH,
                activityModeHash: 7,
                startedAt: '2026-11-14T11:55:00Z',
            });
        });

        it('reads the transitory activity when every entry is null', () => {
            const startTime = '2026-11-14T11:45:00.000Z';
            const profile: DestinyProfileResponse = {
                ...buildActiveProfile({ membershipId: SELF, startTime }),
                characterActivities: { data: { c0: missing, c1: missing } },
            };

            expect(readProfileActivity(profile)).toMatchObject({ activityHash: RAID_HASH, startedAt: startTime });
        });
    });

    it('is null when the profile has no transitory component at all', () => {
        expect(readProfileActivity({})).toBeNull();
        expect(readProfileActivity({ profileTransitoryData: {} })).toBeNull();
    });

    it('copes with transitory data that names no activity and lists no Roster', () => {
        const profile = {
            characterActivities: {
                data: { c: { currentActivityHash: RAID_HASH, currentActivityModeHash: 0, currentActivityModeType: 0, dateActivityStarted: '' } },
            },
            profileTransitoryData: { data: {} as never },
        } satisfies DestinyProfileResponse;

        expect(readProfileActivity(profile)).toEqual({
            activityHash: RAID_HASH,
            activityModeHash: null,
            activityModeType: null,
            startedAt: null,
            partyMembers: [],
        });
        expect(readProfileActivity({ ...profile, characterActivities: { data: {} } })).toBeNull();
    });

    it('reads the transitory activity when Bungie sends no character component at all', () => {
        const startTime = '2026-11-14T11:45:00.000Z';
        const profile = { profileTransitoryData: buildActiveProfile({ membershipId: SELF, startTime }).profileTransitoryData };

        expect(readProfileActivity(profile)).toMatchObject({ activityHash: RAID_HASH, startedAt: startTime });
    });

    it('falls back to the transitory activity when the characters are withheld', () => {
        const startTime = '2026-11-14T11:45:00.000Z';
        const profile = { ...buildActiveProfile({ membershipId: SELF, startTime }), characterActivities: { privacy: 2 } };

        expect(readProfileActivity(profile)).toMatchObject({ activityHash: RAID_HASH, activityModeType: 4, startedAt: startTime });
    });

    it('has no start time when Bungie reports none, and an empty Roster when it lists nobody', () => {
        const profile = buildActiveProfile({ membershipId: SELF, startTime: '', partyMembers: [] });

        expect(readProfileActivity(profile)).toMatchObject({ startedAt: null, partyMembers: [], activityModeType: 4 });
    });

    it('reads a mode type of 0 as none', () => {
        const profile = buildActiveProfile({ membershipId: SELF });
        profile.characterActivities!.data![Object.keys(profile.characterActivities!.data!)[0]].currentActivityModeType = 0;
        profile.profileTransitoryData!.data!.currentActivity.currentActivityModeType = 0;

        expect(readProfileActivity(profile)?.activityModeType).toBeNull();
    });
});

describe('isActivityWithheld', () => {
    it('is false for a public profile that shows its characters', () => {
        expect(isActivityWithheld(buildActiveProfile({ membershipId: SELF }))).toBe(false);
        expect(isActivityWithheld(buildInactiveProfile({ membershipId: SELF }))).toBe(false);
    });

    it('is true when the account is marked private', () => {
        const profile = buildActiveProfile({ membershipId: SELF });
        profile.profile!.data!.userInfo.isPublic = false;
        profile.characterActivities = { data: {} };

        expect(isActivityWithheld(profile)).toBe(true);
    });

    it('is true when the character activities are withheld', () => {
        const profile = { ...buildActiveProfile({ membershipId: SELF }), characterActivities: { privacy: 2 } };

        expect(isActivityWithheld(profile)).toBe(true);
    });

    it('is false for a profile missing its identity component, or parts of it', () => {
        expect(isActivityWithheld({})).toBe(false);
        expect(isActivityWithheld({ profile: {} })).toBe(false);
        expect(isActivityWithheld({ profile: { data: {} as never } })).toBe(false);
    });

    it('is false when Bungie leaves the character activities out altogether', () => {
        const profile = buildActiveProfile({ membershipId: SELF });
        delete profile.characterActivities;

        expect(isActivityWithheld(profile)).toBe(false);
    });
});

describe('profileOwner and pickHeaderPlayer', () => {
    it('names the profile owner by Name#Code', () => {
        const profile = buildActiveProfile({
            membershipId: SELF, membershipType: 2, displayName: 'Platform', bungieGlobalDisplayName: 'Owner', bungieGlobalDisplayNameCode: 7,
        });

        expect(profileOwner(profile)).toEqual({ membershipId: SELF, membershipType: 2, displayName: 'Owner#0007', baseName: 'Owner' });
    });

    it('falls back to the platform name when there is no Bungie name', () => {
        const profile = buildActiveProfile({ membershipId: SELF, displayName: 'Platform' });
        profile.profile!.data!.userInfo.bungieGlobalDisplayName = undefined;
        profile.profile!.data!.userInfo.bungieGlobalDisplayNameCode = undefined;

        expect(profileOwner(profile)).toEqual({ membershipId: SELF, membershipType: 3, displayName: 'Platform', baseName: 'Platform' });
    });

    it('is null when the profile carries no identity', () => {
        expect(profileOwner({})).toBeNull();
        expect(profileOwner({ profile: {} })).toBeNull();
    });

    const owner = { membershipId: SELF, membershipType: 3, displayName: 'Fresh#0001', baseName: 'Fresh' };

    it('keeps the stored name when the Tracker has one', () => {
        const stored = { membershipId: SELF, membershipType: 3, displayName: 'Stored#0002', baseName: 'Stored' };

        expect(pickHeaderPlayer(stored, owner)).toBe(stored);
    });

    it("uses Bungie's name when the Tracker only has the bare id", () => {
        const stored = { membershipId: SELF, membershipType: 3, displayName: SELF, baseName: SELF };

        expect(pickHeaderPlayer(stored, owner)).toBe(owner);
        expect(pickHeaderPlayer(null, owner)).toBe(owner);
        expect(pickHeaderPlayer(stored, null)).toBe(stored);
    });
});

describe('liveCard', () => {
    it("draws the card from the viewer's response: raid, start, count, the viewed player named and linkable", () => {
        expect(liveCard(subject, activity(), NOW)).toEqual({
            membershipId: SELF,
            membershipType: 3,
            displayName: 'Viewed#0042',
            activityHash: RAID_HASH,
            raidKey: 'salvations_edge',
            raidName: "Salvation's Edge",
            startedAt: '2026-11-14T11:30:00.000Z',
            playerCount: 3,
            partyMembers: [
                { membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 9 },
                // Bungie's own name for a member is kept, but nothing to link to yet.
                { membershipId: MATE, displayName: 'MateOnBungie', status: 1 },
                // A bare id for a name is shown as the id, never as a name.
                { membershipId: STRANGER, displayName: STRANGER, status: 1 },
            ],
        });
    });

    it('treats an empty name as no name', () => {
        const card = liveCard(subject, activity({
            partyMembers: [{ membershipId: MATE, displayName: '', status: 1, emblemHash: 0 }],
        }), NOW);

        expect(card.partyMembers).toEqual([{ membershipId: MATE, displayName: MATE, status: 1 }]);
    });

    it('fills in a Roster of one, and the current time when Bungie gives no start', () => {
        const card = liveCard(subject, activity({ partyMembers: [], startedAt: null }), NOW);

        expect(card.partyMembers).toEqual([{ membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 1 }]);
        expect(card.playerCount).toBe(1);
        expect(card.startedAt).toBe(NOW.toISOString());
    });

    it('names a non-raid activity by its mode, and in orbit as such', () => {
        const strike = liveCard(subject, activity({ activityHash: 12345, activityModeType: 3 }), NOW);
        const orbit = liveCard(subject, activity({ activityHash: 12345, activityModeType: null, activityModeHash: 2166136261 }), NOW);

        expect(strike).toMatchObject({ raidKey: 'unknown', raidName: 'Strike' });
        expect(orbit.raidName).toBe('In Orbit');
    });
});

describe('provisionalCard', () => {
    it("shows a private player's fireteam before its raid is known", () => {
        const startTime = '2026-11-14T11:50:00.000Z';
        const profile = buildPrivateProfile({
            membershipId: SELF,
            startTime,
            partyMembers: [
                { membershipId: SELF, displayName: 'Viewed', status: 9 },
                { membershipId: MATE, displayName: 'MateOnBungie', status: 1 },
            ],
        });

        expect(provisionalCard(subject, profile)).toEqual({
            membershipId: SELF,
            membershipType: 3,
            displayName: 'Viewed#0042',
            activityHash: 0,
            raidKey: 'unknown',
            raidName: PRIVATE_ACTIVITY_NAME,
            startedAt: startTime,
            playerCount: 2,
            partyMembers: [
                { membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 9 },
                { membershipId: MATE, displayName: 'MateOnBungie', status: 1 },
            ],
        });
    });

    it("takes Bungie's player count when it gives one beyond the Roster it lists", () => {
        const profile = buildPrivateProfile({ membershipId: SELF, partyMembers: [{ membershipId: SELF }] });
        profile.profileTransitoryData!.data!.currentActivity.numberOfPlayers = 4;

        expect(provisionalCard(subject, profile)?.playerCount).toBe(4);
    });

    it('falls back to a Roster of one when Bungie lists nobody', () => {
        const profile = buildPrivateProfile({ membershipId: SELF, startTime: '2026-11-14T11:50:00.000Z' });
        delete (profile.profileTransitoryData!.data as { partyMembers?: unknown }).partyMembers;
        profile.profileTransitoryData!.data!.currentActivity.numberOfPlayers = 0;

        expect(provisionalCard(subject, profile)).toMatchObject({
            playerCount: 1,
            partyMembers: [{ membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 1 }],
        });
    });

    it('is null when Bungie shows no activity at all', () => {
        expect(provisionalCard(subject, {})).toBeNull();
        expect(provisionalCard(subject, { profileTransitoryData: { data: {} as never } })).toBeNull();
        expect(provisionalCard(subject, buildPrivateProfile({ membershipId: SELF, withTransitoryData: false }))).toBeNull();
        const noStart = buildPrivateProfile({ membershipId: SELF, startTime: '' });
        expect(provisionalCard(subject, noStart)).toBeNull();
    });
});

describe('naming the Roster', () => {
    const card = cardWith([
        { membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 9 },
        { membershipId: MATE, displayName: 'MateOnBungie', status: 1 },
        { membershipId: STRANGER, displayName: STRANGER, status: 1 },
        { membershipId: STRANGER, displayName: STRANGER, status: 1 },
    ]);

    it('can link only the members whose membership type it knows', () => {
        expect(card.partyMembers.filter(isLinkable).map((member) => member.membershipId)).toEqual([SELF]);
    });

    it('asks only about members with nothing to link to, once each, up to the limit', () => {
        expect(unnamedMemberIds(card, MAX_NAME_LOOKUP_IDS)).toEqual([MATE, STRANGER]);
        expect(unnamedMemberIds(card, 1)).toEqual([MATE]);
    });

    it('puts a known name and membership type on each member it names, and leaves the rest', () => {
        const named = withNames(card, [
            { membershipId: MATE, membershipType: 2, displayName: 'Mate#0005' },
            { membershipId: '999', membershipType: 3, displayName: 'NotInThisFireteam#0001' },
        ]);

        expect(named.partyMembers).toEqual([
            { membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 9 },
            { membershipId: MATE, membershipType: 2, displayName: 'Mate#0005', status: 1 },
            { membershipId: STRANGER, displayName: STRANGER, status: 1 },
            { membershipId: STRANGER, displayName: STRANGER, status: 1 },
        ]);
        // The card it was given is left as it was.
        expect(card.partyMembers[1]).toEqual({ membershipId: MATE, displayName: 'MateOnBungie', status: 1 });
    });

    it("keeps the member's current name when the known one is only a bare id", () => {
        const named = withNames(card, [{ membershipId: MATE, membershipType: 2, displayName: MATE }]);

        expect(named.partyMembers[1]).toEqual({ membershipId: MATE, membershipType: 2, displayName: 'MateOnBungie', status: 1 });
    });

    it('names a looked-up account by Name#Code', () => {
        expect(linkedPlayerName({
            membershipId: STRANGER, membershipType: 1, displayName: 'Base', bungieGlobalDisplayName: 'Base', bungieGlobalDisplayNameCode: 12,
        })).toEqual({ membershipId: STRANGER, membershipType: 1, displayName: 'Base#0012' });
    });
});

describe('probing for a private player', () => {
    it('probes up to three teammates the site can link, never the viewed player', () => {
        const card = cardWith([
            { membershipId: SELF, membershipType: 3, displayName: 'Viewed#0042', status: 9 },
            { membershipId: STRANGER, displayName: STRANGER, status: 1 },
            { membershipId: 'a', membershipType: 1, displayName: 'A#0001', status: 1 },
            { membershipId: 'b', membershipType: 2, displayName: 'B#0002', status: 1 },
            { membershipId: 'c', membershipType: 3, displayName: 'C#0003', status: 1 },
            { membershipId: 'd', membershipType: 3, displayName: 'D#0004', status: 1 },
        ]);

        expect(teammatesToProbe(card, SELF)).toEqual([
            { membershipId: 'a', membershipType: 1 },
            { membershipId: 'b', membershipType: 2 },
            { membershipId: 'c', membershipType: 3 },
        ]);
    });

    it("recognises a teammate's raid that contains the viewed player", () => {
        expect(includesPlayer(activity(), SELF)).toBe(true);
        expect(includesPlayer(activity(), '4611686018488939999')).toBe(false);
    });
});
