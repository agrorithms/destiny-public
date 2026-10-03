/**
 * Leaderboard-specific caching layer in front of the (unchanged) slow query.
 *
 * Owns: env-driven TTL bands, canonical key normalization, the extracted SQL
 * runner, the limit-collapse (cache top-100, slice after), and response
 * envelope construction. Both the route and the warmer go through here so they
 * share one query path and one single-flight cache (see swr-cache.ts).
 *
 * The ranking aggregation reads the denormalized `pgcrs.ended_at` (Phase 3); for
 * a single raid the aggregate (`IN (?)`) and per-raid (`= ?`) forms are
 * equivalent, so one runner covers all shapes. `fullClearsOnly` is forced true
 * on the cache path (the only real UI path) so it drops out of the key space.
 *
 * `runLeaderboardRows` is the pure, uncached query (the SWR cache only wraps it
 * inside `getLeaderboardResponse`); it is exported so scripts/db-stats.ts can run
 * the raw leaderboard without the cache layer.
 *
 * The Fastest Clears board (#130) lives here too: `runFastestClearRows` is its
 * per-raid runner, sharing `COMPLETION` and `buildRaidFilterClause` with the count
 * board so the two can't drift on who counts, and `board: 'fastest'` routes a
 * request to its own cache keys.
 */
import { getDb } from '../db';
import { COMPLETION, buildRaidFilterClause, type RaidFilters } from '../db/queries';
import { getAllRaidDefinitions } from '../bungie/manifest';
import { envSeconds, envMs } from '../env';
import { getOrCompute, type CacheState } from './swr-cache';

type SqlParam = string | number;

interface LeaderboardDbRow {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
    completions: number;
    lastClearAt: number;
}

export interface LeaderboardResponseEntry {
    membershipId: string;
    membershipType: number;
    displayName: string;
    completions: number;
    /** Competition rank ("1224"): tied completions share a rank, next rank skips by group size. */
    rank: number;
}

export interface IndividualLeaderboard<E = LeaderboardResponseEntry> {
    raidKey: string;
    raidName: string;
    entries: E[];
}

/**
 * Which board a request is for. `fullClears` is the original board and the default for
 * a missing or unknown `board` parameter; `fastest` ranks by Clear Time (#130).
 */
export type LeaderboardBoard = 'fullClears' | 'fastest';

export type ResponseState = CacheState | 'bypass';


export interface LeaderboardRequest {
    /** Absent means `fullClears`. `fastest` ignores `mode`: it is always per raid. */
    board?: LeaderboardBoard;
    mode: 'aggregate' | 'individual';
    hours: number;
    /** Validated raid keys as requested (may be empty = all raids). */
    raidKeys: string[];
    limit: number;
    filters?: RaidFilters;
}

export interface CacheBand {
    /** seconds — edge s-maxage */
    sMaxAge: number;
    /** seconds — edge stale-while-revalidate */
    staleWhileRevalidate: number;
    freshMs: number;
    staleMs: number;
    negativeMs: number;
    warmed: boolean;
}

export interface LeaderboardResult {
    body: unknown;
    state: ResponseState;
    band: CacheBand;
}

/** Rows cached per canonical key. The client max limit is 100. */
const CACHED_LIMIT = 100;

/** Windows the warmer keeps hot (band 4: > 48h). */
export const WARM_WINDOWS = [168, 720];

// ── TTL bands ───────────────────────────────────────────────────────────────

/**
 * 4 bands by `hours`, named by upper bound. fresh = s-maxage, stale = SWR.
 * Floored at 60s because the client already refetches every 60s.
 */
