import { describe, it, expect } from 'vitest';
import {
    findFireteamLeader, fireteamTitle, followOpenSessions, isOpenSession, isSameSession, otherRosterMembers, sessionIdentity,
    toggleOpenSession,
} from './roster';

// The Roster rules behind each list-view row on /active-sessions (#157). They run in the
// browser, so they live in a module that imports nothing from the database, and they are
// tested here rather than through Playwright because every case is one roster in, one
// answer out. See CONTEXT.md for Roster and Fireteam Leader.

/** A Roster member with a 19-digit membership ID, like the ones Bungie sends. */
function member(seat: number, status: number, displayName = `Guardian${seat}#100${seat}`) {
    return { membershipId: `461168601840000000${seat}`, membershipType: 3, displayName, status };
}

describe('findFireteamLeader', () => {
    // `status` is Bungie's DestinyPartyMemberStates, a set of flags. 8 is PartyLeader, and it
    // only ever arrives combined with others: the snapshot in the design session saw 1, 3, 7,
    // 9, 11 and 15. A test of equality with 8 would find no leader at all.
    it('picks the member whose status has the PartyLeader bit among combined statuses', () => {
        const roster = [member(0, 3), member(1, 11), member(2, 7)];

        expect(findFireteamLeader(roster)).toBe(roster[1]);
    });

    // The test above only shows 11 winning. These are the other statuses the design snapshot
    // saw: 9 and 15 are leaders, 3 and 7 are not. Checking each real value means a rule that
    // only recognises 11 (or any one combination) fails here.
    it('treats 9 and 15 as leaders and 3 and 7 as not', () => {
        const nine = [member(0, 3), member(1, 9)];
        const fifteen = [member(0, 7), member(1, 15)];

        expect(findFireteamLeader(nine)).toBe(nine[1]);
        expect(findFireteamLeader(fifteen)).toBe(fifteen[1]);
    });

    // Why the check is bitwise and never `status >= 8`: the two agree today only because the
    // highest flag Bungie sends is 8. A flag at 16 would make a non-leader pass `>= 8`.
    it('does not take a status above 8 without the PartyLeader bit as a leader', () => {
        expect(findFireteamLeader([member(0, 17), member(1, 3)])).toBeNull();
    });

    // fireteamTitle relies on getting null here: null is what sends the row's title to the
    // tracked player instead. Picking the first member, or anyone else, would hide that the
    // Roster has no leader at all.
    it('finds no leader when nobody in the Roster is flagged', () => {
        expect(findFireteamLeader([member(0, 1), member(1, 3)])).toBeNull();
    });
});

describe('fireteamTitle', () => {
    /** A session as the API sends it: the tracked player whose row survived dedupe, plus the Roster. */
    function session(partyMembers: ReturnType<typeof member>[], tracked = member(5, 1, 'Tracked#5555')) {
        return {
            membershipId: tracked.membershipId,
            membershipType: tracked.membershipType,
            displayName: tracked.displayName,
            partyMembers,
        };
    }

    // The row reads "<leader>'s fireteam" whichever tracked player's row the API kept: dedupe
    // keeps the newest row, so the tracked player changes between polls and the leader doesn't.
    it('titles the row after the Fireteam Leader, not the tracked player', () => {
        const leader = member(1, 11, 'Nesspo#9821');

        expect(fireteamTitle(session([member(0, 3), leader]))).toEqual({
            name: 'Nesspo#9821',
            tooltip: 'Nesspo#9821',
            membershipId: leader.membershipId,
            membershipType: 3,
        });
    });

    // The crawler writes a filled-in solo row when Bungie discloses no Roster, and that row's
    // only member is flagged status 1. It is the one row in the design snapshot with no leader.
    it('falls back to the tracked player when no Roster member is flagged as leader', () => {
        const tracked = member(5, 1, 'Tracked#5555');

        expect(fireteamTitle(session([tracked], tracked))).toEqual({
            name: 'Tracked#5555',
            tooltip: 'Tracked#5555',
            membershipId: tracked.membershipId,
            membershipType: 3,
        });
    });

    // The API falls back to the bare membership ID when it knows no name for a member. A
    // 19-digit number as a title looks like a bug, so the row says "Unknown player" and keeps
    // the ID for a tooltip.
    it('shows "Unknown player" with the ID kept when the leader\'s name is a raw membership ID', () => {
        const unnamed = { membershipId: '4611686018400000009', membershipType: 3, displayName: '4611686018400000009', status: 9 };

        expect(fireteamTitle(session([member(0, 3), unnamed]))).toEqual({
            name: 'Unknown player',
            tooltip: '4611686018400000009',
            membershipId: '4611686018400000009',
            membershipType: 3,
        });
    });

    // The two fallbacks can stack: no leader sends the title to the tracked player, and the
    // tracked player can be unnamed too. The raw-ID check has to apply after the fallback,
    // not only to a leader, or this row would show a 19-digit number.
    it('shows "Unknown player" when the tracked player it falls back to has no name either', () => {
        const tracked = { membershipId: '4611686018400000005', membershipType: 3, displayName: '4611686018400000005', status: 1 };

        expect(fireteamTitle(session([tracked], tracked)).name).toBe('Unknown player');
    });
});

