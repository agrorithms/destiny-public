import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/active-sessions/route';
import { pollActiveSessions } from '@/lib/crawler/active-sessions';
import {
    claimSessionPollRequests,
    recordSessionCheck,
    requestSessionPoll,
    upsertActiveSession,
    upsertPlayer,
} from '@/lib/db/queries';
import type { PlayerInfo } from '@/lib/bungie/types';
import { resetTestDb, testDb } from '../helpers/db';
import { seedPlayer } from '../helpers/seed';
import { RAID_HASH, buildActiveProfile, buildInactiveProfile } from '../helpers/bungie-profile-builder';
import { askedAbout, stubBungieProfiles } from './bungie-stub';

/**
 * The crawler's handling of poll requests (#9002), driven through one active-session poll
 * cycle (`pollActiveSessions`, the body the loop runs inside its watchdog) against a real
 * SQLite file with only `fetch` stubbed. What is observable: rows in the Tracker, the
 * sessions the cycle reports, and which players Bungie was asked about — the crawler's budget.
 */

const REQUESTED_ID = '4611686018488960001';
const TEAMMATE_ID = '4611686018488960002';
const CANDIDATE_ID = '4611686018488960003';

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function cycle(players: PlayerInfo[] = [], options: { maxToCheck?: number; requestCap?: number } = {}) {
    return pollActiveSessions(players, options.maxToCheck ?? 200, {
        playerCheckConcurrency: 4,
        staleCheckConcurrency: 4,
        pollRequestMaxPerCycle: options.requestCap ?? 20,
    });
}

function sessionRow(membershipId: string) {
    return testDb().prepare('SELECT * FROM active_sessions WHERE membership_id = ?').get(membershipId) as
        | { membership_id: string; membership_type: number; display_name: string; raid_key: string | null }
        | undefined;
}

function playerRow(membershipId: string) {
    return testDb().prepare('SELECT * FROM players WHERE membership_id = ?').get(membershipId) as
        | { membership_type: number; bungie_global_display_name: string | null; bungie_global_display_name_code: number | null; last_session_check_at: number }
        | undefined;
}

function pendingIds(): string[] {
    return claimSessionPollRequests(1000).map((r) => r.membershipId);
}

/** Every table a stray write could land in. */
function rowsAnywhere(membershipId: string): Record<string, number> {
    const count = (sql: string) => (testDb().prepare(sql).get(membershipId) as { n: number }).n;
    return {
        active_sessions: count('SELECT COUNT(*) AS n FROM active_sessions WHERE membership_id = ?'),
        players: count('SELECT COUNT(*) AS n FROM players WHERE membership_id = ?'),
        pgcr_players: count('SELECT COUNT(*) AS n FROM pgcr_players WHERE membership_id = ?'),
        crawl_queue: count('SELECT COUNT(*) AS n FROM crawl_queue WHERE membership_id = ?'),
        session_poll_requests: count('SELECT COUNT(*) AS n FROM session_poll_requests WHERE membership_id = ?'),
    };
}

const NOWHERE = { active_sessions: 0, players: 0, pgcr_players: 0, crawl_queue: 0, session_poll_requests: 0 };

function raidingProfile(membershipId: string, name = 'Requested', code = 4321) {
    return buildActiveProfile({
        membershipId,
        displayName: name,
        bungieGlobalDisplayName: name,
        bungieGlobalDisplayNameCode: code,
        partyMembers: [{ membershipId }, { membershipId: TEAMMATE_ID }],
    });
}

function trackedPlayer(membershipId: string): PlayerInfo {
    return { membershipId, membershipType: 3, displayName: `Guardian-${membershipId}` };
}

beforeEach(() => {
    resetTestDb();
});

