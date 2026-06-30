// Shared parsing for GetLinkedProfiles responses. Picks the destiny profile that best
// represents the queried membershipId and maps it to a PlayerInfo for upsert into `players`.
// Used by both the server (crawler) and client (browser) resolution paths.
import type { DestinyLinkedProfilesResponse, PlayerInfo } from './types';

/**
 * Choose the profile that identifies the queried membershipId, preferring (in order):
 * an exact membershipId match, the cross-save primary, then the first profile.
 * Returns a PlayerInfo with a usable display name, or null if nothing resolvable.
 */
export function pickPrimaryLinkedProfile(
    response: DestinyLinkedProfilesResponse | null | undefined,
    membershipId: string
): PlayerInfo | null {
    const profiles = response?.profiles ?? [];
    if (profiles.length === 0) return null;

    const exact = profiles.find((p) => p.membershipId === membershipId);
    const primary = profiles.find((p) => p.isCrossSavePrimary);
    const profile = exact || primary || profiles[0];

    if (!profile?.membershipId || typeof profile.membershipType !== 'number') return null;

    const baseName =
        profile.bungieGlobalDisplayName
        || response?.bnetMembership?.bungieGlobalDisplayName
        || profile.displayName
        || profile.membershipId;

    return {
        membershipId: profile.membershipId,
        membershipType: profile.membershipType,
        displayName: baseName,
        bungieGlobalDisplayName:
            profile.bungieGlobalDisplayName
            || response?.bnetMembership?.bungieGlobalDisplayName,
        bungieGlobalDisplayNameCode:
            profile.bungieGlobalDisplayNameCode
            ?? response?.bnetMembership?.bungieGlobalDisplayNameCode,
    };
}