describe('session identity', () => {
    const SALVATIONS_EDGE = 2192826039;
    const CROTAS_END = 1566480315;

    /** One poll's view of a fireteam: the raid, the tracked player dedupe kept, and the Roster's seats. */
    function poll(activityHash: number, seats: number[], trackedSeat = seats[0]) {
        const roster = seats.map((seat) => member(seat, 1));
        const tracked = member(trackedSeat, 1);
        return { activityHash, membershipId: tracked.membershipId, displayName: tracked.displayName, partyMembers: roster };
    }

    function same(a: ReturnType<typeof poll>, b: ReturnType<typeof poll>): boolean {
        return isSameSession(sessionIdentity(a), sessionIdentity(b));
    }

    // The plain case: the next poll reports the same people in a different order. Order isn't
    // meaningful in a Roster, so the open row has to survive it.
    it('matches the same members in the same raid, in any order', () => {
        expect(same(poll(SALVATIONS_EDGE, [0, 1, 2]), poll(SALVATIONS_EDGE, [2, 0, 1]))).toBe(true);
    });

    // Someone joins between polls (or Bungie discloses one more member). The row must stay
    // open, so a Roster that grows into a superset is still the same fireteam.
    it('matches a Roster that grew between polls', () => {
        expect(same(poll(SALVATIONS_EDGE, [0, 1]), poll(SALVATIONS_EDGE, [0, 1, 2, 3]))).toBe(true);
    });

    // Someone leaves between polls. The mirror image of growth, checked on its own so a rule
    // that only looks one way (old ⊆ new) fails here.
    it('matches a Roster that shrank between polls', () => {
        expect(same(poll(SALVATIONS_EDGE, [0, 1, 2, 3]), poll(SALVATIONS_EDGE, [1, 2]))).toBe(true);
    });

    // Why the old `${membershipId}-${index}` key couldn't hold an open row: dedupe keeps the
    // newest row, so the tracked player changes between polls while the fireteam doesn't.
    it('matches when the tracked player changed but the Roster did not', () => {
        expect(same(poll(SALVATIONS_EDGE, [0, 1, 2], 0), poll(SALVATIONS_EDGE, [0, 1, 2], 2))).toBe(true);
    });

    // The same people in another raid are another fireteam: they finished one raid and
    // launched the next. An open row must not carry over to it.
    it('does not match the same members in a different raid', () => {
        expect(same(poll(SALVATIONS_EDGE, [0, 1, 2]), poll(CROTAS_END, [0, 1, 2]))).toBe(false);
    });

    // Two fireteams in the same raid that only share some members, or none, are different
    // fireteams. Matching on any overlap would open the wrong row.
    it('does not match unrelated or partly overlapping Rosters in the same raid', () => {
        expect(same(poll(SALVATIONS_EDGE, [0, 1, 2]), poll(SALVATIONS_EDGE, [3, 4, 5]))).toBe(false);
        expect(same(poll(SALVATIONS_EDGE, [0, 1, 2]), poll(SALVATIONS_EDGE, [2, 3, 4]))).toBe(false);
    });

    // Each poll is compared with the one before, not with the poll the row was opened on.
    // Here one member joins, then an original member leaves: the third Roster isn't a subset or
    // superset of the first, so an open row only survives if what's remembered moves with each
    // poll.
    it('follows an open fireteam across polls as its Roster changes', () => {
        const opened = [sessionIdentity(poll(SALVATIONS_EDGE, [0, 1]))];
        const unrelated = poll(SALVATIONS_EDGE, [7, 8]);

        const second = followOpenSessions(opened, [unrelated, poll(SALVATIONS_EDGE, [0, 1, 2])].map(sessionIdentity));
        const third = followOpenSessions(second, [poll(SALVATIONS_EDGE, [1, 2]), unrelated].map(sessionIdentity));

        expect(third).toEqual([sessionIdentity(poll(SALVATIONS_EDGE, [1, 2]))]);
    });

    // A fireteam that's gone from the page (the raid ended, or a filter or the display cap
    // dropped it) is forgotten, so a later fireteam that happens to share a member with it in
    // the same raid doesn't open by itself.
    it('forgets an open fireteam that is no longer on the page', () => {
        const opened = [sessionIdentity(poll(SALVATIONS_EDGE, [0, 1]))];

        expect(followOpenSessions(opened, [sessionIdentity(poll(CROTAS_END, [0, 1]))])).toEqual([]);
    });

    // A click on a closed row opens it and a second click closes it, and neither touches any
    // other open row: several rows can be open at once.
    it('toggles one fireteam open and shut, leaving other open fireteams alone', () => {
        const clicked = sessionIdentity(poll(SALVATIONS_EDGE, [0, 1]));
        const other = sessionIdentity(poll(SALVATIONS_EDGE, [7, 8]));

        const opened = toggleOpenSession([other], clicked);
        expect(isOpenSession(opened, clicked)).toBe(true);
        expect(isOpenSession(opened, other)).toBe(true);

        expect(toggleOpenSession(opened, clicked)).toEqual([other]);
    });
});

