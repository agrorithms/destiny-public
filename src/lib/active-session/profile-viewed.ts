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
 * The request a profile view sends, or null when it sends none. It is sent when the browser's own
 * check found a raid (naming the player the raid was read from), or when the stored baseline had
 * a session for the viewed player, so the crawler re-checks that Fireteam. A player with neither
 * a stored session nor a raid sends nothing.
 */
export function profileViewedBody(
    viewed: PlayerRef,
    storedSession: boolean,
    raid: RaidSource,
): ProfileViewedBody | null {
    const body: ProfileViewedBody = { membershipId: viewed.membershipId, membershipType: viewed.membershipType };
    if (raid?.from === 'teammate') {
        body.teammate = { membershipId: raid.teammate.membershipId, membershipType: raid.teammate.membershipType };
        return body;
    }
    return raid || storedSession ? body : null;
}
