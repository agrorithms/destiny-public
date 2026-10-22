import { deleteActiveSessionForPlayer, upsertActiveSession } from '../../src/lib/db/queries';
import { hoursAgo, seedPlayer, seedRun } from '../../tests/helpers/seed';
import { DP_EPIC, VOG_MASTER, VOG_NORMAL } from '../../tests/helpers/pgcr-builder';
import { fixtureRunId } from './fixture-db';

/**
 * The fixture world every e2e spec asserts against.
 *
 * Runs go in through `seedRun` from tests/helpers — deliberately shared with the
 * Vitest suite rather than reimplemented, because that helper funnels through
 * `insertFullPGCR`, the same chokepoint all four production ingestion sources
 * use. A private e2e seeder would drift, and drift in seeding is how a green
 * suite ends up asserting against rows production could never create. See
 * tests/README.md for the constraint that keeps tests/helpers usable from here.
 *
 * This module reaches `src/lib/db` on import, so it must only ever be loaded
 * *after* ./fixture-db.ts has set RAID_TRACKER_DB_PATH — see the note there.
 */

/** Two raids with non-overlapping rosters, so filtering to one is visibly different. */
export const RAID_A = {
    key: 'salvations_edge',
    hash: 2192826039,
    name: "Salvation's Edge",
} as const;

export const RAID_B = {
    key: 'crotas_end',
    hash: 1566480315,
    name: "Crota's End",
} as const;

/**
 * A raid as the session seeders need it: the stored key, an activity hash, and the heading
 * the page renders. RAID_A and RAID_B keep `as const` rather than this type, because
 * FASTEST_CLEARS is keyed by their literal keys; they still fit it.
 */
export interface FixtureRaid {
    key: string;
    hash: number;
    name: string;
}

/**
 * Two raids no other spec seeds, adjacent in the page's raid list, for the section-order
 * spec. Using raids of their own means the spec's counts cannot be perturbed by the
 * fireteams other specs leave live on RAID_A and RAID_B.
 */
export const ORDER_EARLIER_RAID: FixtureRaid = {
    key: 'vault_of_glass',
    hash: 3881495763,
    name: 'Vault of Glass',
};

export const ORDER_LATER_RAID: FixtureRaid = {
    key: 'deep_stone_crypt',
    hash: 910380154,
    name: 'Deep Stone Crypt',
};

/**
 * A raid key the page's raid list does not know: what the page sees if a raid is added to
 * `RAID_DEFINITIONS` but not to the page. The hash is in no raid definition either, so the
 * API names it after the activity mode (4, "Raid"), which is the heading the page renders.
 */
export const UNLISTED_RAID: FixtureRaid = {
    key: 'e2e_unlisted_raid',
    hash: 1,
    name: 'Raid',
};

/**
 * A second unlisted raid with the same rendered name as UNLISTED_RAID, so two raid keys
 * share one display name: the case that would merge two raids into one section if the page
 * grouped by name.
 */
export const UNLISTED_NAMESAKE_RAID: FixtureRaid = {
    key: 'e2e_unlisted_namesake_raid',
    hash: 2,
    name: 'Raid',
};

/**
 * A raid only the list-view spec seeds, so its row count and row order cannot be perturbed
 * by the fireteams other specs leave live for 900 seconds.
 */
export const LIST_RAID: FixtureRaid = {
    key: 'garden_of_salvation',
    hash: 2659723068,
    name: 'Garden of Salvation',
};

/**
 * A raid only the expandable-rows spec seeds (#158). Its spec seeds a fireteam again partway
 * through to grow its Roster, so nothing else may share the raid.
 */
export const EXPAND_RAID: FixtureRaid = {
    key: 'last_wish',
    hash: 2122313384,
    name: 'Last Wish',
};

/**
 * Two raids only the section-collapse spec seeds (#159). Its assertions cover every section the
 * raid filter leaves visible, so it filters the page down to these two, and no other spec's
 * fireteams can be among them.
 */
export const COLLAPSE_RAID: FixtureRaid = {
    key: 'root_of_nightmares',
    hash: 2381413764,
    name: 'Root of Nightmares',
};