export function leaderboardCacheBand(hours: number): CacheBand {
    let fresh: number;
    let stale: number;
    let warmed = false;

    if (hours <= 6) {
        fresh = envSeconds('CACHE_FRESH_6H', 60);
        stale = envSeconds('CACHE_SWR_6H', 300);
    } else if (hours <= 24) {
        fresh = envSeconds('CACHE_FRESH_24H', 180);
        stale = envSeconds('CACHE_SWR_24H', 900);
    } else if (hours <= 48) {
        fresh = envSeconds('CACHE_FRESH_48H', 300);
        stale = envSeconds('CACHE_SWR_48H', 1800);
    } else {
        fresh = envSeconds('CACHE_FRESH_720H', 600);
        stale = envSeconds('CACHE_SWR_720H', 3600);
        warmed = true;
    }

    return {
        sMaxAge: fresh,
        staleWhileRevalidate: stale,
        freshMs: fresh * 1000,
        staleMs: stale * 1000,
        negativeMs: envMs('CACHE_NEGATIVE_MS', 20_000),
        warmed,
    };
}

// ── Query runner ─────────────────────────────────────────────────────────────

function formatDisplayName(
    entry: Pick<LeaderboardDbRow, 'membershipId' | 'displayName' | 'bungieGlobalDisplayName' | 'bungieGlobalDisplayNameCode'>,
): string {
    if (entry.bungieGlobalDisplayName && entry.bungieGlobalDisplayNameCode) {
        return `${entry.bungieGlobalDisplayName}#${String(entry.bungieGlobalDisplayNameCode).padStart(4, '0')}`;
    }
    return entry.bungieGlobalDisplayName || entry.displayName || entry.membershipId;
}

/**
 * Runs the leaderboard aggregation. Empty `raidKeys` = all raids (no filter);
 * a single key yields the same ranking as the per-raid individual query.
 * `fullClearsOnly` is always applied (forced true on every cached + bypass path).
 */
