import { expect, test } from './support/test-fixtures';
import { ANY_AGE_SECONDS, RAID_A, seedPlayerWithSession } from './support/seed-world';
import { seedPlayer } from '../tests/helpers/seed';
import { buildActiveProfile, buildInactiveProfile, buildPrivateProfile } from '../tests/helpers/bungie-profile-builder';
import { getActiveSessionContainingPlayer, getPlayerIdentity } from '../src/lib/db/queries';
import { getDb } from '../src/lib/db';
import { interceptApiCalls, recordProfileViewed, waitForProfileViewed } from './support/network-log';
import { fulfillBungie } from './support/bungie-stub';
import { isolatePollCycle, stubCrawlerBungie } from './support/crawler-bungie';
import { expectNoOverflow } from './support/viewport';

/**
 * What a profile view asks of the crawler (#9003). When the page's own Bungie check finds a raid,
 * or the stored baseline had a session for the player, it POSTs `/api/players/profile-viewed`
 * with ids and nothing else (ADR 0010); the crawler then lists, or re-checks, that Fireteam on
 * its next poll cycle. The server never trusts the browser's reason for asking.
 *
 *   - a raiding player: the request carries that player's id and type and no other field, and the
 *     Tracker gains no session row and no player row;
 *   - a private player found through a public teammate: the request also names that teammate;
 *   - a player with a stored session while Bungie says no activity: the request is still sent, so
 *     the crawler re-checks the row;
 *   - a player with no stored session and no activity: the same single request, asking for the
 *     history crawl alone (`poll:false`), queued in `crawl_queue` and not in the poll queue;
 *   - an account-wide private player: no history crawl (`history:false`), and no request at all
 *     with nothing stored;
 *   - a refused (429) or failed request: the card is left as it was;
 *   - the end to end half: after the request, one poll cycle run in this process against the
 *     fixture Tracker (the e2e server has no crawler; see support/crawler-bungie.ts) lists the
 *     raiding player's Fireteam on /active-sessions.
 *
 * Bungie is stubbed in the browser; our own API is real (ADR 0004). Requires
 * NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY at build time, as profile-live-card.spec.ts does.
 */

// Namespace prefix 86. Each id is viewed once in the server's life: the per-player cooldown
// would make a second view of the same id enqueue nothing.
const RAIDING_ID = '4611686018488600001';
const RAIDING_NAME = 'AskedGuardian86';
const RAIDING_CODE = 8601;

const HIDDEN_ID = '4611686018488600002';
const HIDDEN_NAME = 'HiddenAsker86';
const HIDDEN_CODE = 8602;
const TEAMMATE_ID = '4611686018488600003';
const TEAMMATE_NAME = 'PublicAsked86';
const TEAMMATE_CODE = 8603;

const LEFT_ID = '4611686018488600004';
const LEFT_NAME = 'LeftAsker86';
const LEFT_CODE = 8604;

const QUIET_ID = '4611686018488600005';

const REFUSED_ID = '4611686018488600006';
const LOST_ID = '4611686018488600007';

const LISTED_ID = '4611686018488600008';
const LISTED_NAME = 'ListedAfterCycle86';
const LISTED_CODE = 8608;

const PRIV_SESSION_ID = '4611686018488600009';
const PRIV_SESSION_NAME = 'PrivateAsker86';
const PRIV_SESSION_CODE = 8609;
const PRIV_NONE_ID = '4611686018488600010';

const raidHeading = (page: import('@playwright/test').Page) =>
    page.getByRole('heading', { level: 3, name: RAID_A.name });

function raidingProfile(membershipId: string, name: string, code: number) {
    return buildActiveProfile({
        membershipId,
        membershipType: 3,
        displayName: name,
        bungieGlobalDisplayName: name,
        bungieGlobalDisplayNameCode: code,
        partyMembers: [{ membershipId, displayName: name, status: 1 }],
    });
}

/** The players whose raid history is queued for a crawl by a profile view. */
function crawlQueuedIds(): string[] {
    return (getDb().prepare("SELECT membership_id FROM crawl_queue WHERE source = 'profile-view'").all() as { membership_id: string }[])
        .map((row) => row.membership_id);
}

function pendingPollRequests(): string[] {
    return (getDb().prepare('SELECT membership_id FROM session_poll_requests').all() as { membership_id: string }[])
        .map((row) => row.membership_id);
}

test.beforeAll(() => {
    // Known to the site, so the page can probe the teammate by type; neither has a session row.
    seedPlayer(HIDDEN_ID, HIDDEN_NAME, HIDDEN_CODE);
    seedPlayer(TEAMMATE_ID, TEAMMATE_NAME, TEAMMATE_CODE);
    seedPlayerWithSession({ membershipId: LEFT_ID, name: LEFT_NAME, code: LEFT_CODE, raid: RAID_A });
    // The quiet player is known, with no session.
    seedPlayer(QUIET_ID, 'QuietAsker86', 8605);
    // Account-wide private: one has a stored session of their own, the other has nothing.
    seedPlayerWithSession({ membershipId: PRIV_SESSION_ID, name: PRIV_SESSION_NAME, code: PRIV_SESSION_CODE, raid: RAID_A });
    seedPlayer(PRIV_NONE_ID, 'PrivateNone86', 8610);
});