export const COLLAPSE_OTHER_RAID: FixtureRaid = {
    key: 'kings_fall',
    hash: 1374392663,
    name: "King's Fall",
};

/**
 * A third raid only the section-collapse spec seeds: one fireteam it ends and reseeds, so the
 * raid leaves the API's response and comes back. No other spec's fireteams may share it, or
 * ending this spec's fireteam would leave the section on the page.
 */
export const REAPPEAR_RAID: FixtureRaid = {
    key: 'the_desert_perpetual',
    hash: 2586252122,
    name: 'The Desert Perpetual',
};

/**
 * A raid no spec seeds, ever: the section-collapse spec filters the page down to it to get a
 * page with no raid sections at all. Seeding it anywhere breaks that spec.
 */
export const UNSEEDED_RAID: FixtureRaid = {
    key: 'vow_of_the_disciple',
    hash: 2906950631,
    name: 'Vow of the Disciple',
};

/**
 * A raid only the copy-join-code spec seeds (#160). Its rows' buttons are found by fireteam, and
 * its no-button row is checked against the rows around it, so no other spec's fireteams may
 * share it.
 */
export const COPY_RAID: FixtureRaid = {
    key: 'pantheon_calus_resplendent',
    hash: 1516551982,
    name: 'Pantheon: Calus Resplendent',
};

/**
 * A second raid only the copy-join-code spec seeds (#160): its section holds exactly two rows,
 * so the spec knows which is the list's first and which its last. Seeded by its own hash,
 * 747671496. `RAID_DEFINITIONS` has also listed 2530656885 under this raid, a hash that names
 * Pantheon: Morgeth Surpassing (SIZE_RAID); fix/manifest-dupe-2530656885 removes that listing.
 * Seeding by 747671496 keeps the two sections apart either way.
 */
export const COPY_EDGE_RAID: FixtureRaid = {
    key: 'pantheon_insurrection_prime_revolutionary',
    hash: 747671496,
    name: 'Pantheon: Insurrection Prime Revolutionary',
};

/**
 * A raid only the fireteam-size spec seeds (#161), with one fireteam of each size from 1 to 6:
 * its section's rows are counted as chips hide them, so no other spec's fireteams may share it.
 *
 * Seeded by its hash, 2530656885, which the API names Pantheon: Morgeth Surpassing; the section
 * groups by the stored raid_key, this key. RAID_DEFINITIONS has also listed that hash under
 * Insurrection Prime, with Morgeth's later entry winning the name; fix/manifest-dupe-2530656885
 * removes that listing. COPY_EDGE_RAID seeds Insurrection Prime by its own hash, 747671496, so the
 * two sections never meet either way.
 */
export const SIZE_RAID: FixtureRaid = {
    key: 'pantheon_morgeth_surpassing',
    hash: 2530656885,
    name: 'Pantheon: Morgeth Surpassing',
};

interface FixturePlayer {
    membershipId: string;
    name: string;
    code: number;
    /** Completions to seed on RAID_A. */
    raidA?: number;
    /** Completions to seed on RAID_B. */
    raidB?: number;
    /**
     * The Clear Time of each of this player's runs, in seconds, in seeding order. One
     * entry per run, so its length matches the player's count.
     */
    clearTimes: number[];
}

/**
 * Membership ids are namespaced per concern so no two specs can collide on the
 * `active_sessions` primary key or on a rate-limit cooldown keyed by player.
 * Serial execution makes that unnecessary today; the convention exists so
 * raising `workers` later stays a config change. See the plan's D2.
 */
