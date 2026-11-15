import { expect, test } from './support/test-fixtures';
import { ANY_AGE_SECONDS, RAID_A, seedPlayerWithSession } from './support/seed-world';
import { seedPlayer } from '../tests/helpers/seed';
import { buildActiveProfile, buildInactiveProfile, buildPrivateProfile } from '../tests/helpers/bungie-profile-builder';
import { getActiveSessionContainingPlayer, getActiveSessionForPlayer, getPlayerIdentity } from '../src/lib/db/queries';
import { interceptApiCalls, waitForQueueCrawl } from './support/network-log';
import { fulfillBungie } from './support/bungie-stub';

/**
 * The profile's live card, drawn from the viewer's own Bungie response (#9001). The browser
 * fetches the player's profile with the public key and renders what it got, for that viewer
 * only. Nothing it saw is sent to the server: the only write a profile view makes is the
 * history-crawl request, which carries ids and nothing else.
 *
 *   - a raiding player with no stored session: the card appears, and afterwards the Tracker
 *     still has no session row and no player row for them;
 *   - a stored session while Bungie says the player is in no activity: no card, and the row
 *     is left for the crawler's own re-verify;
 *   - a partly private player (activity withheld) with a public teammate the site knows: the
 *     browser probes the teammate and draws their raid, storing nothing;
 *   - an account-wide private player (Bungie refuses the profile): the stored session that
 *     contains them, read from the Tracker.
 *
 * Bungie is stubbed; our own API is real (ADR 0004). Each check of the Tracker reads the same
 * fixture database the server serves.
 *
 * Requires NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY to have been set at build time: the browser's
 * fetchPlayerProfileClient throws before making a request when the key is missing, and the
 * stub never fires. `npm run e2e` pins a dummy one.
 */

// Namespace prefix 83: membership IDs and display names, per convention.
const RAIDING_ID = '4611686018488300001';
const RAIDING_NAME = 'HappyGuardian83';
const RAIDING_CODE = 8301;

const PRIVATE_ID = '4611686018488300002';
const PRIVATE_NAME = 'PrivateGuardian83';
const PRIVATE_CODE = 8302;

const LEFT_ID = '4611686018488300003';
const LEFT_NAME = 'LeftGuardian83';
const LEFT_CODE = 8303;

const HIDDEN_ID = '4611686018488300004';
const HIDDEN_NAME = 'HiddenGuardian83';
const HIDDEN_CODE = 8304;
const TEAMMATE_ID = '4611686018488300005';
const TEAMMATE_NAME = 'PublicMate83';
const TEAMMATE_CODE = 8305;

const MATE_ID = '4611686018488300006';
const MATE_NAME = 'StoredMate83';
const MATE_CODE = 8306;

const raidHeading = (page: import('@playwright/test').Page) =>
    page.getByRole('heading', { level: 3, name: RAID_A.name });

test.beforeAll(() => {
    // The raiding player is deliberately not seeded: a profile view must not make them known.
    // The private player has no session row of their own: theirs is the one the crawler stored for
    // a teammate, with them in its Roster.
    seedPlayer(PRIVATE_ID, PRIVATE_NAME, PRIVATE_CODE);
    seedPlayerWithSession({ membershipId: MATE_ID, name: MATE_NAME, code: MATE_CODE, raid: RAID_A, extraMembers: [PRIVATE_ID] });
    seedPlayerWithSession({ membershipId: LEFT_ID, name: LEFT_NAME, code: LEFT_CODE, raid: RAID_A });
    // Known to the site, so the page can probe them; neither has a session row.
    seedPlayer(HIDDEN_ID, HIDDEN_NAME, HIDDEN_CODE);
    seedPlayer(TEAMMATE_ID, TEAMMATE_NAME, TEAMMATE_CODE);
});

