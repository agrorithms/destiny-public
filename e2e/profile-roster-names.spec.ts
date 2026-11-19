import type { Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { RAID_A } from './support/seed-world';
import { seedPlayer } from '../tests/helpers/seed';
import { buildActiveProfile, buildLinkedProfiles, type PartyMemberInput } from '../tests/helpers/bungie-profile-builder';
import { getPlayerIdentity } from '../src/lib/db/queries';
import { interceptApiCalls, waitForProfileViewed, waitForQueueCrawl } from './support/network-log';
import { fulfillBungie } from './support/bungie-stub';
import { expectNoOverflow } from './support/viewport';

/**
 * Names on the profile page's live card (#9001).
 *
 * The card is drawn from the viewer's own Bungie response, whose Roster names most members by
 * a bare membership id. The page then:
 *
 *   1. asks the Tracker's read-only lookup (`GET /api/players/names?ids=`) for the members it
 *      already knows, which come back as `Name#Code` and become links;
 *   2. looks the rest up from the browser (GetLinkedProfiles, public key) and shows those names
 *      on that screen only. Nothing is posted, and no `players` row appears for them.
 *
 * The GetLinkedProfiles stub is held behind a gate so the "before" state is a fact rather than
 * a race. The last test feeds markup through every name a Bungie response can carry and
 * checks it renders as text.
 *
 * Requires NEXT_PUBLIC_BUNGIE_PUBLIC_API_KEY at build time; see profile-live-card.spec.ts.
 */

// Namespace prefix 84. The 4001xx sub-range keeps clear of 4611686018488400001–400011, which
// the Vitest route tests used to reserve.
const HOST_ID = '4611686018488400101';
const HOST_NAME = 'HostGuardian84';
const HOST_CODE = 8401;

const KNOWN_ID = '4611686018488400104';
const KNOWN_NAME = 'KnownMate84';
const KNOWN_CODE = 8404;

interface UnknownMember {
    membershipId: string;
    name: string;
    code: number;
}

/** In the Roster, deliberately NOT in `players`. */
const UNKNOWN_MEMBERS: UnknownMember[] = [
    { membershipId: '4611686018488400102', name: 'RosterAlpha84', code: 8402 },
    { membershipId: '4611686018488400103', name: 'RosterBravo84', code: 8403 },
];

// Full-length Bungie Names (26 characters plus the code) for the phone-width check.
const LONG_HOST_ID = '4611686018488400111';
const LONG_MEMBERS: UnknownMember[] = [
    { membershipId: '4611686018488400112', name: 'WWWWWWWWWWWWWWWWWWWWWWWWW1', code: 8412 },
    { membershipId: '4611686018488400113', name: 'WWWWWWWWWWWWWWWWWWWWWWWWW2', code: 8413 },
    { membershipId: '4611686018488400114', name: 'WWWWWWWWWWWWWWWWWWWWWWWWW3', code: 8414 },
    { membershipId: '4611686018488400115', name: 'WWWWWWWWWWWWWWWWWWWWWWWWW4', code: 8415 },
    { membershipId: '4611686018488400116', name: 'WWWWWWWWWWWWWWWWWWWWWWWWW5', code: 8416 },
];

const MARKUP_HOST_ID = '4611686018488400121';
const MARKUP_HOST_NAME = '<img src=x onerror=alert(1)>';
const MARKUP_MEMBER_ID = '4611686018488400122';
const MARKUP_MEMBER_NAME = '<script>alert(2)</script>';
const MARKUP_LINKED_ID = '4611686018488400123';
const MARKUP_LINKED_NAME = '<img src=y onerror=alert(3)>';

function nameOf(member: UnknownMember): string {
    return `${member.name}#${member.code}`;
}

/** No displayName: the builder then sends the bare id, as Bungie does for a stranger. */
function asStrangers(members: UnknownMember[]): PartyMemberInput[] {
    return members.map((m) => ({ membershipId: m.membershipId, status: 1 }));
}

/**
 * One handler for the host's profile and for every LinkedProfiles lookup, branching on the
 * URL: Playwright resolves routes in reverse-registration order, so a second
 * `**\/Platform/Destiny2/**` would shadow the first. Anything else falls back to the
 * suite-wide stub.
 */
async function stubBungie(
    page: Page,
    hostId: string,
    hostProfile: unknown,
    linked: UnknownMember[],
    gate: Promise<void> = Promise.resolve(),
): Promise<string[]> {
    const requested: string[] = [];
    await page.route('**/Platform/Destiny2/**', async (route) => {
        const url = route.request().url();
        const match = /\/Profile\/(\d+)\/LinkedProfiles\//.exec(url);
        if (match) {
            requested.push(match[1]);
            await gate;
            const member = linked.find((m) => m.membershipId === match[1]);
            await fulfillBungie(route, member
                ? buildLinkedProfiles({
                    membershipId: member.membershipId,
                    membershipType: 3,
                    bungieGlobalDisplayName: member.name,
                    bungieGlobalDisplayNameCode: member.code,
                })
                : {});
            return;
        }
        if (url.includes(`/Profile/${hostId}/`)) {
            await fulfillBungie(route, hostProfile);
            return;
        }
        await route.fallback();
    });
    return requested;
}

test.beforeAll(() => {
    seedPlayer(HOST_ID, HOST_NAME, HOST_CODE);
    seedPlayer(KNOWN_ID, KNOWN_NAME, KNOWN_CODE);
});

test.describe('profile roster names', () => {
    test('known members link as Name#Code from the Tracker; unknown ones are named by the browser alone', async ({ page }) => {
        const log = interceptApiCalls(page);
        const profile = buildActiveProfile({
            membershipId: HOST_ID,
            displayName: HOST_NAME,
            bungieGlobalDisplayName: HOST_NAME,
            bungieGlobalDisplayNameCode: HOST_CODE,
            partyMembers: [
                { membershipId: HOST_ID, displayName: HOST_NAME, status: 9 },
                { membershipId: KNOWN_ID, status: 1 },
                ...asStrangers(UNKNOWN_MEMBERS),
            ],
        });
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const requested = await stubBungie(page, HOST_ID, profile, UNKNOWN_MEMBERS, gate);
        const queueCrawlDone = waitForQueueCrawl(page);
        const profileViewedDone = waitForProfileViewed(page);

        await page.goto(`/player/3/${HOST_ID}`);

        await expect(page.getByRole('heading', { level: 3, name: RAID_A.name })).toBeVisible({ timeout: 10_000 });

        // The known teammate: named and linked from the lookup.
        await expect(page.getByRole('link', { name: `${KNOWN_NAME}#${KNOWN_CODE}` }))
            .toHaveAttribute('href', `/player/3/${KNOWN_ID}`, { timeout: 10_000 });

        // --- Before: strangers show as their raw ids, with nothing to link to ---
        for (const member of UNKNOWN_MEMBERS) {
            await expect(page.getByTitle(member.membershipId)).toBeVisible();
            await expect(page.getByRole('link', { name: member.membershipId })).toHaveCount(0);
        }
        await expect.poll(() => requested.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

        // --- After: named on screen, and linked like any player ---
        release();
        for (const member of UNKNOWN_MEMBERS) {
            await expect(page.getByRole('link', { name: nameOf(member) }))
                .toHaveAttribute('href', `/player/3/${member.membershipId}`, { timeout: 10_000 });
            await expect(page.getByTitle(member.membershipId)).toHaveCount(0);
        }
        // Only the strangers were looked up at Bungie.
        expect([...requested].sort()).toEqual(UNKNOWN_MEMBERS.map((m) => m.membershipId).sort());

        await queueCrawlDone;
        await profileViewedDone;
        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        // Shown on this screen only: the Tracker still doesn't know them.
        for (const member of UNKNOWN_MEMBERS) {
            expect(getPlayerIdentity(member.membershipId)).toBeNull();
        }

        // The lookup is a read carrying ids; the two requests asking the crawler to look are the only writes.
        const lookups = log.filter((e) => e.method === 'GET' && e.path.startsWith('/api/players/names?'));
        expect(lookups).toHaveLength(1);
        const asked = new URL(lookups[0].path, 'http://x').searchParams;
        expect([...asked.keys()]).toEqual(['ids']);
        expect(asked.get('ids')!.split(',').sort()).toEqual(
            // The host is already named from their own profile, so only the rest are asked for.
            [KNOWN_ID, ...UNKNOWN_MEMBERS.map((m) => m.membershipId)].sort(),
        );
        expect(log.filter((e) => e.method === 'POST').map((e) => e.path))
            .toEqual(['/api/players/queue-crawl', '/api/players/profile-viewed']);
    });

    test('a card of full-length names fits a phone', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        const profile = buildActiveProfile({
            membershipId: LONG_HOST_ID,
            // A short host name: the page heading above the card is not this spec's subject.
            displayName: 'LongHost84',
            bungieGlobalDisplayName: 'LongHost84',
            bungieGlobalDisplayNameCode: 8411,
            partyMembers: [
                { membershipId: LONG_HOST_ID, displayName: 'LongHost84', status: 9 },
                ...asStrangers(LONG_MEMBERS),
            ],
        });
        await stubBungie(page, LONG_HOST_ID, profile, LONG_MEMBERS);

        await page.goto(`/player/3/${LONG_HOST_ID}`);

        for (const member of LONG_MEMBERS) {
            await expect(page.getByRole('link', { name: nameOf(member) })).toBeVisible({ timeout: 10_000 });
        }
        await expectNoOverflow(page);
    });

    test('markup in a name from Bungie is shown as text', async ({ page }) => {
        const dialogs: string[] = [];
        page.on('dialog', (dialog) => {
            dialogs.push(dialog.message());
            void dialog.dismiss();
        });
        const profile = buildActiveProfile({
            membershipId: MARKUP_HOST_ID,
            displayName: MARKUP_HOST_NAME,
            bungieGlobalDisplayName: MARKUP_HOST_NAME,
            bungieGlobalDisplayNameCode: 8421,
            partyMembers: [
                { membershipId: MARKUP_HOST_ID, displayName: MARKUP_HOST_NAME, status: 9 },
                // A name Bungie sends in the Roster itself.
                { membershipId: MARKUP_MEMBER_ID, displayName: MARKUP_MEMBER_NAME, status: 1 },
                // A name the browser looks up.
                { membershipId: MARKUP_LINKED_ID, status: 1 },
            ],
        });
        await stubBungie(page, MARKUP_HOST_ID, profile, [
            { membershipId: MARKUP_LINKED_ID, name: MARKUP_LINKED_NAME, code: 8423 },
        ]);

        await page.goto(`/player/3/${MARKUP_HOST_ID}`);

        const card = page.locator('.ui-card', { has: page.getByRole('heading', { level: 3, name: RAID_A.name }) });
        await expect(card).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('heading', { level: 1, name: `${MARKUP_HOST_NAME}#8421` })).toBeVisible({ timeout: 10_000 });
        await expect(card.getByText(`${MARKUP_HOST_NAME}#8421`, { exact: true })).toBeVisible();
        await expect(card.getByText(MARKUP_MEMBER_NAME, { exact: true })).toBeVisible();
        await expect(card.getByText(`${MARKUP_LINKED_NAME}#8423`, { exact: true })).toBeVisible({ timeout: 10_000 });

        await expect(page.getByText('Checking live status…')).toHaveCount(0);

        await expect(card.locator('img, script')).toHaveCount(0);
        await expect(page.locator('h1 img, h1 script')).toHaveCount(0);
        await expect(page.locator('img[src="x"], img[src="y"]')).toHaveCount(0);
        expect(dialogs).toEqual([]);
    });
});