export const LEADERBOARD_PLAYERS: FixturePlayer[] = [
    // Deliberately the top of the board so the Name#Code assertions do not
    // depend on the default page limit.
    { membershipId: '4611686018400010001', name: 'FixtureAlpha', code: 4242, raidA: 3, clearTimes: [2400, 2000, 2700] },
    // A low code, to pin the zero-padding in formatBungieDisplayName. A raw
    // "Name#7" here would be wrong; it must render "Name#0007".
    { membershipId: '4611686018400010002', name: 'FixtureBravo', code: 7, raidA: 2, clearTimes: [2100, 2200] },
    { membershipId: '4611686018400010003', name: 'FixtureCharlie', code: 1111, raidA: 1, clearTimes: [1500] },
    // Non-overlapping with the RAID_A set: filtering must swap the board wholesale.
    { membershipId: '4611686018400010011', name: 'FixtureDelta', code: 2222, raidB: 3, clearTimes: [3000, 3300, 3100] },
    { membershipId: '4611686018400010012', name: 'FixtureEcho', code: 3333, raidB: 2, clearTimes: [1900, 1260] },
    { membershipId: '4611686018400010013', name: 'FixtureFoxtrot', code: 4444, raidB: 1, clearTimes: [2900] },
];

/**
 * The Fastest Clears boards the Clear Times above produce: each player's fastest run,
 * fastest first, as `formatRunDuration` renders it. Ordered against the Full Clears
 * boards on purpose — the player with the fewest clears is the fastest — so a tab
 * that showed the count board under the Fastest Clears heading could not pass.
 *
 * Alpha's and Echo's fastest is not their first run, so a board that took a
 * player's first or last run rather than their fastest could not pass either.
 */
export const FASTEST_CLEARS = {
    [RAID_A.key]: [
        ['FixtureCharlie#1111', '25:00'],
        ['FixtureAlpha#4242', '33:20'],
        ['FixtureBravo#0007', '35:00'],
    ],
    [RAID_B.key]: [
        ['FixtureEcho#3333', '21:00'],
        ['FixtureFoxtrot#4444', '48:20'],
        ['FixtureDelta#2222', '50:00'],
    ],
} as const;

/**
 * The Difficulty world (#41): one run per player, each on a version of Vault of Glass or The
 * Desert Perpetual, so selecting a Difficulty visibly swaps who is on those raids' cards.
 * Difficulty comes from the activity hash. GOLF's Normal run has Feats on (`difficulty_tier` 2),
 * the shape that used to count as Master, so the Normal and Master assertions both cover it.
 *
 * Vault of Glass and The Desert Perpetual have no other PGCRs in this world (the active-session
 * specs that use them write `active_sessions`, a different table). One clear each keeps these
 * players under FixtureAlpha's three on the Total Clears board.
 */
export const DIFFICULTY_VOG = { key: 'vault_of_glass', name: 'Vault of Glass' } as const;
export const DIFFICULTY_DP = { key: 'the_desert_perpetual', name: 'The Desert Perpetual' } as const;

export const DIFFICULTY_PLAYERS = {
    /** Vault of Glass: Standard, with Feats on. Normal. */
    normal: { membershipId: '4611686018400010021', name: 'FixtureGolf', code: 5555, hash: VOG_NORMAL, difficultyTier: 2 },
    /** Vault of Glass: Master. */
    master: { membershipId: '4611686018400010022', name: 'FixtureHotel', code: 6666, hash: VOG_MASTER, difficultyTier: 0 },
    /** The Desert Perpetual (Epic): Standard. */
    epic: { membershipId: '4611686018400010023', name: 'FixtureIndia', code: 7777, hash: DP_EPIC, difficultyTier: 0 },
} as const;

export function difficultyPlayerName(player: keyof typeof DIFFICULTY_PLAYERS): string {
    const { name, code } = DIFFICULTY_PLAYERS[player];
    return `${name}#${code}`;
}

/**
 * Proves the *running server* opened this run's fixture database — not just
 * that this process did, and not a database left behind by an earlier run.
 * Searched for through /api/players/search, which reads local SQLite only and is
 * `no-store`, so a hit cannot come from a cache.
 *
 * The name carries the per-run nonce precisely so a stale server fails loudly.
 */
export const CANARY_MEMBERSHIP_ID = '4611686018409990001';
export const CANARY_CODE = 9999;

export function canaryName(): string {
    return `E2eCanary${fixtureRunId()}`;
}

export function canaryDisplayName(): string {
    return `${canaryName()}#${CANARY_CODE}`;
}