test.describe('profile live card', () => {
    test('a raiding player with no stored session gets the card, and the Tracker gains nothing', async ({ page }) => {
        const log = interceptApiCalls(page);
        const profile = buildActiveProfile({
            membershipId: RAIDING_ID,
            membershipType: 3,
            displayName: RAIDING_NAME,
            bungieGlobalDisplayName: RAIDING_NAME,
            bungieGlobalDisplayNameCode: RAIDING_CODE,
            partyMembers: [{ membershipId: RAIDING_ID, displayName: RAIDING_NAME, status: 1 }],
        });
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, profile));
        const queueCrawlDone = waitForQueueCrawl(page);

        await page.goto(`/player/3/${RAIDING_ID}`);

        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });
        // An unknown player's heading comes from the same Bungie response.
        await expect(page.getByRole('heading', { level: 1, name: `${RAIDING_NAME}#${RAIDING_CODE}` })).toBeVisible();

        await queueCrawlDone;
        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        expect(getActiveSessionContainingPlayer(RAIDING_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(getPlayerIdentity(RAIDING_ID)).toBeNull();

        // The history-crawl request is the only write, and it still carries the page token.
        const posts = log.filter((entry) => entry.method === 'POST');
        expect(posts.map((entry) => entry.path)).toEqual(['/api/players/queue-crawl']);
        expect(posts[0].hasPageToken).toBe(true);
        expect(log.some((e) => e.method === 'GET' && e.path.includes('part=active'))).toBe(true);
    });

    test('a stored session while Bungie reports no activity shows none, and the row stays', async ({ page }) => {
        const inactive = buildInactiveProfile({
            membershipId: LEFT_ID,
            displayName: LEFT_NAME,
            bungieGlobalDisplayName: LEFT_NAME,
            bungieGlobalDisplayNameCode: LEFT_CODE,
        });
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, inactive));
        const queueCrawlDone = waitForQueueCrawl(page);

        await page.goto(`/player/3/${LEFT_ID}`);

        // The section is drawn while loading, so its leaving is the live answer arriving.
        await expect(page.getByRole('heading', { level: 2, name: 'Active Session' })).toHaveCount(0, { timeout: 10_000 });
        await expect(raidHeading(page)).toHaveCount(0);

        await queueCrawlDone;
        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        // Removing it is the crawler's job, on its own Bungie call (ADR 0005).
        expect(getActiveSessionForPlayer(LEFT_ID, ANY_AGE_SECONDS)).not.toBeNull();
    });

    test('a partly private player is found through a public teammate, and nothing is stored', async ({ page }) => {
        const log = interceptApiCalls(page);
        const startTime = new Date(Date.now() - 25 * 60_000).toISOString();
        const roster = [
            { membershipId: HIDDEN_ID, displayName: HIDDEN_NAME, status: 1 },
            { membershipId: TEAMMATE_ID, displayName: TEAMMATE_NAME, status: 9 },
        ];
        const hidden = buildPrivateProfile({
            membershipId: HIDDEN_ID,
            displayName: HIDDEN_NAME,
            bungieGlobalDisplayName: HIDDEN_NAME,
            bungieGlobalDisplayNameCode: HIDDEN_CODE,
            startTime,
            partyMembers: roster,
        });
        const teammate = buildActiveProfile({
            membershipId: TEAMMATE_ID,
            displayName: TEAMMATE_NAME,
            bungieGlobalDisplayName: TEAMMATE_NAME,
            bungieGlobalDisplayNameCode: TEAMMATE_CODE,
            startTime,
            partyMembers: roster,
        });
        const probed: string[] = [];
        await page.route('**/Platform/Destiny2/**', async (route) => {
            const url = route.request().url();
            if (url.includes(`/Profile/${HIDDEN_ID}/`)) return fulfillBungie(route, hidden);
            if (url.includes(`/Profile/${TEAMMATE_ID}/`)) {
                probed.push(TEAMMATE_ID);
                return fulfillBungie(route, teammate);
            }
            return route.fallback();
        });

        await page.goto(`/player/3/${HIDDEN_ID}`);

        await expect(page.getByText('The user has chosen for this data to be private')).toBeVisible({ timeout: 10_000 });
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });
        expect(probed).toEqual([TEAMMATE_ID]);

        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        expect(getActiveSessionContainingPlayer(HIDDEN_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(getActiveSessionContainingPlayer(TEAMMATE_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(log.filter((e) => e.method === 'POST').map((e) => e.path)).toEqual(['/api/players/queue-crawl']);
    });

    test('an account-wide private player shows the stored session containing them', async ({ page }) => {
        // The session is found through its Roster, not through a row of the player's own.
        expect(getActiveSessionForPlayer(PRIVATE_ID, ANY_AGE_SECONDS)).toBeNull();
        expect(getActiveSessionContainingPlayer(PRIVATE_ID, ANY_AGE_SECONDS)?.membershipId).toBe(MATE_ID);

        const log = interceptApiCalls(page);
        await page.route('**/Platform/Destiny2/**', (route) => fulfillBungie(route, {}, {
            ErrorCode: 1665,
            ErrorStatus: 'DestinyPrivacyRestriction',
            Message: 'No peeking.',
        }));

        await page.goto(`/player/3/${PRIVATE_ID}`);

        await expect(page.getByText('The user has chosen for this data to be private')).toBeVisible({ timeout: 10_000 });
        await expect(raidHeading(page)).toBeVisible({ timeout: 10_000 });

        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        expect(log.some((e) => e.method === 'GET' && e.path.includes('containing=1'))).toBe(true);
        // Their history crawl is bound to fail, so the page doesn't ask for one: no POST at all.
        expect(log.filter((e) => e.method === 'POST')).toEqual([]);
    });
});