describe('a poll request for a player with no session row', () => {
    it('writes the session row when Bungie reports a raid, and the cycle reports the Fireteam', async () => {
        stubBungieProfiles({ [REQUESTED_ID]: raidingProfile(REQUESTED_ID) });
        requestSessionPoll(REQUESTED_ID, 3);

        const sessions = await cycle();

        expect(sessionRow(REQUESTED_ID)).toMatchObject({ membership_id: REQUESTED_ID, membership_type: 3, raid_key: 'salvations_edge' });
        expect(sessions.map((s) => s.players.map((p) => p.membershipId).sort())).toEqual([[REQUESTED_ID, TEAMMATE_ID].sort()]);
        expect(pendingIds()).toEqual([]);
    });

    it('makes the confirmed player a Tracked Player, named Name#Code from the same Bungie call', async () => {
        const calls = stubBungieProfiles({ [REQUESTED_ID]: raidingProfile(REQUESTED_ID, 'Seen', 4321) });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(playerRow(REQUESTED_ID)).toMatchObject({
            membership_type: 3,
            bungie_global_display_name: 'Seen',
            bungie_global_display_name_code: 4321,
        });
        // Polled like any player: their next session poll is scheduled from this check.
        expect(playerRow(REQUESTED_ID)!.last_session_check_at).toBeGreaterThan(0);
        expect(sessionRow(REQUESTED_ID)!.display_name).toBe('Seen');
        // One call, asking for the profile component that carries the name.
        expect(calls).toEqual([{ membershipId: REQUESTED_ID, components: '100,204,1000' }]);
    });

    it('stores the membership type Bungie reports over the one the request carried', async () => {
        stubBungieProfiles({
            [REQUESTED_ID]: buildActiveProfile({ membershipId: REQUESTED_ID, membershipType: 2, bungieGlobalDisplayName: 'CrossSave', bungieGlobalDisplayNameCode: 77 }),
        });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(playerRow(REQUESTED_ID)!.membership_type).toBe(2);
        expect(sessionRow(REQUESTED_ID)!.membership_type).toBe(2);
    });

    it('writes nothing when Bungie reports no activity, and the request is gone', async () => {
        stubBungieProfiles({ [REQUESTED_ID]: buildInactiveProfile({ membershipId: REQUESTED_ID }) });
        requestSessionPoll(REQUESTED_ID, 3);

        const sessions = await cycle();

        expect(sessions).toEqual([]);
        expect(rowsAnywhere(REQUESTED_ID)).toEqual(NOWHERE);
    });

    it('leaves no row in any table when Bungie rejects the id, and the request is gone', async () => {
        stubBungieProfiles({ [REQUESTED_ID]: 'rejected' });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(rowsAnywhere(REQUESTED_ID)).toEqual(NOWHERE);
    });

    it('consumes the request when the check times out, and writes nothing', async () => {
        stubBungieProfiles({ [REQUESTED_ID]: 'timeout' });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(rowsAnywhere(REQUESTED_ID)).toEqual(NOWHERE);
    });

    it('stops the cycle for Bungie maintenance, as a candidate check would, and the request is spent', async () => {
        stubBungieProfiles({ [REQUESTED_ID]: 'maintenance' });
        requestSessionPoll(REQUESTED_ID, 3);

        await expect(cycle()).rejects.toMatchObject({ errorStatus: 'SystemDisabled' });
        expect(rowsAnywhere(REQUESTED_ID)).toEqual(NOWHERE);
    });

    it('lists the raid but tracks nobody when Bungie leaves out the profile component', async () => {
        const profile = raidingProfile(REQUESTED_ID);
        delete profile.profile;
        stubBungieProfiles({ [REQUESTED_ID]: profile });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(sessionRow(REQUESTED_ID)).toMatchObject({ membership_type: 3, display_name: 'Unknown' });
        expect(playerRow(REQUESTED_ID)).toBeUndefined();
    });

    it('polls exactly the per-cycle cap, oldest first, and the rest on later cycles', async () => {
        const ids = ['4611686018488961001', '4611686018488961002', '4611686018488961003'];
        const calls = stubBungieProfiles(Object.fromEntries(ids.map((id) => [id, buildInactiveProfile({ membershipId: id })])));
        for (const id of ids) requestSessionPoll(id, 3);
        // Requested newest-first in time, so arrival order and age disagree.
        ids.forEach((id, i) => {
            testDb().prepare('UPDATE session_poll_requests SET requested_at = ? WHERE membership_id = ?').run(nowSec() - 10 * i, id);
        });

        await cycle([], { requestCap: 2 });
        expect(askedAbout(calls).sort()).toEqual([ids[2], ids[1]].sort());
        expect(pendingIds()).toEqual([ids[0]]);

        await cycle([], { requestCap: 2 });
        expect(askedAbout(calls).slice(2)).toEqual([ids[0]]);
        expect(pendingIds()).toEqual([]);
    });

    it('polls requests on top of the normal batch, not inside it', async () => {
        seedPlayer(CANDIDATE_ID, 'Candidate', 1);
        const calls = stubBungieProfiles({
            [CANDIDATE_ID]: buildInactiveProfile({ membershipId: CANDIDATE_ID }),
            [REQUESTED_ID]: buildInactiveProfile({ membershipId: REQUESTED_ID }),
        });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle([trackedPlayer(CANDIDATE_ID)], { maxToCheck: 1, requestCap: 1 });

        expect(askedAbout(calls).sort()).toEqual([CANDIDATE_ID, REQUESTED_ID].sort());
    });

    it('polls a requested player who is already in the batch once', async () => {
        seedPlayer(CANDIDATE_ID, 'Candidate', 1);
        const calls = stubBungieProfiles({ [CANDIDATE_ID]: buildInactiveProfile({ membershipId: CANDIDATE_ID }) });
        requestSessionPoll(CANDIDATE_ID, 3);

        await cycle([trackedPlayer(CANDIDATE_ID)]);

        expect(askedAbout(calls)).toEqual([CANDIDATE_ID]);
        expect(pendingIds()).toEqual([]);
    });

    it('polls nothing by request when the per-cycle cap is zero', async () => {
        const calls = stubBungieProfiles({});
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle([], { requestCap: 0 });

        expect(calls).toEqual([]);
        expect(pendingIds()).toEqual([REQUESTED_ID]);
    });

    it('costs no Bungie call for a requested player in privacy backoff', async () => {
        seedPlayer(REQUESTED_ID, 'Hidden', 1);
        requestSessionPoll(REQUESTED_ID, 3);
        // The player went private after the request was made.
        recordSessionCheck(REQUESTED_ID, 'privacy');
        const calls = stubBungieProfiles({});

        await cycle();

        expect(calls).toEqual([]);
        expect(pendingIds()).toEqual([]);
    });

    it('bypasses an offline backoff: the requested player is polled and their raid listed', async () => {
        seedPlayer(REQUESTED_ID, 'Back', 1);
        recordSessionCheck(REQUESTED_ID, 'offline');
        stubBungieProfiles({ [REQUESTED_ID]: raidingProfile(REQUESTED_ID, 'Back', 1) });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(sessionRow(REQUESTED_ID)).toBeDefined();
    });

    it('puts a tracked player Bungie finds private into privacy backoff, as any poll does', async () => {
        seedPlayer(REQUESTED_ID, 'Hidden', 1);
        stubBungieProfiles({ [REQUESTED_ID]: 'rejected' });
        requestSessionPoll(REQUESTED_ID, 3);

        await cycle();

        expect(requestSessionPoll(REQUESTED_ID, 3)).toBe('privacy_backoff');
    });
});