describe('otherRosterMembers', () => {
    function session(partyMembers: ReturnType<typeof member>[], tracked = partyMembers[0]) {
        return { membershipId: tracked.membershipId, displayName: tracked.displayName, partyMembers };
    }

    function ids(members: { membershipId: string }[]): string[] {
        return members.map((m) => m.membershipId);
    }

    // The user's decision (2026-10-14): the expanded row lists everyone except the one member
    // the row is titled after, so each member shows exactly once. With a leader, that's the
    // leader, wherever they sit and whoever the tracked player is.
    it('leaves out the Fireteam Leader, who titles the row', () => {
        const roster = [member(0, 1), member(1, 1), member(2, 9), member(3, 1)];

        expect(ids(otherRosterMembers(session(roster, roster[0])))).toEqual(ids([roster[0], roster[1], roster[3]]));
    });

    // No leader flagged: the title falls back to the tracked player, so the tracked player is
    // the one left out. Leaving out nobody would list the title's name twice.
    it('leaves out the tracked player when nobody is flagged as leader', () => {
        const roster = [member(0, 1), member(1, 1), member(2, 1)];

        expect(ids(otherRosterMembers(session(roster, roster[1])))).toEqual(ids([roster[0], roster[2]]));
    });

    // The title still names one member when it reads "Unknown player": the exclusion goes by
    // membership ID, not by the name shown, so the unnamed leader is left out like any other.
    it('leaves out the titled member when the title reads "Unknown player"', () => {
        const unnamed = { membershipId: '4611686018400000009', membershipType: 3, displayName: '4611686018400000009', status: 9 };
        const roster = [member(0, 1), unnamed, member(2, 1)];

        expect(fireteamTitle(session(roster)).name).toBe('Unknown player');
        expect(ids(otherRosterMembers(session(roster)))).toEqual(ids([roster[0], roster[2]]));
    });

    // "Exactly once" holds even if Bungie's Roster names someone twice: a repeated member is
    // listed once, in the place they first appear.
    it('lists a member the Roster repeats only once', () => {
        const roster = [member(0, 9), member(1, 1), member(2, 1), member(1, 1)];

        expect(ids(otherRosterMembers(session(roster)))).toEqual(ids([roster[1], roster[2]]));
    });
});