/**
 * Seeded once, before the server boots. Everything here is time-relative
 * (`hoursAgo`) because every leaderboard query filters on a cutoff derived from
 * Date.now() — a fixed timestamp would age out of the window.
 */
export function seedStaticWorld(): void {
    seedPlayer(CANARY_MEMBERSHIP_ID, canaryName(), CANARY_CODE);

    let instance = 1;
    for (const player of LEADERBOARD_PLAYERS) {
        seedPlayer(player.membershipId, player.name, player.code);
        let run = 0;

        for (const [raid, count] of [
            [RAID_A, player.raidA ?? 0],
            [RAID_B, player.raidB ?? 0],
        ] as const) {
            for (let i = 0; i < count; i++) {
                seedRun({
                    instanceId: `9000${instance++}`,
                    activityHash: raid.hash,
                    raidKey: raid.key,
                    completedBy: [player.membershipId],
                    // Well inside the narrowest time window the UI offers, so no
                    // spec has to care which range the slider defaults to. Every Clear
                    // Time is under an hour, so each run has ended by now.
                    period: hoursAgo(1),
                    activityDurationSeconds: player.clearTimes[run++],
                });
            }
        }
    }

    for (const player of Object.values(DIFFICULTY_PLAYERS)) {
        seedPlayer(player.membershipId, player.name, player.code);
        seedRun({
            instanceId: `9000${instance++}`,
            activityHash: player.hash,
            completedBy: [player.membershipId],
            difficultyTier: player.difficultyTier,
            period: hoursAgo(1),
            activityDurationSeconds: 1800,
        });
    }
}

export interface SeedPlayerSessionOptions {
    membershipId: string;
    name: string;
    code: number;
    raid?: FixtureRaid;
    /**
     * Extra roster members, beyond the player themselves. Deliberately takes raw
     * membership ids and nothing else: this mirrors what Bungie's transitory
     * component actually sends for a teammate we have never seen, which is the
     * state the resolve flow exists to repair. Members named here are NOT seeded
     * into `players` — a spec that wants them known must seed them itself.
     */
    extraMembers?: string[];
}

/**
 * Seeds a single player with an active session. Like seedFireteams but for one
 * specific player — used when a spec needs a known membership ID rather than a
 * generated one.
 */
export function seedPlayerWithSession(options: SeedPlayerSessionOptions): void {
    const { membershipId, name, code, raid = RAID_A, extraMembers = [] } = options;
    seedPlayer(membershipId, name, code);

    const partyMembers = [
        { membershipId, displayName: name, status: 1 },
        // displayName === membershipId is what Bungie sends when it has no name
        // for a party member, and is what makes enrichPartyMembersFromJson fall
        // through to the raw id rather than to an "api name".
        ...extraMembers.map((id) => ({ membershipId: id, displayName: id, status: 1 })),
    ];

    upsertActiveSession({
        membershipId,
        membershipType: 3,
        displayName: name,
        activityHash: raid.hash,
        activityModeType: 4,
        raidKey: raid.key,
        startedAt: new Date(hoursAgo(0.5) * 1000).toISOString(),
        partyMembersJson: JSON.stringify(partyMembers),
        playerCount: partyMembers.length,
    });
}

export interface SeedFireteamsOptions {
    /** How many distinct fireteams to create. */
    count: number;
    /** Members per fireteam. Six is a full raid roster. */
    size?: number;
    /** Namespace for membership ids and display names, so specs cannot collide. */
    prefix: string;
    raid?: FixtureRaid;
    /**
     * The seat, from 0, whose member is the Fireteam Leader: seeded with status 9
     * (FireteamMember 1 + PartyLeader 8), as Bungie sends it. Leave it out and every member
     * is status 1, so the fireteam has no leader and its row is titled after the tracked
     * player instead.
     */
    leaderSeat?: number;
    /**
     * Seats whose player is known by name but not by code: their `players` row has no
     * `bungie_global_display_name_code`, so the API sends the bare name rather than
     * `Name#Code` (see `formatBungieDisplayName`, which `/api/active-sessions` calls). Their
     * rendered name is {@link fireteamMemberName} without the `#code`.
     */
    nameOnlySeats?: number[];
    /**
     * Seats whose player the Tracker has never seen: no `players` row and no session row of
     * their own, and the Roster names them by membership id, as Bungie does for a teammate it
     * has no name for. The API then sends the raw membership id as their name.
     */
    unseenSeats?: number[];
}

