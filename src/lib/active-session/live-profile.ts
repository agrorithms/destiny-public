// What a profile page draws from the viewer's own Bungie response (#9001, ADR 0010).
//
// A browser never writes session or identity data to the Tracker. The profile page fetches the
// player's profile with the public key and renders the live Fireteam from it, for that viewer
// only; names come from the Tracker's read-only lookup or from the browser's own Bungie calls,
// and stay on that screen. These are the rules for all of that, kept out of the component so
// they can be tested and mutated.
//
// Pure and browser-safe on purpose: no database, no `fs`, no server Bungie client. The crawler
// reads a profile through `readProfileActivity` too, so the page and the Tracker agree on what
// counts as being in an activity. See CONTEXT.md for Active Session, Roster and Fireteam.
import { formatBungieDisplayName } from '../bungie/display-name';
import { getRaidKeyFromHash } from '../bungie/manifest';
import type { CharacterActivitiesComponent, DestinyProfileResponse, PlayerInfo, TransitoryPartyMember } from '../bungie/types';
import { getActivityDisplayName } from '../utils/activity';
import { isLikelyMembershipId } from './roster';

/** What a profile says its owner is doing right now, as Bungie reported it. */
export interface ProfileActivity {
    activityHash: number;
    activityModeHash: number | null;
    activityModeType: number | null;
    /** Null when Bungie gave no start time; the caller stamps its own clock. */
    startedAt: string | null;
    /** The Roster as Bungie sent it; empty when Bungie listed nobody. */
    partyMembers: TransitoryPartyMember[];
}

/** The page heading's player. */
export interface ProfilePlayer {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
}

/** A Roster member on the card. With a membership type it links to that player's profile. */
export interface SessionMember {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    status: number;
}

/** The card's session, the same shape the player read route returns for a stored one. */
export interface ProfileSession {
    membershipId: string;
    membershipType: number;
    displayName: string;
    activityHash: number;
    raidKey: string;
    raidName: string;
    startedAt: string;
    playerCount: number;
    partyMembers: SessionMember[];
}

/** The player whose profile is being viewed, as the card names them. */
export interface SessionSubject {
    membershipId: string;
    membershipType: number;
    displayName: string;
}

/** A player the page could name: from the Tracker's lookup, or from the browser's own Bungie call. */
export interface NamedPlayer {
    membershipId: string;
    membershipType: number;
    displayName: string;
}

export const PRIVATE_ACTIVITY_NAME = 'Activity in progress (details private)';
/** The most ids the Tracker's known-names lookup answers in one request. */
export const MAX_NAME_LOOKUP_IDS = 12;
/** How many public teammates a private player's page probes before giving up. */
export const MAX_TEAMMATE_PROBES = 3;

/**
 * The activity a profile (components 204 + 1000) shows, or null when it shows none.
 *
 * Component 1000 (transitory) is the authoritative online signal: without it the player is
 * offline. Component 204's most recently started character supplies the activity, with the
 * transitory activity as the fallback when the characters are withheld.
 */
export function readProfileActivity(profile: DestinyProfileResponse): ProfileActivity | null {
    const transitory = profile.profileTransitoryData?.data;
    if (!transitory) return null;

    const characters: CharacterActivitiesComponent[] = Object.values(profile.characterActivities?.data || {});
    // An unreadable start time sorts last rather than poisoning the order with NaN.
    characters.sort((a, b) => (Date.parse(b.dateActivityStarted) || 0) - (Date.parse(a.dateActivityStarted) || 0));
    const mostRecent = characters[0];
    const current = transitory.currentActivity;

    const activityHash = Number(mostRecent?.currentActivityHash || current?.currentActivityHash || 0);
    // Some valid transitory states (for example in orbit) report an activity hash while
    // omitting the mode type, so only a missing hash means "no activity".
    if (!activityHash) return null;

    return {
        activityHash,
        activityModeHash: Number(mostRecent?.currentActivityModeHash || current?.currentActivityModeHash || 0) || null,
        activityModeType: Number(mostRecent?.currentActivityModeType || current?.currentActivityModeType || 0) || null,
        startedAt: mostRecent?.dateActivityStarted || current?.startTime || null,
        partyMembers: transitory.partyMembers || [],
    };
}

/**
 * Whether the profile hides what its owner is doing: the account is marked private, or the
 * character activities component was withheld (`{ privacy: 2 }`, no data). A withheld activity
 * is not the same as no activity, so the page looks further before saying "not raiding".
 */
export function isActivityWithheld(profile: DestinyProfileResponse): boolean {
    if (profile.profile?.data?.userInfo?.isPublic === false) return true;
    const characters = profile.characterActivities;
    return Boolean(characters && !characters.data);
}

/** The profile's owner, named `Name#Code` when Bungie gives both halves. */
export function profileOwner(profile: DestinyProfileResponse): ProfilePlayer | null {
    const userInfo = profile.profile?.data?.userInfo;
    if (!userInfo?.membershipId) return null;

    return {
        membershipId: userInfo.membershipId,
        membershipType: userInfo.membershipType,
        displayName: formatBungieDisplayName(userInfo),
        baseName: userInfo.bungieGlobalDisplayName || userInfo.displayName || userInfo.membershipId,
    };
}

