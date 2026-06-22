// Shared formatting for active-session API responses. Builds the enriched session shape
// (raid name from manifest, party-member display names resolved from the players table)
// that both the player profile route and the active-session-update endpoint return.
import { getDb } from '../db';
import { formatBungieDisplayName, type ActiveSessionDbRow, type PlayerIdentity } from '../db/queries';
import { getActivityDisplayName } from '../utils/activity';

interface PartyMemberInput {
    membershipId?: string;
    membershipType?: number;
    displayName?: string;
    status?: number;
}

interface PartyMemberOutput extends Record<string, unknown> {
    membershipId: string;
    membershipType?: number;
    displayName: string;
    status?: number;
}

interface PlayerLookupRow {
    membership_id: string;
    membership_type: number;
    bungie_global_display_name: string | null;
    bungie_global_display_name_code: number | null;
    display_name: string | null;
}

function isLikelyMembershipId(str: string): boolean {
    return /^\d{16,}$/.test(str);
}

export function enrichPartyMembersFromJson(partyMembersJson?: string, enrich: boolean = true): PartyMemberOutput[] {
    let partyMembers: PartyMemberInput[] = [];
    if (partyMembersJson) {
        try {
            const parsed: unknown = JSON.parse(partyMembersJson);
            if (Array.isArray(parsed)) {
                partyMembers = parsed
                    .filter((value) => !!value && typeof value === 'object')
                    .map((value) => value as PartyMemberInput);
            }
        } catch {
            partyMembers = [];
        }
    }

    if (partyMembers.length === 0) {
        return [];
    }

    if (!enrich) {
        return partyMembers.map((member) => {
            const id = String(member?.membershipId || '');
            const fallbackApiName = member?.displayName && !isLikelyMembershipId(member.displayName)
                ? member.displayName
                : null;
            const baseMember = member as Record<string, unknown>;

            return {
                ...baseMember,
                membershipId: id,
                displayName: fallbackApiName || id,
            };
        });
    }

    const db = getDb();
    const ids = [...new Set(
        partyMembers
            .map((m) => String(m?.membershipId || ''))
            .filter(Boolean)
    )];

    const nameMap = new Map<string, string>();
    const typeMap = new Map<string, number>();

    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT
              membership_id,
              membership_type,
              bungie_global_display_name,
              bungie_global_display_name_code,
              display_name
            FROM players
            WHERE membership_id IN (${placeholders})
          `).all(...ids) as PlayerLookupRow[];

        for (const row of rows) {
            typeMap.set(row.membership_id, row.membership_type);
            if (row.bungie_global_display_name && row.bungie_global_display_name_code !== null) {
                nameMap.set(
                    row.membership_id,
                    `${row.bungie_global_display_name}#${String(row.bungie_global_display_name_code).padStart(4, '0')}`
                );
            } else if (row.bungie_global_display_name) {
                nameMap.set(row.membership_id, row.bungie_global_display_name);
            } else if (row.display_name) {
                nameMap.set(row.membership_id, row.display_name);
            }
        }
    }

    return partyMembers.map((member) => {
        const id = String(member?.membershipId || '');
        const knownName = nameMap.get(id);
        const fallbackApiName = member?.displayName && !isLikelyMembershipId(member.displayName)
            ? member.displayName
            : null;
        const baseMember = member as Record<string, unknown>;

        return {
            ...baseMember,
            membershipId: id,
            membershipType: member?.membershipType ?? typeMap.get(id),
            displayName: knownName || fallbackApiName || id,
        };
    });
}

export function buildActiveSessionPayload(
    activeSession: ActiveSessionDbRow | null,
    identity: Pick<PlayerIdentity, 'membershipId' | 'membershipType' | 'displayName' | 'bungieGlobalDisplayName' | 'bungieGlobalDisplayNameCode'>,
    options?: { enrichPartyMembers?: boolean }
) {
    if (!activeSession) return null;
    const partyMembers = enrichPartyMembersFromJson(
        activeSession.partyMembersJson,
        options?.enrichPartyMembers ?? true
    );

    return {
        membershipId: activeSession.membershipId,
        membershipType: activeSession.membershipType,
        displayName: formatBungieDisplayName(identity),
        activityHash: activeSession.activityHash,
        activityModeHash: activeSession.activityModeHash,
        activityModeType: activeSession.activityModeType,
        raidKey: activeSession.raidKey,
        raidName: getActivityDisplayName(
            activeSession.activityHash,
            activeSession.activityModeType,
            activeSession.activityModeHash
        ),
        startedAt: activeSession.startedAt,
        playerCount: activeSession.playerCount,
        partyMembers,
        checkedAt: activeSession.checkedAt,
    };
}
