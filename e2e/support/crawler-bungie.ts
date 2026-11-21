import { bungieEnvelope } from '../../tests/helpers/bungie-profile-builder';
import { getDb } from '../../src/lib/db';
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
 * Only GetProfile for an id in `answers` is answered. Anything else is recorded in `unexpected`
 * and thrown, which the crawler swallows as a transient error (`status: 'error'`) and carries on:
 * a throw alone fails nothing, so the spec asserts `unexpected` is empty. The Bungie client
 * refuses to send without a key, so a dummy one is set while the stub is in place.
 */
const PROFILE_URL = /\/Destiny2\/(-?\d+)\/Profile\/(\d+)\/\?components=([\d,]+)$/;

export interface CrawlerBungie {
    /** The membership ids Bungie was asked about, in call order: the crawler's budget. */
    asked: string[];
    /** Every request with no stubbed answer, by URL. A spec asserts it is empty. */
    unexpected: string[];
    restore(): void;
}

export function stubCrawlerBungie(answers: Record<string, DestinyProfileResponse>): CrawlerBungie {
    const original = globalThis.fetch;
    const originalKey = process.env.BUNGIE_API_KEY;
    process.env.BUNGIE_API_KEY ??= 'e2e-dummy-key-not-a-real-credential';
    const asked: string[] = [];
    const unexpected: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        const match = PROFILE_URL.exec(url);
        if (match) asked.push(match[2]);
        const answer = match ? answers[match[2]] : undefined;
        if (!answer) {
            unexpected.push(url);
            throw new Error(`No stubbed Bungie answer in an e2e spec: ${url}`);
        }
        return new Response(JSON.stringify(bungieEnvelope(answer)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;
    return {
        asked,
        unexpected,
        restore: () => {
            globalThis.fetch = original;
            if (originalKey === undefined) delete process.env.BUNGIE_API_KEY;
        },
    };
}

/**
 * Narrows the next poll cycle to one player: the one the spec asked about. The fixture Tracker is
 * shared by every spec, and a cycle also claims up to 20 queued requests and re-verifies stale or
 * marked session rows, whoever's they are; other specs leave both behind. This sets them aside
 * (the other requests out of the queue; every other session row fresh and unmarked) and the
 * returned function puts each back exactly as it was, so specs after this one see what they left.
 * Nothing else is touched: rows outside the spec's own fixture namespace belong to other specs
 * (docs/e2e-coverage.md, "Conventions to keep"), so this only hides them for one cycle.
 *
 * Safe only because the suite runs one spec at a time: `workers: 1` with `fullyParallel: false`
 * in playwright.config.ts. With more workers, specs running at the same time would find their
 * queued requests gone and their session rows marked fresh for the length of this cycle, and the
 * returned function would write the values captured here over anything they changed meanwhile.
 * Raising `workers` means rewriting this to touch only the spec's own rows first.
 */
export function isolatePollCycle(membershipId: string): () => void {
    const db = getDb();
    const requests = db.prepare('SELECT membership_id, membership_type, requested_at FROM session_poll_requests WHERE membership_id != ?')
        .all(membershipId) as { membership_id: string; membership_type: number; requested_at: number }[];
    const sessions = db.prepare('SELECT membership_id, checked_at, reverify_requested_at FROM active_sessions WHERE membership_id != ?')
        .all(membershipId) as { membership_id: string; checked_at: number; reverify_requested_at: number | null }[];
    db.transaction(() => {
        db.prepare('DELETE FROM session_poll_requests WHERE membership_id != ?').run(membershipId);
        db.prepare('UPDATE active_sessions SET checked_at = unixepoch(), reverify_requested_at = NULL WHERE membership_id != ?')
            .run(membershipId);
    })();
    return () => {
        const putRequest = db.prepare(
            'INSERT OR IGNORE INTO session_poll_requests (membership_id, membership_type, requested_at) VALUES (?, ?, ?)',
        );
        const putSession = db.prepare('UPDATE active_sessions SET checked_at = ?, reverify_requested_at = ? WHERE membership_id = ?');
        db.transaction(() => {
            for (const r of requests) putRequest.run(r.membership_id, r.membership_type, r.requested_at);
            for (const s of sessions) putSession.run(s.checked_at, s.reverify_requested_at, s.membership_id);
        })();
    };
}