export function runLeaderboardRows(hours: number, raidKeys: string[], limit: number, filters?: RaidFilters): LeaderboardResponseEntry[] {
    const db = getDb();
    const cutoff = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);

    let query = `
        SELECT
          pp.membership_id as membershipId,
          pp.membership_type as membershipType,
          COALESCE(pl.bungie_global_display_name, pp.display_name) as displayName,
          pl.bungie_global_display_name as bungieGlobalDisplayName,
          pl.bungie_global_display_name_code as bungieGlobalDisplayNameCode,
          COUNT(DISTINCT pp.instance_id) as completions,
          MAX(p.ended_at) as lastClearAt
        FROM pgcr_players pp
        JOIN pgcrs p ON pp.instance_id = p.instance_id
        LEFT JOIN players pl ON pp.membership_id = pl.membership_id
        WHERE p.ended_at >= ?
          AND ${COMPLETION}
    `;

    const params: SqlParam[] = [cutoff];

    if (raidKeys.length > 0) {
        const placeholders = raidKeys.map(() => '?').join(',');
        query += ` AND p.raid_key IN (${placeholders})`;
        params.push(...raidKeys);
    }

    const { clause: filterClause, params: filterParams } = buildRaidFilterClause(filters);
    query += filterClause;
    params.push(...filterParams);

    // Within a tie group the earliest achiever ranks highest: lastClearAt is the
    // completion time of the most recent counted clear, so a stale PGCR found
    // late still slots the player at their true historical position.
    query += `
        GROUP BY pp.membership_id
        HAVING completions > 0
        ORDER BY completions DESC, lastClearAt ASC, pp.membership_id ASC
        LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(query).all(...params) as LeaderboardDbRow[];
    let prevCompletions = -1;
    let prevRank = 0;
    return rows.map((row, index) => {
        const rank = row.completions === prevCompletions ? prevRank : index + 1;
        prevCompletions = row.completions;
        prevRank = rank;
        return {
            membershipId: row.membershipId,
            membershipType: row.membershipType,
            displayName: formatDisplayName(row),
            completions: row.completions,
            rank,
        };
    });
}

interface FastestClearDbRow {
    membershipId: string;
    membershipType: number;
    displayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
    clearTimeSeconds: number;
    instanceId: string;
    endedAt: number;
}

export interface FastestClearEntry {
    membershipId: string;
    membershipType: number;
    displayName: string;
    /** The player's fastest Clear Time on this board, in seconds. */
    clearTimeSeconds: number;
    /** The run that set it, for the raid.report PGCR link (#133). */
    instanceId: string;
    /** When that run ended, unix seconds, for the tooltip (#133). */
    endedAt: number;
    /** Competition rank ("1224"): equal Clear Times share a rank. */
    rank: number;
}

/**
 * Runs one raid's Fastest Clears board: each player's fastest Clear Time among their
 * Completions in the window, one row per player.
 *
 * Per raid only — a fastest time across different raids means nothing, so unlike
 * {@link runLeaderboardRows} this takes one raid key rather than a set.
 *
 * Clear Time is `ended_at - period`, the profile's `CLEARED_DURATION` expression. No
 * duration floor: suspected-cheated runs rank like any other, by decision (#130).
 */
export function runFastestClearRows(hours: number, raidKey: string, limit: number, filters?: RaidFilters): FastestClearEntry[] {
    const db = getDb();
    const cutoff = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
    const { clause: filterClause, params: filterParams } = buildRaidFilterClause(filters);

    // The window picks each player's own best run; within one player's equal times, the
    // earliest-ended run is the one shown, matching the board's tie-break below.
    const query = `
        WITH cleared AS (
            SELECT
              pp.membership_id as membershipId,
              pp.membership_type as membershipType,
              pp.display_name as runDisplayName,
              pp.instance_id as instanceId,
              p.ended_at as endedAt,
              p.ended_at - p.period as clearTimeSeconds,
              ROW_NUMBER() OVER (
                PARTITION BY pp.membership_id
                ORDER BY p.ended_at - p.period ASC, p.ended_at ASC, pp.instance_id ASC
              ) as fastestFirst
            FROM pgcr_players pp
            JOIN pgcrs p ON pp.instance_id = p.instance_id
            WHERE p.ended_at >= ?
              AND ${COMPLETION}
              AND p.raid_key = ?
              ${filterClause}
        )
        SELECT
          c.membershipId,
          c.membershipType,
          COALESCE(pl.bungie_global_display_name, c.runDisplayName) as displayName,
          pl.bungie_global_display_name as bungieGlobalDisplayName,
          pl.bungie_global_display_name_code as bungieGlobalDisplayNameCode,
          c.clearTimeSeconds,
          c.instanceId,
          c.endedAt
        FROM cleared c
        LEFT JOIN players pl ON c.membershipId = pl.membership_id
        WHERE c.fastestFirst = 1
        ORDER BY c.clearTimeSeconds ASC, c.endedAt ASC, c.membershipId ASC
        LIMIT ?
    `;

    const rows = db.prepare(query).all(cutoff, raidKey, ...filterParams, limit) as FastestClearDbRow[];
    let prevClearTime = -1;
    let prevRank = 0;
    return rows.map((row, index) => {
        const rank = row.clearTimeSeconds === prevClearTime ? prevRank : index + 1;
        prevClearTime = row.clearTimeSeconds;
        prevRank = rank;
        return {
            membershipId: row.membershipId,
            membershipType: row.membershipType,
            displayName: formatDisplayName(row),
            clearTimeSeconds: row.clearTimeSeconds,
            instanceId: row.instanceId,
            endedAt: row.endedAt,
            rank,
        };
    });
}

const yieldTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Computes the 13-board individual payload, yielding between raids so the
 *  synchronous queries don't monopolize the event loop in one burst. `runRaid` is the
 *  board's per-raid runner, so both boards share this loop. */
async function computeIndividualAll<E>(
    raidKeys: string[],
    runRaid: (raidKey: string) => E[],
): Promise<Record<string, IndividualLeaderboard<E>>> {
    const allRaids = getAllRaidDefinitions();
    const boards: Record<string, IndividualLeaderboard<E>> = {};
    for (const raidKey of raidKeys) {
        boards[raidKey] = {
            raidKey,
            raidName: allRaids[raidKey]?.name || raidKey,
            entries: runRaid(raidKey),
        };
        await yieldTick();
    }
    return boards;
}

// ── Envelope builders ────────────────────────────────────────────────────────

function aggregateBody(hours: number, raidKeys: string[], entries: LeaderboardResponseEntry[]): unknown {
    return { mode: 'aggregate', hours, fullClearsOnly: true, raidKeys, entries };
}

function individualBody(
    hours: number,
    raidKeys: string[],
    leaderboards: Record<string, IndividualLeaderboard>,
): unknown {
    return { mode: 'individual', hours, fullClearsOnly: true, raidKeys, leaderboards };
}

/**
 * The Fastest Clears envelope: always the per-raid ("individual") shape, whatever `mode`
 * was asked for, with `board` set so a client can never mistake it for a count board.
 */
function fastestBody(
    hours: number,
    raidKeys: string[],
    leaderboards: Record<string, IndividualLeaderboard<FastestClearEntry>>,
): unknown {
    return { board: 'fastest', mode: 'individual', hours, raidKeys, leaderboards };
}

function sliceBoards<E>(
    boards: Record<string, IndividualLeaderboard<E>>,
    limit: number,
): Record<string, IndividualLeaderboard<E>> {
    const out: Record<string, IndividualLeaderboard<E>> = {};
    for (const [raidKey, board] of Object.entries(boards)) {
        out[raidKey] = { ...board, entries: board.entries.slice(0, limit) };
    }
    return out;
}

// ── Key normalization + entry point ──────────────────────────────────────────

function isFullSet(sortedKeys: string[], allKeys: string[]): boolean {
    if (sortedKeys.length !== allKeys.length) return false;
    const all = new Set(allKeys);
    return sortedKeys.every((k) => all.has(k));
}

export function filterKeySuffix(filters?: RaidFilters): string {
    if (!filters?.difficulty && filters?.exactPlayers == null && filters?.maxPlayers == null) return '';
    const parts: string[] = [];
    if (filters?.difficulty) parts.push(`d:${filters.difficulty}`);
    if (filters?.exactPlayers != null) parts.push(`ep:${filters.exactPlayers}`);
    if (filters?.maxPlayers != null) parts.push(`mp:${filters.maxPlayers}`);
    return `|${parts.join('|')}`;
}

/**
 * Resolve a request to a response body + cache state. Canonical shapes
 * (aggregate-all, individual-all, single-raid) are memoized via the SWR cache;
 * arbitrary multi-raid subsets bypass the cache and compute fresh.
 */
export async function getLeaderboardResponse(req: LeaderboardRequest): Promise<LeaderboardResult> {
    const allRaids = getAllRaidDefinitions();
    const allKeys = Object.keys(allRaids);
    const band = leaderboardCacheBand(req.hours);
    const swr = { freshMs: band.freshMs, staleMs: band.staleMs, negativeMs: band.negativeMs };

    const sortedSelected = [...req.raidKeys].sort();
    const isAll = sortedSelected.length === 0 || isFullSet(sortedSelected, allKeys);
    const cacheLimit = Math.min(req.limit, CACHED_LIMIT);
    const fSuffix = filterKeySuffix(req.filters);

    if (req.board === 'fastest') {
        return getFastestResponse(req, { allKeys, sortedSelected, isAll, cacheLimit, fSuffix, band, swr });
    }

    // Single raid — ranking is mode-agnostic; cache once, wrap per request mode.
    if (!isAll && sortedSelected.length === 1) {
        const raidKey = sortedSelected[0];
        const key = `single|${req.hours}|${raidKey}|fc1${fSuffix}`;
        const { value, state } = await getOrCompute(key, swr, () =>
            runLeaderboardRows(req.hours, [raidKey], CACHED_LIMIT, req.filters),
        );
        const entries = value.slice(0, cacheLimit);
        const body = req.mode === 'individual'
            ? individualBody(req.hours, [raidKey], {
                [raidKey]: { raidKey, raidName: allRaids[raidKey]?.name || raidKey, entries },
            })
            : aggregateBody(req.hours, [raidKey], entries);
        return { body, state, band };
    }

    // All raids — distinct computations per mode (cannot derive one from the other).
    if (isAll) {
        if (req.mode === 'individual') {
            const key = `individual|${req.hours}||fc1${fSuffix}`;
            const { value, state } = await getOrCompute(key, swr, () =>
                computeIndividualAll(allKeys, (raidKey) => runLeaderboardRows(req.hours, [raidKey], CACHED_LIMIT, req.filters)),
            );
            return { body: individualBody(req.hours, allKeys, sliceBoards(value, cacheLimit)), state, band };
        }
        const key = `aggregate|${req.hours}||fc1${fSuffix}`;
        const { value, state } = await getOrCompute(key, swr, () =>
            runLeaderboardRows(req.hours, [], CACHED_LIMIT, req.filters),
        );
        return { body: aggregateBody(req.hours, allKeys, value.slice(0, cacheLimit)), state, band };
    }

    // Bypass — arbitrary subset (2..12 raids). Compute fresh at the requested limit.
    if (req.mode === 'individual') {
        const boards: Record<string, IndividualLeaderboard> = {};
        for (const raidKey of req.raidKeys) {
            boards[raidKey] = {
                raidKey,
                raidName: allRaids[raidKey]?.name || raidKey,
                entries: runLeaderboardRows(req.hours, [raidKey], req.limit, req.filters),
            };
        }
        return { body: individualBody(req.hours, req.raidKeys, boards), state: 'bypass', band };
    }

    const entries = runLeaderboardRows(req.hours, req.raidKeys, req.limit, req.filters);
    return { body: aggregateBody(req.hours, req.raidKeys, entries), state: 'bypass', band };
}

/**
 * The Fastest Clears half of {@link getLeaderboardResponse}: the same SWR cache, TTL bands
 * and limit-collapse, under its own `fastest-` key prefix so the two boards can never be
 * served for each other. Only the per-raid shapes exist — single raid, all raids, and an
 * arbitrary subset that bypasses the cache — mirroring the Full Clears individual paths.
 *
 * The warmer does not call this (#130): measure the cold path in prod before warming it.
 */
async function getFastestResponse(
    req: LeaderboardRequest,
    shape: {
        allKeys: string[];
        sortedSelected: string[];
        isAll: boolean;
        cacheLimit: number;
        fSuffix: string;
        band: CacheBand;
        swr: { freshMs: number; staleMs: number; negativeMs: number };
    },
): Promise<LeaderboardResult> {
    const { allKeys, sortedSelected, isAll, cacheLimit, fSuffix, band, swr } = shape;
    const allRaids = getAllRaidDefinitions();
    const board = (raidKey: string, entries: FastestClearEntry[]): IndividualLeaderboard<FastestClearEntry> => ({
        raidKey,
        raidName: allRaids[raidKey]?.name || raidKey,
        entries,
    });

    if (!isAll && sortedSelected.length === 1) {
        const raidKey = sortedSelected[0];
        const key = `fastest-single|${req.hours}|${raidKey}${fSuffix}`;
        const { value, state } = await getOrCompute(key, swr, () =>
            runFastestClearRows(req.hours, raidKey, CACHED_LIMIT, req.filters),
        );
        return { body: fastestBody(req.hours, [raidKey], { [raidKey]: board(raidKey, value.slice(0, cacheLimit)) }), state, band };
    }

    if (isAll) {
        const key = `fastest-individual|${req.hours}|${fSuffix}`;
        const { value, state } = await getOrCompute(key, swr, () =>
            computeIndividualAll(allKeys, (raidKey) => runFastestClearRows(req.hours, raidKey, CACHED_LIMIT, req.filters)),
        );
        return { body: fastestBody(req.hours, allKeys, sliceBoards(value, cacheLimit)), state, band };
    }

    const boards: Record<string, IndividualLeaderboard<FastestClearEntry>> = {};
    for (const raidKey of req.raidKeys) {
        boards[raidKey] = board(raidKey, runFastestClearRows(req.hours, raidKey, req.limit, req.filters));
    }
    return { body: fastestBody(req.hours, req.raidKeys, boards), state: 'bypass', band };
}