// ---- Requests on players who have a session row ----

const ANCHOR_ID = '4611686018488970001';
const MATE_A = '4611686018488970002';
const MATE_B = '4611686018488970003';

/**
 * A session row as the crawler writes it: the Roster exactly as Bungie's transitory data
 * sends it, with no membership type on any member. Aged by moving checked_at back, the one
 * thing no production writer does.
 */
function seedSession(anchorId: string, ageSeconds: number, roster: string[] = [anchorId]): void {
    upsertActiveSession({
        membershipId: anchorId,
        membershipType: 3,
        displayName: `Guardian-${anchorId}`,
        activityHash: RAID_HASH,
        activityModeType: 4,
        raidKey: 'salvations_edge',
        startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        partyMembersJson: JSON.stringify(roster.map((membershipId) => ({ membershipId, emblemHash: 0, status: 1 }))),
        playerCount: roster.length,
    });
    testDb().prepare('UPDATE active_sessions SET checked_at = ? WHERE membership_id = ?').run(nowSec() - ageSeconds, anchorId);
}

function checkedAt(membershipId: string): number | undefined {
    return (testDb().prepare('SELECT checked_at FROM active_sessions WHERE membership_id = ?').get(membershipId) as
        | { checked_at: number }
        | undefined)?.checked_at;
}

