import { bungieEnvelope } from '../../tests/helpers/bungie-profile-builder';
import type { DestinyProfileResponse } from '../../src/lib/bungie/types';

/**
 * Bungie's answer to the crawler's GetProfile call, for a spec that runs one poll cycle itself.
 *
 * The e2e server has no crawler. A spec that needs the "after the crawler's next poll cycle" half
 * runs `pollActiveSessions` in the Playwright worker against the same fixture Tracker the server
 * reads, with the worker's `fetch` answering for Bungie. That `fetch` is Node's, not the
 * browser's: it is a different thing from the `page.route` stubs, and `APIRequestContext` and the
 * page never touch it. (`tests/crawler/bungie-stub.ts` does the same under Vitest, but imports
 * `vitest`, which `tests/helpers/` and e2e may not.)
 *
 * Only GetProfile is answered; anything else the crawler asks fails the spec loudly.
 */
const PROFILE_URL = /\/Destiny2\/(-?\d+)\/Profile\/(\d+)\/\?components=([\d,]+)$/;

export interface CrawlerBungie {
    /** The membership ids Bungie was asked about, in call order: the crawler's budget. */
    asked: string[];
    restore(): void;
}

export function stubCrawlerBungie(answers: Record<string, DestinyProfileResponse>): CrawlerBungie {
    const original = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const match = PROFILE_URL.exec(String(input));
        if (!match) throw new Error(`Unexpected request from the crawler in an e2e spec: ${String(input)}`);
        const membershipId = match[2];
        asked.push(membershipId);
        const answer = answers[membershipId];
        if (!answer) throw new Error(`No stubbed Bungie answer for ${membershipId}`);
        return new Response(JSON.stringify(bungieEnvelope(answer)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;
    return { asked, restore: () => { globalThis.fetch = original; } };
}