test.describe('profile view asks the crawler to look', () => {
    test('a raiding player sends their id and type and nothing else, and the Tracker gains no row', async ({ page }) => {
        const log = interceptApiCalls(page);
        const bodies = recordProfileViewed(page);
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, raidingProfile(RAIDING_ID, RAIDING_NAME, RAIDING_CODE)));
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${RAIDING_ID}`);
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });

        expect((await sent).status()).toBe(202);
        expect(bodies).toEqual([{ membershipId: RAIDING_ID, membershipType: 3 }]);
        const post = log.find((e) => e.method === 'POST' && e.path === '/api/players/profile-viewed');
        expect(post?.hasPageToken).toBe(true);
        // One view, one client write: the history crawl rides in the same request.
        expect(log.filter((e) => e.method === 'POST')).toHaveLength(1);
        expect(crawlQueuedIds()).toContain(RAIDING_ID);

        // Asking is not writing: the crawler lists them, not the browser (ADR 0010).
        expect(getActiveSessionContainingPlayer(RAIDING_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(getPlayerIdentity(RAIDING_ID)).toBeNull();
        expect(pendingPollRequests()).toContain(RAIDING_ID);
    });

    test('a private player found through a public teammate also names that teammate', async ({ page }) => {
        const startTime = new Date(Date.now() - 25 * 60_000).toISOString();
        const roster = [
            { membershipId: HIDDEN_ID, displayName: HIDDEN_NAME, status: 1 },
            { membershipId: TEAMMATE_ID, displayName: TEAMMATE_NAME, status: 9 },
        ];
        const hidden = buildPrivateProfile({
            membershipId: HIDDEN_ID, displayName: HIDDEN_NAME, bungieGlobalDisplayName: HIDDEN_NAME,
            bungieGlobalDisplayNameCode: HIDDEN_CODE, startTime, partyMembers: roster,
        });
        const teammate = buildActiveProfile({
            membershipId: TEAMMATE_ID, displayName: TEAMMATE_NAME, bungieGlobalDisplayName: TEAMMATE_NAME,
            bungieGlobalDisplayNameCode: TEAMMATE_CODE, startTime, partyMembers: roster,
        });
        await page.route('**/Platform/Destiny2/**', async (route) => {
            const url = route.request().url();
            if (url.includes(`/Profile/${HIDDEN_ID}/`)) return fulfillBungie(route, hidden);
            if (url.includes(`/Profile/${TEAMMATE_ID}/`)) return fulfillBungie(route, teammate);
            return route.fallback();
        });
        const bodies = recordProfileViewed(page);
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${HIDDEN_ID}`);
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });

        await sent;
        expect(bodies).toEqual([{
            membershipId: HIDDEN_ID,
            membershipType: 3,
            teammate: { membershipId: TEAMMATE_ID, membershipType: 3 },
        }]);
        expect(getActiveSessionContainingPlayer(HIDDEN_ID, ANY_AGE_SECONDS)).toBeNull();
        // Polled through the teammate; the history crawl is the viewed player's alone.
        expect(pendingPollRequests()).toEqual(expect.arrayContaining([HIDDEN_ID, TEAMMATE_ID]));
        expect(crawlQueuedIds()).toContain(HIDDEN_ID);
        expect(crawlQueuedIds()).not.toContain(TEAMMATE_ID);
    });

    test('a stored session while Bungie reports no activity still asks, so the crawler re-checks it', async ({ page }) => {
        const inactive = buildInactiveProfile({
            membershipId: LEFT_ID, displayName: LEFT_NAME, bungieGlobalDisplayName: LEFT_NAME, bungieGlobalDisplayNameCode: LEFT_CODE,
        });
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, inactive));
        const bodies = recordProfileViewed(page);
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${LEFT_ID}`);
        await sent;

        expect(bodies).toEqual([{ membershipId: LEFT_ID, membershipType: 3 }]);
        // The row is still there, marked for the crawler's re-verify: only the crawler removes it.
        const marked = getDb().prepare('SELECT reverify_requested_at FROM active_sessions WHERE membership_id = ?').get(LEFT_ID) as
            { reverify_requested_at: number | null } | undefined;
        expect(marked?.reverify_requested_at).toEqual(expect.any(Number));
    });

    test('a player with no stored session and no activity asks for the history crawl alone', async ({ page }) => {
        const log = interceptApiCalls(page);
        const bodies = recordProfileViewed(page);
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, buildInactiveProfile({
            membershipId: QUIET_ID, displayName: 'QuietAsker86', bungieGlobalDisplayName: 'QuietAsker86', bungieGlobalDisplayNameCode: 8605,
        })));
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${QUIET_ID}`);
        expect((await sent).status()).toBe(202);
        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        expect(bodies).toEqual([{ membershipId: QUIET_ID, membershipType: 3, poll: false }]);
        expect(log.filter((e) => e.method === 'POST').map((e) => e.path)).toEqual(['/api/players/profile-viewed']);
        // Nothing to poll, so no poll request; the history refresh is still queued.
        expect(pendingPollRequests()).not.toContain(QUIET_ID);
        expect(crawlQueuedIds()).toContain(QUIET_ID);
    });

    test('an account-wide private player with a stored session asks for the poll without the history crawl', async ({ page }) => {
        const bodies = recordProfileViewed(page);
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, {}, {
            ErrorCode: 1665, ErrorStatus: 'DestinyPrivacyRestriction', Message: 'No peeking.',
        }));
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${PRIV_SESSION_ID}`);
        expect((await sent).status()).toBe(202);

        expect(bodies).toEqual([{ membershipId: PRIV_SESSION_ID, membershipType: 3, history: false }]);
        expect(crawlQueuedIds()).not.toContain(PRIV_SESSION_ID);
    });

    test('an account-wide private player with nothing stored sends no request', async ({ page }) => {
        const log = interceptApiCalls(page);
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, {}, {
            ErrorCode: 1665, ErrorStatus: 'DestinyPrivacyRestriction', Message: 'No peeking.',
        }));

        await page.goto(`/player/3/${PRIV_NONE_ID}`);
        await expect(page.getByText('The user has chosen for this data to be private')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        expect(log.filter((e) => e.method === 'POST')).toEqual([]);
        expect(crawlQueuedIds()).not.toContain(PRIV_NONE_ID);
    });

    test('a 429 on the request leaves the card as it was', async ({ page }) => {
        await page.route('**/api/players/profile-viewed', (route) => route.fulfill({
            status: 429, contentType: 'application/json', body: JSON.stringify({ queued: false, reason: 'rate_limited' }),
        }));
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, raidingProfile(REFUSED_ID, 'RefusedAsker86', 8606)));
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${REFUSED_ID}`);
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });
        expect((await sent).status()).toBe(429);

        await expect(page.getByText('Checking live status…')).toHaveCount(0);
        await expect(raidHeading(page)).toBeVisible();
        await expect(page.getByRole('heading', { level: 1, name: 'RefusedAsker86#8606' })).toBeVisible();
        await expectNoOverflow(page);
    });

    test('a request lost to the network leaves the card as it was', async ({ page }) => {
        await page.route('**/api/players/profile-viewed', (route) => route.abort('failed'));
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, raidingProfile(LOST_ID, 'LostAsker86', 8607)));
        const failed = page.waitForEvent('requestfailed', (request) => request.url().includes('/api/players/profile-viewed'));

        await page.goto(`/player/3/${LOST_ID}`);
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });
        await failed;

        await expect(page.getByText('Checking live status…')).toHaveCount(0);
        await expect(raidHeading(page)).toBeVisible();
        await expect(page.getByRole('heading', { level: 1, name: 'LostAsker86#8607' })).toBeVisible();
        await expectNoOverflow(page);
    });

    test('a viewed raiding player with no row is listed on /active-sessions after a poll cycle', async ({ page }) => {
        const raiding = raidingProfile(LISTED_ID, LISTED_NAME, LISTED_CODE);
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, raiding));
        const sent = waitForProfileViewed(page);

        await page.goto(`/player/3/${LISTED_ID}`);
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });
        expect((await sent).status()).toBe(202);

        // Not listed yet: the browser asked, and nothing has looked.
        expect(getActiveSessionContainingPlayer(LISTED_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(pendingPollRequests()).toContain(LISTED_ID);

        // The crawler's next poll cycle, run here against the same Tracker the server reads, and
        // narrowed to this player: other specs' queued requests and session rows are set aside.
        const putBack = isolatePollCycle(LISTED_ID);
        const bungie = stubCrawlerBungie({ [LISTED_ID]: raiding });
        try {
            const { pollActiveSessions } = await import('../src/lib/crawler/active-sessions');
            await pollActiveSessions([], 200, {
                playerCheckConcurrency: 1, staleCheckConcurrency: 1, pollRequestMaxPerCycle: 20,
            });
        } finally {
            bungie.restore();
            putBack();
        }
        // The crawler swallows a failed Bungie call, so a stray one shows only here.
        expect(bungie.unexpected).toEqual([]);
        expect(bungie.asked).toEqual([LISTED_ID]);

        await page.goto('/active-sessions');
        await expect(page.getByText(`${LISTED_NAME}#${LISTED_CODE}'s fireteam`)).toBeVisible({ timeout: 10_000 });
        expect(getPlayerIdentity(LISTED_ID)?.bungieGlobalDisplayName).toBe(LISTED_NAME);
    });
});
