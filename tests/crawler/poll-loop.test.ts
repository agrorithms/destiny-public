import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCrawler, stopCrawler } from '@/lib/crawler';
import { claimSessionPollRequests, requestSessionPoll } from '@/lib/db/queries';
import { resetTestDb, testDb } from '../helpers/db';
import { buildActiveProfile } from '../helpers/bungie-profile-builder';
import { stubBungieProfiles } from './bungie-stub';

/**
 * Poll requests are handled inside the active-session loop's existing guards (ADR 0005), not
 * beside them (#9002). The loop is driven for real: startCrawler with only setTimeout faked,
 * so its 30s initial delay, the watchdog race and the `finally` reschedule all run as written.
 * A completion-anchored session_heartbeat after a cycle that consumed a request is the proof
 * that the request work ran inside the watchdog-guarded poll and finished within budget.
 */

const REQUESTED_ID = '4611686018488980001';

function sessionHeartbeat(): string | undefined {
    return (testDb().prepare("SELECT value FROM crawler_state WHERE key = 'session_heartbeat'").get() as
        | { value: string }
        | undefined)?.value;
}

afterEach(() => {
    stopCrawler();
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('the active-session loop with a poll request pending', () => {
    it('handles the request in a cycle that completes inside the watchdog and writes its heartbeat', async () => {
        resetTestDb();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        stubBungieProfiles({
            [REQUESTED_ID]: buildActiveProfile({ membershipId: REQUESTED_ID, partyMembers: [{ membershipId: REQUESTED_ID }] }),
        });
        requestSessionPoll(REQUESTED_ID, 3);

        await startCrawler({ intervalMs: 3_600_000 });
        expect(sessionHeartbeat()).toBeUndefined();

        // The loop's first poll waits CRAWLER_ACTIVE_SESSION_INITIAL_DELAY_MS (30s by default).
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() => expect(sessionHeartbeat()).toBeDefined());

        expect(claimSessionPollRequests(10)).toEqual([]);
        expect(testDb().prepare('SELECT membership_id FROM active_sessions').all()).toEqual([{ membership_id: REQUESTED_ID }]);
        expect(testDb().prepare("SELECT value FROM crawler_state WHERE key = 'session_watchdog_trips'").get()).toBeUndefined();
    });
});
