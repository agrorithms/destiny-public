import { upsertActiveSession } from '../../src/lib/db/queries';
import { hoursAgo, seedPlayer, seedRun } from '../../tests/helpers/seed';
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
}

export interface SeedPlayerSessionOptions {
    membershipId: string;
    name: string;
    code: number;
    raid?: typeof RAID_A | typeof RAID_B;
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
    raid?: typeof RAID_A | typeof RAID_B;
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
    const { count, size = 6, prefix, raid = RAID_A } = options;
    const startedAtIso: string[] = [];

    for (let fireteam = 0; fireteam < count; fireteam++) {
        const roster = Array.from({ length: size }, (_, seat) => ({
            membershipId: `${prefix}${String(fireteam).padStart(2, '0')}${String(seat).padStart(2, '0')}`,
            membershipType: 3,
            // The prefix is in the display name too, not just the membership id,
            // so two specs seeding fireteams never produce two players with the
            // same rendered Name#Code and an ambiguous locator.
            displayName: `Roster${prefix}F${fireteam}S${seat}`,
            status: 1,
        }));

        // Staggered so the display sort (newest first, after multi-member rank)
        // is total rather than arbitrary — the cap must drop a predictable set.
        const startedAt = new Date((hoursAgo(1) + fireteam * 60) * 1000).toISOString();
        startedAtIso.push(startedAt);

        for (const member of roster) {
            seedPlayer(member.membershipId, member.displayName, 1000 + fireteam);

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
