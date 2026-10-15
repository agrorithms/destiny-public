// Roster rules for the active-sessions list view: who leads a fireteam, what its row is called,
// who its expanded row lists, and whether two polls describe the same fireteam. Pure and
// browser-safe on purpose: the page imports this, so it must never import the database
// (dedupe.ts and format.ts both do, and import their shared rules from here instead). See
// CONTEXT.md for Roster and Fireteam Leader.

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

/** A session as the /api/active-sessions response carries it: the tracked player whose row survived dedupe, plus the Roster. */
export interface RosterSession {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    partyMembers: RosterMember[];
}

/** What a list-view row is called, and whose player page its name links to. */
export interface FireteamTitle {
    /** The full display name (`Name#Code` when the server knows both parts), or "Unknown player". */
    name: string;
    /**
     * The full name again, for when a phone truncates it, or the membership ID when the name is
     * "Unknown player": the only identity there is.
     */
    tooltip: string;
    membershipId: string;
    membershipType?: number;
}

/**
 * Whether a display name is really a raw membership ID: all digits, 16 or more. The server
 * falls back to the bare ID when it has no name for a player, and uses this same test to decide
 * when a name from Bungie isn't one. One copy, so the browser can't title a row "Unknown player"
 * for a name the server treats as real, or the other way round.
 */
export function isLikelyMembershipId(str: string): boolean {
    return /^\d{16,}$/.test(str);
}

/** The server's test, plus an empty name or one equal to the member's own ID. */
function isRawMembershipId(displayName: string, membershipId: string): boolean {
    return !displayName || displayName === membershipId || isLikelyMembershipId(displayName);
}

/**
 * The one member a row is titled after: the Fireteam Leader, or the session's tracked player
 * when nobody in the Roster is flagged (the crawler's filled-in solo row is the case seen in
 * practice).
 */
function titleSubject(session: RosterSession): Omit<RosterMember, 'status'> {
    return findFireteamLeader(session.partyMembers) ?? session;
}

/** A row's title, named after {@link titleSubject}. */
export function fireteamTitle(session: RosterSession): FireteamTitle {
    const subject = titleSubject(session);
    const unknown = isRawMembershipId(subject.displayName, subject.membershipId);

    return {
        name: unknown ? 'Unknown player' : subject.displayName,
        tooltip: unknown ? subject.membershipId : subject.displayName,
        membershipId: subject.membershipId,
        membershipType: subject.membershipType,
    };
}

/**
 * Everyone the expanded row lists: the whole Roster except the one member the row is titled
 * after (the leader, else the tracked player, "Unknown player" included), each listed once, in
 * Roster order. Excluded by membership ID, never by the name shown.
 */
export function otherRosterMembers(session: RosterSession): RosterMember[] {
    const listed = new Set([titleSubject(session).membershipId]);
    return session.partyMembers.filter((member) => {
        if (listed.has(member.membershipId)) return false;
        listed.add(member.membershipId);
        return true;
    });
}

// Member-set rules behind isSameSession, which the server's dedupe (dedupe.ts) also calls to
// collapse one row per tracked player into one per fireteam.

/** Membership IDs as a set: blanks dropped, duplicates removed, sorted. */
export function uniqueSortedMemberIds(ids: string[]): string[] {
    return Array.from(new Set(ids.map((id) => String(id || '')).filter((id) => id.length > 0))).sort();
}

/** Whether two lists from {@link uniqueSortedMemberIds} hold the same members. */
function haveSameMembers(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/** Whether every member of `subset` is also in `superset`. */
function isSubset(subset: string[], superset: string[]): boolean {
    if (subset.length > superset.length) return false;
    const supersetSet = new Set(superset);
    return subset.every((id) => supersetSet.has(id));
}

/** What identifies a fireteam from one poll to the next: its raid and its Roster's member set. */
export interface SessionIdentity {
    activityHash: number;
    /** From {@link uniqueSortedMemberIds}. */
    memberIds: string[];
}

/**
 * A session's identity. Not the tracked player (dedupe keeps the newest row, so it changes
 * between polls) and not the leader (who can change too).
 */
export function sessionIdentity(session: { activityHash: number; partyMembers: { membershipId: string }[] }): SessionIdentity {
    return {
        activityHash: session.activityHash,
        memberIds: uniqueSortedMemberIds(session.partyMembers.map((member) => member.membershipId)),
    };
}

/**
 * Whether two polls describe the same fireteam: the same raid, and the same members or one
 * member set containing the other (the Roster grew or shrank). Dedupe calls this too, to decide
 * two rows are one fireteam, so the page and the server can't disagree on it.
 *
 * Because dedupe uses it, changing it moves the fireteam display cap (ADR 0001) and the
 * headline count (ADR 0002). A change made for open rows belongs in {@link followOpenSessions},
 * never here.
 */
export function isSameSession(a: SessionIdentity, b: SessionIdentity): boolean {
    return a.activityHash === b.activityHash && (
        haveSameMembers(a.memberIds, b.memberIds)
        || isSubset(a.memberIds, b.memberIds)
        || isSubset(b.memberIds, a.memberIds)
    );
}

/**
 * The open fireteams after a poll: each poll's session that matches one open before it. The
 * match is with the latest poll's Roster, not the one the row was opened on, so a Roster that
 * gains a member and later loses another stays open. Fireteams no longer on the page drop out.
 */
export function followOpenSessions(open: SessionIdentity[], current: SessionIdentity[]): SessionIdentity[] {
    return current.filter((session) => isOpenSession(open, session));
}

/** Whether a session is one of the open fireteams. */
export function isOpenSession(open: SessionIdentity[], session: SessionIdentity): boolean {
    return open.some((opened) => isSameSession(opened, session));
}

/** The open fireteams after a click on one row: opened if it was closed, closed if it was open. */
export function toggleOpenSession(open: SessionIdentity[], session: SessionIdentity): SessionIdentity[] {
    return isOpenSession(open, session)
        ? open.filter((opened) => !isSameSession(opened, session))
        : [...open, session];
}