function raiding(membershipId: string, roster: string[]) {
    return buildActiveProfile({ membershipId, partyMembers: roster.map((id) => ({ membershipId: id })) });
}

async function listedRosters(): Promise<string[][]> {
    const body = await (await GET(new NextRequest('http://localhost:3100/api/active-sessions'))).json();
    return (body.sessions as Array<{ partyMembers: Array<{ membershipId: string }> }>)
        .map((s) => s.partyMembers.map((m) => m.membershipId).sort());
}

describe('a poll request for a player with a session row', () => {
    it('re-verifies a fresh row on the next cycle, which an unrequested fresh row would not get', async () => {
        seedSession(ANCHOR_ID, 60);
        const calls = stubBungieProfiles({ [ANCHOR_ID]: raiding(ANCHOR_ID, [ANCHOR_ID]) });

        await cycle();
        expect(calls).toEqual([]);

        requestSessionPoll(ANCHOR_ID, 3);
        await cycle();

        expect(askedAbout(calls)).toEqual([ANCHOR_ID]);
        expect(checkedAt(ANCHOR_ID)).toBeGreaterThan(nowSec() - 60);
    });

    it('re-verifies the row when the player gained it after the request was queued', async () => {
        requestSessionPoll(ANCHOR_ID, 3);
        seedSession(ANCHOR_ID, 60);
        const calls = stubBungieProfiles({ [ANCHOR_ID]: raiding(ANCHOR_ID, [ANCHOR_ID]) });

        await cycle();

        expect(askedAbout(calls)).toEqual([ANCHOR_ID]);
        expect(checkedAt(ANCHOR_ID)).toBeGreaterThan(nowSec() - 60);
    });

    it('is consumed once the row is re-verified: the next cycle leaves the fresh row alone', async () => {
        seedSession(ANCHOR_ID, 60);
        const calls = stubBungieProfiles({ [ANCHOR_ID]: raiding(ANCHOR_ID, [ANCHOR_ID]) });
        requestSessionPoll(ANCHOR_ID, 3);

        await cycle();
        await cycle();

        expect(askedAbout(calls)).toEqual([ANCHOR_ID]);
    });

    it('puts requested rows ahead of older unrequested stale rows, all inside the re-verify limit', async () => {
        const freshRequested = '4611686018488971001';
        const staleRequested = '4611686018488971002';
        const oldest = '4611686018488971003';
        const older = '4611686018488971004';
        const old = '4611686018488971005';
        seedSession(freshRequested, 60);
        seedSession(staleRequested, 320);
        seedSession(oldest, 1500);
        seedSession(older, 1200);
        seedSession(old, 900);
        requestSessionPoll(freshRequested, 3);
        requestSessionPoll(staleRequested, 3);
        const calls = stubBungieProfiles(Object.fromEntries(
            [freshRequested, staleRequested, oldest, older, old].map((id) => [id, raiding(id, [id])])
        ));

        await pollActiveSessions([], 200, { staleReverifyLimit: 3, pollRequestMaxPerCycle: 20 });

        expect(askedAbout(calls).sort()).toEqual([freshRequested, staleRequested, oldest].sort());
    });

    it('removes only the requested player\'s row when they are cleanly gone and a probed teammate still raids', async () => {
        seedPlayer(MATE_A, 'MateA', 1);
        seedSession(ANCHOR_ID, 60, [ANCHOR_ID, MATE_A]);
        requestSessionPoll(ANCHOR_ID, 3);
        stubBungieProfiles({
            [ANCHOR_ID]: buildInactiveProfile({ membershipId: ANCHOR_ID }),
            [MATE_A]: raiding(MATE_A, [MATE_A, '4611686018488970009']),
        });

        await cycle();

        expect(checkedAt(ANCHOR_ID)).toBeUndefined();
        expect(await listedRosters()).toEqual([[MATE_A, '4611686018488970009'].sort()]);
    });

    it('removes the row when the requested player and every probed teammate are cleanly inactive', async () => {
        seedPlayer(MATE_A, 'MateA', 1);
        seedPlayer(MATE_B, 'MateB', 2);
        seedSession(ANCHOR_ID, 60, [ANCHOR_ID, MATE_A, MATE_B]);
        requestSessionPoll(ANCHOR_ID, 3);
        const calls = stubBungieProfiles({
            [ANCHOR_ID]: buildInactiveProfile({ membershipId: ANCHOR_ID }),
            [MATE_A]: buildInactiveProfile({ membershipId: MATE_A }),
            [MATE_B]: buildInactiveProfile({ membershipId: MATE_B }),
        });

        await cycle();

        expect(askedAbout(calls).sort()).toEqual([ANCHOR_ID, MATE_A, MATE_B].sort());
        expect(checkedAt(ANCHOR_ID)).toBeUndefined();
        expect(await listedRosters()).toEqual([]);
    });

    it('keeps the row when a teammate probe times out, and re-verifies it again next cycle', async () => {
        seedPlayer(MATE_A, 'MateA', 1);
        seedSession(ANCHOR_ID, 60, [ANCHOR_ID, MATE_A]);
        requestSessionPoll(ANCHOR_ID, 3);
        const calls = stubBungieProfiles({
            [ANCHOR_ID]: buildInactiveProfile({ membershipId: ANCHOR_ID }),
            [MATE_A]: 'timeout',
        });
        const before = checkedAt(ANCHOR_ID);

        await cycle();
        expect(checkedAt(ANCHOR_ID)).toBe(before);
        expect(await listedRosters()).toEqual([[ANCHOR_ID, MATE_A].sort()]);

        await cycle();
        expect(askedAbout(calls)).toEqual([ANCHOR_ID, MATE_A, ANCHOR_ID, MATE_A]);
    });

    it('keeps the row when the requested player\'s own check errors, and re-verifies it again next cycle', async () => {
        seedSession(ANCHOR_ID, 60);
        requestSessionPoll(ANCHOR_ID, 3);
        const calls = stubBungieProfiles({ [ANCHOR_ID]: 'timeout' });

        await cycle();
        expect(checkedAt(ANCHOR_ID)).toBeDefined();

        await cycle();
        expect(askedAbout(calls)).toEqual([ANCHOR_ID, ANCHOR_ID]);
    });
});

