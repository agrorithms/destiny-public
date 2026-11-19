import { vi } from 'vitest';
import type { DestinyProfileResponse } from '@/lib/bungie/types';
import { bungieEnvelope } from '../helpers/bungie-profile-builder';

/**
 * Bungie's answer for one membership id, as the crawler's GetProfile call sees it.
 *  - a profile: ErrorCode 1 with that Response;
 *  - `rejected`: ErrorCode 1601 DestinyAccountNotFound, what Bungie sends for an id it doesn't know;
 *  - `timeout`: the fetch rejects, as AbortSignal.timeout does — no signal at all.
 */
export type BungieAnswer = DestinyProfileResponse | 'rejected' | 'timeout';

export interface ProfileCall {
    membershipId: string;
    components: string;
}

const PROFILE_URL = /\/Destiny2\/-?\d+\/Profile\/(\d+)\/\?components=([\d,]+)$/;

/**
 * Stubs `fetch` (the only thing tests mock, ADR 0004) to answer GetProfile per membership id,
 * and records every call: the calls are the crawler's Bungie budget, which several criteria
 * are about. An id with no answer fails the test loudly rather than reading as "offline".
 */
export function stubBungieProfiles(answers: Record<string, BungieAnswer>): ProfileCall[] {
    const calls: ProfileCall[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = String(input);
        const match = PROFILE_URL.exec(url);
        if (!match) throw new Error(`Unexpected Bungie request in test: ${url}`);
        const [, membershipId, components] = match;
        calls.push({ membershipId, components });

        const answer = answers[membershipId];
        if (answer === undefined) throw new Error(`No stubbed Bungie answer for ${membershipId}`);
        if (answer === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        const body = answer === 'rejected'
            ? bungieEnvelope(null, { ErrorCode: 1601, ErrorStatus: 'DestinyAccountNotFound', Message: 'Not found' })
            : bungieEnvelope(answer);
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    return calls;
}

/** The membership ids Bungie was asked about, in call order. */
export function askedAbout(calls: ProfileCall[]): string[] {
    return calls.map((c) => c.membershipId);
}
