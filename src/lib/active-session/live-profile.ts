import type { DestinyProfileResponse, PlayerInfo, TransitoryPartyMember } from '../bungie/types';

export interface ProfileActivity {
    activityHash: number;
    activityModeHash: number | null;
    activityModeType: number | null;
    startedAt: string | null;
    partyMembers: TransitoryPartyMember[];
}

export interface ProfilePlayer {
    membershipId: string;
    membershipType: number;
    displayName: string;
    baseName: string;
}

export interface SessionMember {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    status: number;
}

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

export interface SessionSubject {
    membershipId: string;
    membershipType: number;
    displayName: string;
}

export interface NamedPlayer {
    membershipId: string;
    membershipType: number;
    displayName: string;
}

export const PRIVATE_ACTIVITY_NAME = 'Activity in progress (details private)';
export const MAX_NAME_LOOKUP_IDS = 12;
export const MAX_TEAMMATE_PROBES = 3;

export function readProfileActivity(_profile: DestinyProfileResponse): ProfileActivity | null {
    throw new Error('not implemented');
}

export function isActivityWithheld(_profile: DestinyProfileResponse): boolean {
    throw new Error('not implemented');
}

export function profileOwner(_profile: DestinyProfileResponse): ProfilePlayer | null {
    throw new Error('not implemented');
}

export function pickHeaderPlayer(_stored: ProfilePlayer | null, _owner: ProfilePlayer | null): ProfilePlayer | null {
    throw new Error('not implemented');
}

export function liveSession(_subject: SessionSubject, _activity: ProfileActivity, _now: Date): ProfileSession {
    throw new Error('not implemented');
}

export function provisionalSession(_subject: SessionSubject, _profile: DestinyProfileResponse): ProfileSession | null {
    throw new Error('not implemented');
}

export function unnamedMemberIds(_session: ProfileSession, _limit: number): string[] {
    throw new Error('not implemented');
}

export function withNames(_session: ProfileSession, _named: NamedPlayer[]): ProfileSession {
    throw new Error('not implemented');
}

export function linkedPlayerName(_player: PlayerInfo): NamedPlayer {
    throw new Error('not implemented');
}

export function teammatesToProbe(_session: ProfileSession, _viewedId: string): Array<{ membershipId: string; membershipType: number }> {
    throw new Error('not implemented');
}

export function includesPlayer(_activity: ProfileActivity, _membershipId: string): boolean {
    throw new Error('not implemented');
}