/** The membership id of one seeded roster member. */
function fireteamMemberId(prefix: string, fireteam: number, seat: number): string {
    return `${prefix}${String(fireteam).padStart(2, '0')}${String(seat).padStart(2, '0')}`;
}

/** The rendered `Name#Code` of one seeded roster member. */
export function fireteamMemberName(prefix: string, fireteam: number, seat: number): string {
    return `Roster${prefix}F${fireteam}S${seat}#${1000 + fireteam}`;
}

/**
 * Seeded per spec file rather than once globally: `getActiveSessions` only
 * returns rows checked within the last 900 seconds, and `upsertActiveSession`
 * always stamps `checked_at` with `unixepoch()`. A world seeded once in
 * globalSetup would go invisible fifteen minutes into a run.
 *
 * Each fireteam gets a disjoint roster. The deduper suppresses subset and
 * superset variants of the same activity, so overlapping rosters would collapse
 * into fewer fireteams than intended and the cap assertion would be measuring
 * the wrong thing.
 */
export function seedFireteams(options: SeedFireteamsOptions): string[] {
    const { count, size = 6, prefix, raid = RAID_A, leaderSeat, nameOnlySeats = [], unseenSeats = [] } = options;
    const startedAtIso: string[] = [];

    for (let fireteam = 0; fireteam < count; fireteam++) {
        const roster = Array.from({ length: size }, (_, seat) => {
            const membershipId = fireteamMemberId(prefix, fireteam, seat);
            return {
                membershipId,
                membershipType: 3,
                // The prefix is in the display name too, not just the membership id,
                // so two specs seeding fireteams never produce two players with the
                // same rendered Name#Code and an ambiguous locator.
                displayName: unseenSeats.includes(seat) ? membershipId : `Roster${prefix}F${fireteam}S${seat}`,
                status: seat === leaderSeat ? 9 : 1,
            };
        });

        // Staggered so the display sort (newest first, after multi-member rank)
        // is total rather than arbitrary — the cap must drop a predictable set.
        const startedAt = new Date((hoursAgo(1) + fireteam * 60) * 1000).toISOString();
        startedAtIso.push(startedAt);

        for (const [seat, member] of roster.entries()) {
            if (unseenSeats.includes(seat)) continue;
            seedPlayer(member.membershipId, member.displayName, nameOnlySeats.includes(seat) ? undefined : 1000 + fireteam);

            upsertActiveSession({
                membershipId: member.membershipId,
                membershipType: 3,
                displayName: member.displayName,
                activityHash: raid.hash,
                activityModeType: 4,
                raidKey: raid.key,
                startedAt,
                partyMembersJson: JSON.stringify(roster),
                playerCount: size,
            });
        }
    }

    return startedAtIso;
}

export interface EndFireteamsOptions {
    /** How many of the prefix's fireteams to end, from fireteam 0. */
    count: number;
    /** Members per fireteam, as seeded. */
    size?: number;
    /** The namespace the fireteams were seeded under. Only its rows are touched. */
    prefix: string;
}

/**
 * Ends fireteams {@link seedFireteams} started: every member's `active_sessions` row goes,
 * so the API stops returning the fireteam, as it does once the crawler finds its players
 * have left. Deletes through `deleteActiveSessionForPlayer`, the query the crawler uses, one
 * membership id at a time, so nothing outside the prefix's own rows can be touched. The
 * players themselves stay; reseeding with the same options brings the fireteam back.
 */
export function endFireteams(options: EndFireteamsOptions): void {
    const { count, size = 6, prefix } = options;
    for (let fireteam = 0; fireteam < count; fireteam++) {
        for (let seat = 0; seat < size; seat++) {
            deleteActiveSessionForPlayer(fireteamMemberId(prefix, fireteam, seat));
        }
    }
}
