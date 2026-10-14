// Roster rules for the active-sessions list view: who leads a fireteam, and what its row is
// called. Pure and browser-safe on purpose: the page imports this, so it must never import
// the database (dedupe.ts and format.ts both do). See CONTEXT.md for Roster and Fireteam Leader.

/** A Roster member as the /api/active-sessions response carries it. */
export interface RosterMember {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    /** Bungie's DestinyPartyMemberStates: a set of flags, not a single state. */
    status?: number;
}

/** DestinyPartyMemberStates.PartyLeader. */
const PARTY_LEADER = 8;

/**
 * The Roster member flagged as Fireteam Leader, or null when nobody is.
 *
 * Bitwise, never `status >= PARTY_LEADER`: the two agree only while 8 is the highest flag
 * Bungie sends, and a flag at 16 would make a non-leader pass the comparison.
 */
export function findFireteamLeader<T extends RosterMember>(roster: T[]): T | null {
    return roster.find((member) => ((member.status ?? 0) & PARTY_LEADER) !== 0) ?? null;
}

/** What a list-view row is called, and whose player page its name links to. */
export interface FireteamTitle {
    /** The full display name (`Name#Code` when the server knows both parts), or "Unknown player". */
    name: string;
    /** True when there was no name to show; `membershipId` is then the tooltip. */
    unknown: boolean;
    membershipId: string;
    membershipType?: number;
}

/**
 * The server falls back to the bare membership ID when it has no name for a player (see
 * `isLikelyMembershipId` in the active-sessions route). Same test here, plus the ID itself.
 */
function isRawMembershipId(displayName: string, membershipId: string): boolean {
    return !displayName || displayName === membershipId || /^\d{16,}$/.test(displayName);
}

/**
 * A row's title: the Fireteam Leader, or the session's tracked player when nobody in the
 * Roster is flagged (the crawler's filled-in solo row is the case seen in practice).
 */
export function fireteamTitle(session: {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    partyMembers: RosterMember[];
}): FireteamTitle {
    const subject = findFireteamLeader(session.partyMembers) ?? session;
    const unknown = isRawMembershipId(subject.displayName, subject.membershipId);

    return {
        name: unknown ? 'Unknown player' : subject.displayName,
        unknown,
        membershipId: subject.membershipId,
        membershipType: subject.membershipType,
    };
}