/**
 * The heading keeps the name the Tracker has. Only a player it knows by bare id is named from
 * the viewer's Bungie response, so a crawled name is never replaced by a browser's.
 */
export function pickHeaderPlayer(stored: ProfilePlayer | null, owner: ProfilePlayer | null): ProfilePlayer | null {
    if (stored && stored.displayName !== stored.membershipId) return stored;
    return owner ?? stored;
}

/** Bungie's name for a member, unless it is really a bare membership id. */
function rosterName(member: Pick<TransitoryPartyMember, 'membershipId' | 'displayName'>): string {
    const name = member.displayName;
    return name && !isLikelyMembershipId(name) ? name : member.membershipId;
}

/** The Roster as the card shows it: the viewed player named and linkable, the rest as Bungie named them. */
function cardMembers(subject: SessionSubject, partyMembers: TransitoryPartyMember[]): SessionMember[] {
    // A Roster of one when Bungie listed nobody, as the crawler stores it.
    const members = partyMembers.length > 0
        ? partyMembers
        : [{ membershipId: subject.membershipId, displayName: subject.displayName, status: 1, emblemHash: 0 }];

    return members.map((member) => member.membershipId === subject.membershipId
        ? { membershipId: subject.membershipId, membershipType: subject.membershipType, displayName: subject.displayName, status: member.status }
        : { membershipId: member.membershipId, displayName: rosterName(member), status: member.status });
}

/** The card for an activity the viewer's response shows. */
export function liveSession(subject: SessionSubject, activity: ProfileActivity, now: Date): ProfileSession {
    const partyMembers = cardMembers(subject, activity.partyMembers);

    return {
        ...subject,
        activityHash: activity.activityHash,
        raidKey: getRaidKeyFromHash(activity.activityHash) ?? 'unknown',
        raidName: getActivityDisplayName(activity.activityHash, activity.activityModeType, activity.activityModeHash),
        startedAt: activity.startedAt ?? now.toISOString(),
        playerCount: partyMembers.length,
        partyMembers,
    };
}

/**
 * A private player's Fireteam before its raid is known: transitory data says they are in an
 * activity with this Roster, and withholds which one. Null when it says nothing.
 */
export function provisionalSession(subject: SessionSubject, profile: DestinyProfileResponse): ProfileSession | null {
    const transitory = profile.profileTransitoryData?.data;
    if (!transitory?.currentActivity?.startTime) return null;
    const current = transitory.currentActivity;

    const partyMembers = cardMembers(subject, transitory.partyMembers || []);
    return {
        ...subject,
        activityHash: 0,
        raidKey: 'unknown',
        raidName: PRIVATE_ACTIVITY_NAME,
        startedAt: current.startTime,
        playerCount: current.numberOfPlayers || partyMembers.length,
        partyMembers,
    };
}

/** The members the card cannot link yet, once each, at most `limit`. */
export function unnamedMemberIds(session: ProfileSession, limit: number): string[] {
    const ids = session.partyMembers
        .filter((member) => typeof member.membershipType !== 'number')
        .map((member) => member.membershipId);
    return [...new Set(ids)].slice(0, limit);
}

/**
 * The card with each member in `named` given that name and membership type. A known name that
 * is only a bare id does not replace a better one already on the card.
 */
export function withNames(session: ProfileSession, named: NamedPlayer[]): ProfileSession {
    const byId = new Map(named.map((player) => [player.membershipId, player]));

    return {
        ...session,
        partyMembers: session.partyMembers.map((member) => {
            const player = byId.get(member.membershipId);
            if (!player) return member;
            return {
                ...member,
                membershipType: player.membershipType,
                displayName: isLikelyMembershipId(player.displayName) ? member.displayName : player.displayName,
            };
        }),
    };
}

/** A member the browser looked up at Bungie, named `Name#Code`. */
export function linkedPlayerName(player: PlayerInfo): NamedPlayer {
    return {
        membershipId: player.membershipId,
        membershipType: player.membershipType,
        displayName: formatBungieDisplayName(player),
    };
}

/** The teammates a private player's page may probe: ones the card can link, never the player. */
export function teammatesToProbe(session: ProfileSession, viewedId: string): Array<{ membershipId: string; membershipType: number }> {
    return session.partyMembers
        .filter((member) => member.membershipId !== viewedId && typeof member.membershipType === 'number')
        .slice(0, MAX_TEAMMATE_PROBES)
        .map((member) => ({ membershipId: member.membershipId, membershipType: member.membershipType as number }));
}

/** Whether a teammate's activity has the viewed player in its Roster. */
export function includesPlayer(activity: ProfileActivity, membershipId: string): boolean {
    return activity.partyMembers.some((member) => member.membershipId === membershipId);
}