describe('the stale re-verify\'s teammate probe', () => {
    it('probes a teammate the Tracker knows, with the membership type it has for them', async () => {
        upsertPlayer({ membershipId: MATE_A, membershipType: 2, displayName: 'MateA' });
        seedSession(ANCHOR_ID, 400, [ANCHOR_ID, MATE_A]);
        const calls: string[] = [];
        stubBungieProfiles({
            [ANCHOR_ID]: buildInactiveProfile({ membershipId: ANCHOR_ID }),
            [MATE_A]: raiding(MATE_A, [MATE_A, ANCHOR_ID]),
        });
        const stubbed = globalThis.fetch;
        vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
            calls.push(String(input));
            return stubbed(input);
        });

        await cycle();

        expect(calls.some((url) => url.includes(`/Destiny2/2/Profile/${MATE_A}/`))).toBe(true);
        expect(await listedRosters()).toEqual([[ANCHOR_ID, MATE_A].sort()]);
    });

    it('skips a teammate the Tracker doesn\'t know, since Bungie needs a membership type', async () => {
        seedSession(ANCHOR_ID, 400, [ANCHOR_ID, MATE_A]);
        const calls = stubBungieProfiles({ [ANCHOR_ID]: buildInactiveProfile({ membershipId: ANCHOR_ID }) });

        await cycle();

        expect(askedAbout(calls)).toEqual([ANCHOR_ID]);
        expect(checkedAt(ANCHOR_ID)).toBeUndefined();
    });

    it('probes at most two teammates', async () => {
        const mates = ['4611686018488972001', '4611686018488972002', '4611686018488972003'];
        for (const id of mates) seedPlayer(id, `Mate-${id}`, 1);
        seedSession(ANCHOR_ID, 400, [ANCHOR_ID, ...mates]);
        const calls = stubBungieProfiles(Object.fromEntries(
            [ANCHOR_ID, ...mates].map((id) => [id, buildInactiveProfile({ membershipId: id })])
        ));

        await cycle();

        expect(askedAbout(calls)).toEqual([ANCHOR_ID, mates[0], mates[1]]);
    });
});
