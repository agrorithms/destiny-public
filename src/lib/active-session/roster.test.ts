import { describe, it, expect } from 'vitest';
import { findFireteamLeader, fireteamTitle } from './roster';

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

    it('treats 9 and 15 as leaders and 3 and 7 as not', () => {
        expect(findFireteamLeader([member(0, 3), member(1, 9)])?.membershipId).toBe(member(1, 9).membershipId);
        expect(findFireteamLeader([member(0, 7), member(1, 15)])?.membershipId).toBe(member(1, 15).membershipId);
    });

    // Why the check is bitwise and never `status >= 8`: the two agree today only because the
    // highest flag Bungie sends is 8. A flag at 16 would make a non-leader pass `>= 8`.
    it('does not take a status above 8 without the PartyLeader bit as a leader', () => {
        expect(findFireteamLeader([member(0, 17), member(1, 3)])).toBeNull();
    });

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
            unknown: false,
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
            unknown: false,
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
            unknown: true,
            membershipId: '4611686018400000009',
            membershipType: 3,
        });
    });

    it('shows "Unknown player" when the tracked player it falls back to has no name either', () => {
        const tracked = { membershipId: '4611686018400000005', membershipType: 3, displayName: '4611686018400000005', status: 1 };

        expect(fireteamTitle(session([tracked], tracked)).name).toBe('Unknown player');
    });
});
