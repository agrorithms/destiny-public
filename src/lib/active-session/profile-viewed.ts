/**
 * What the profile page tells the server when it has seen a raid: the ids of whom the crawler
 * should poll, and nothing else (ADR 0010). No profile, no name, no statement of what the
 * browser saw. The server decides from its own state.
 */

export interface PlayerRef {
    membershipId: string;
    membershipType: number;
}

export interface ProfileViewedBody extends PlayerRef {
    /** The one teammate the raid was read from, for a private player found through a teammate. */
    teammate?: PlayerRef;
    /** False when the page has nothing to ask the poll about. Omitted means true. */
    poll?: false;
    /** False when the viewed player's history crawl is guaranteed to fail. Omitted means true. */
    history?: false;
}

/** Where the browser's own Bungie check found a raid for the viewed player. */
export type RaidSource =
    /** Read from the viewed player's own profile. */
    | { from: 'self' }
    /** Read from this public teammate's profile, because the viewed player's is private. */
    | { from: 'teammate'; teammate: PlayerRef }
    /** No raid found. */
    | null;

/**
 * The one request a profile view sends, or null when it asks for nothing. It asks for a poll
 * when the browser's own check found a raid (naming the player the raid was read from) or the
 * stored baseline had a session for the viewed player; and for the viewed player's history crawl
 * unless the account is private account-wide, where the crawl is guaranteed to fail. The flags
 * are left out when true.
 */
export function profileViewedBody(
    viewed: PlayerRef,
    storedSession: boolean,
    raid: RaidSource,
    accountPrivate: boolean,
): ProfileViewedBody | null {
    const poll = Boolean(raid) || storedSession;
    const history = !accountPrivate;
    if (!poll && !history) return null;
    const body: ProfileViewedBody = { membershipId: viewed.membershipId, membershipType: viewed.membershipType };
    if (raid?.from === 'teammate') {
        body.teammate = { membershipId: raid.teammate.membershipId, membershipType: raid.teammate.membershipType };
    }
    if (!poll) body.poll = false;
    if (!history) body.history = false;
    return body;
}
