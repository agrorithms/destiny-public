import { beforeEach, describe, expect, it } from 'vitest';
import { pollActiveSessions } from '@/lib/crawler/active-sessions';
import {
    claimSessionPollRequests,
    recordSessionCheck,
    requestSessionPoll,
} from '@/lib/db/queries';
import type { PlayerInfo } from '@/lib/bungie/types';
import { resetTestDb, testDb } from '../helpers/db';
import { seedPlayer } from '../helpers/seed';
import { buildActiveProfile, buildInactiveProfile } from '../helpers/bungie-profile-builder';
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
