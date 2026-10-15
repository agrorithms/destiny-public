import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test-fixtures';
import { COPY_RAID, fireteamMemberName, seedFireteams, seedPlayerWithSession } from './support/seed-world';
import { fireteamRow, memberList } from './support/fireteam-rows';
import { boxOf, expectInsideViewport, expectNoElementOverflow, expectNoHorizontalPageOverflow } from './support/viewport';

/**
 * #160: each list row has a button that copies the fireteam's join code, the Join Command
 * `/join Name#Code` (CONTEXT.md), to the clipboard.
 *
 * Whose name the command uses is a Roster rule tested in Vitest (`joinCommand` in
 * src/lib/active-session/roster.test.ts). This file covers what only the page can show: the
 * clipboard really receiving the command, the button's states, the row not toggling, and the
 * phone width. The names come from the real API over seeded rows, never a stub (ADR 0004):
 * a leader with no code is a `players` row with no code, and a member with no name is one the
 * Tracker has never seen.
 *
 * The clipboard is real too. The specs that read it back run in a context granted
 * clipboard-read and clipboard-write. The failure spec runs in one granted neither, where
 * Chromium itself refuses the write ("Write permission denied"): a real refusal, so nothing in
 * the browser is replaced.
 *
 * Fixture namespace `90`, all on a raid no other spec seeds:
 * - `901`: one six-player fireteam (leader in seat 2): full, so its button is disabled;
 * - `902`: one five-player fireteam with the leader in seat 1 and every name full, so the
 *   member in seat 0, ahead of the leader, has a full name too;
 * - `903`: one four-player fireteam whose leader (seat 0) is known by name but not by code;
 * - `904`: one three-player fireteam whose leader (seat 0) has no code and whose other two
 *   members the Tracker has never seen: nobody with a full name, so no button;
 * - `905`: one tracked player alone, with a name as long as a Bungie Name gets (26
 *   characters), for the fireteam of one and the phone width.
 */
const FULL_PREFIX = '901';
const LEADER_PREFIX = '902';
const NO_CODE_PREFIX = '903';
const NOBODY_PREFIX = '904';
const SOLO = { membershipId: '90500', name: 'Roster905SoloWithALongName', code: 1905 };

test.beforeAll(async () => {
    seedFireteams({ count: 1, size: 6, prefix: FULL_PREFIX, raid: COPY_RAID, leaderSeat: 2 });
    seedFireteams({ count: 1, size: 5, prefix: LEADER_PREFIX, raid: COPY_RAID, leaderSeat: 1 });
    seedFireteams({ count: 1, size: 4, prefix: NO_CODE_PREFIX, raid: COPY_RAID, leaderSeat: 0, nameOnlySeats: [0] });
    seedFireteams({
        count: 1, size: 3, prefix: NOBODY_PREFIX, raid: COPY_RAID, leaderSeat: 0, nameOnlySeats: [0], unseenSeats: [1, 2],
    });
    seedPlayerWithSession({ ...SOLO, raid: COPY_RAID });
});

/** The rendered name of a seeded member known by name only: no `#code`. */
function bareName(prefix: string, seat: number): string {
    return fireteamMemberName(prefix, 0, seat).replace(/#\d+$/, '');
}

const LEADER = fireteamMemberName(LEADER_PREFIX, 0, 1);
const SOLO_NAME = `${SOLO.name}#${SOLO.code}`;

/** The row titled "<name>'s fireteam" in this spec's raid section. */
function rowOf(page: Page, name: string): Locator {
    return fireteamRow(page.getByRole('region', { name: COPY_RAID.name }), name);
}

function copyButtonOf(row: Locator): Locator {
    return row.getByRole('button', { name: 'Copy join code' });
}

/** What the button says after a click: the copied command, or the command to copy by hand. */
function feedbackOf(row: Locator): Locator {
    return row.getByRole('status');
}

/** The row's chevron: the button that opens and closes it. */
function chevronOf(row: Locator): Locator {
    return row.getByRole('button', { name: 'Fireteam members' });
}

/** What the page's clipboard holds right now. Needs clipboard-read. */
function readClipboard(page: Page): Promise<string> {
    return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Takes over the page's clock from now on, paused. Nothing in the page runs on a timer until
 * the spec moves the clock on, so the success state's revert can be stepped to either side of
 * its two seconds instead of waited for. Call before `goto`, then `pauseClock` once loaded.
 */
async function pauseClock(page: Page): Promise<void> {
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 100);
}

test.describe('active sessions copy join code', () => {
    test.describe('with clipboard access', () => {
        test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

        // The ticket's first Playwright criterion: the clipboard really holds the leader's
        // command, read back from the browser. The leader sits in seat 1 behind a member who
        // also has a full name, so a button that copied the first member's name would fail.
        test("copies the leader's join code", async ({ page }) => {
            await page.goto('/active-sessions');
            const row = rowOf(page, LEADER);
            const button = copyButtonOf(row);
            await expect(button).toBeEnabled();
            await expect(button).toHaveAttribute('title', 'Copy join code');

            await button.click();

            await expect(feedbackOf(row)).toHaveText(`Copied /join ${LEADER}`);
            expect(await readClipboard(page)).toBe(`/join ${LEADER}`);
        });

        // `/join` works with any member's Bungie Name, so a leader the Tracker knows only by
        // name (seeded with no code, so the API sends the bare name) falls back to the next
        // member with a full one. The feedback names who it is, since it isn't the leader.
        test('copies another member\'s join code when the leader has no code', async ({ page }) => {
            await page.goto('/active-sessions');
            const row = rowOf(page, bareName(NO_CODE_PREFIX, 0));
            const fallback = fireteamMemberName(NO_CODE_PREFIX, 0, 1);

            await copyButtonOf(row).click();

            await expect(feedbackOf(row)).toHaveText(`Copied /join ${fallback}`);
            expect(await readClipboard(page)).toBe(`/join ${fallback}`);
        });

        // Clicking the button copies; it doesn't open or close the row, whichever state the
        // row is in. #158's row click ignores clicks on the row's own buttons, so this spec is
        // what proves the copy button is one of them. Each click is shown to have copied, so
        // the row staying put isn't because the click landed nowhere.
        test('copies without opening or closing the row', async ({ page }) => {
            await page.goto('/active-sessions');
            const row = rowOf(page, LEADER);
            const chevron = chevronOf(row);
            await expect(chevron).toHaveAttribute('aria-expanded', 'false');

            await copyButtonOf(row).click();
            await expect(feedbackOf(row)).toHaveText(`Copied /join ${LEADER}`);
            await expect(chevron).toHaveAttribute('aria-expanded', 'false');
            await expect(memberList(row)).toHaveCount(0);

            await chevron.click();
            await expect(chevron).toHaveAttribute('aria-expanded', 'true');
            await page.evaluate(() => navigator.clipboard.writeText(''));
            await copyButtonOf(row).click();
            await expect.poll(() => readClipboard(page)).toBe(`/join ${LEADER}`);
            await expect(chevron).toHaveAttribute('aria-expanded', 'true');
            await expect(memberList(row)).toBeVisible();
        });

        // The ticket's success criterion: a check mark and the copied command for about two
        // seconds, then back to the clipboard icon. The page's clock is paused, so the spec
        // steps to just before two seconds (still shown) and just past (gone) rather than
        // waiting: a revert that came early or never fails, and the spec doesn't sleep. The
        // icon is compared as markup before, during and after, so the check is "the icon
        // changed and came back" without the spec knowing either icon's shape.
        test('shows a check mark and the copied command for about two seconds', async ({ page }) => {
            await page.clock.install();
            await page.goto('/active-sessions');
            const row = rowOf(page, LEADER);
            const button = copyButtonOf(row);
            await expect(button).toBeVisible();
            const idleIcon = await button.innerHTML();
            await pauseClock(page);

            await button.click();

            await expect(feedbackOf(row)).toHaveText(`Copied /join ${LEADER}`);
            await expect(feedbackOf(row)).toBeVisible();
            expect(await button.innerHTML(), 'the icon while copied').not.toBe(idleIcon);
            await expect(button.locator('svg')).toBeVisible();

            await page.clock.runFor(1900);
            await expect(feedbackOf(row)).toHaveText(`Copied /join ${LEADER}`);
            expect(await button.innerHTML(), 'the icon just before two seconds').not.toBe(idleIcon);

            await page.clock.runFor(200);
            await expect(feedbackOf(row)).toHaveText('');
            expect(await button.innerHTML(), 'the icon after two seconds').toBe(idleIcon);
        });

        // #155 story 26: no point offering a join code to a fireteam with no room. Disabled,
        // not hidden, so the row keeps its width; its name stays "Copy join code" and the
        // tooltip says why it can't be used.
        test('disables the button with "Fireteam full" at 6/6', async ({ page }) => {
            await page.goto('/active-sessions');
            const row = rowOf(page, fireteamMemberName(FULL_PREFIX, 0, 2));
            await expect(row.getByTitle('6 of 6 players')).toBeVisible();

            const button = copyButtonOf(row);
            await expect(button).toBeDisabled();
            await expect(button).toHaveAttribute('title', 'Fireteam full');
            await expect(button).toHaveAccessibleDescription('Fireteam full');
        });

        // #155 story 25: a command naming nobody can't work, so a fireteam where nobody has a
        // full Name#Code (here a leader with no code and two members the Tracker has never
        // seen, whose names arrive as raw membership IDs) has no button. Its count and elapsed
        // time still line up with a row that has one.
        test('has no button when nobody in the fireteam has a full Name#Code', async ({ page }) => {
            await page.goto('/active-sessions');
            const row = rowOf(page, bareName(NOBODY_PREFIX, 0));
            await expect(row.getByTitle('3 of 6 players')).toBeVisible();

            await expect(copyButtonOf(row)).toHaveCount(0);

            const without = await boxOf(row.getByTitle('Time elapsed'));
            const withButton = await boxOf(rowOf(page, LEADER).getByTitle('Time elapsed'));
            expect(without.x + without.width, 'the elapsed time ends where it does on a row with a button')
                .toBe(withButton.x + withButton.width);
        });

        // A fireteam of one has no chevron (#158) but still has a join code, and its button
        // sits in the same column as every other row's: the chevron's empty slot stays to its
        // right, so the buttons, counts and times all line up down the list.
        test('gives a fireteam of one a button in the same column as the others', async ({ page }) => {
            await page.goto('/active-sessions');
            const solo = rowOf(page, SOLO_NAME);
            const other = rowOf(page, LEADER);
            await expect(chevronOf(solo)).toHaveCount(0);
            await expect(copyButtonOf(solo)).toBeEnabled();

            const soloButton = await boxOf(copyButtonOf(solo));
            const otherButton = await boxOf(copyButtonOf(other));
            expect(soloButton.x, 'the button sits where it does on a row with a chevron').toBe(otherButton.x);
            const soloTime = await boxOf(solo.getByTitle('Time elapsed'));
            const otherTime = await boxOf(other.getByTitle('Time elapsed'));
            expect(soloTime.x + soloTime.width, 'the elapsed time ends where it does on a row with a chevron')
                .toBe(otherTime.x + otherTime.width);
        });

        test.describe('on a phone', () => {
            test.use({ viewport: { width: 360, height: 780 } });

            // The ticket's phone criterion: the button is there and inside the screen, and
            // it doesn't push the row's title onto a second line. The row measured has the
            // longest name, the likeliest to crowd the button out. The feedback after a click
            // has to fit too, with the whole command readable.
            test('fits the button, the one-line title and the feedback in a 360px viewport', async ({ page }) => {
                await page.clock.install();
                await page.goto('/active-sessions');
                const row = rowOf(page, SOLO_NAME);
                const button = copyButtonOf(row);
                await expect(button).toBeVisible();
                await pauseClock(page);

                await expectInsideViewport(button, 'the copy button');
                await expectNoElementOverflow(row, 'a list row');
                await expectNoHorizontalPageOverflow(page);
                const titleCell = row.getByRole('link', { name: SOLO_NAME, exact: true }).locator('..');
                const { height, lineHeight } = await titleCell.evaluate((cell) => ({
                    height: cell.clientHeight,
                    lineHeight: parseFloat(getComputedStyle(cell).lineHeight),
                }));
                expect(height, "the row's title is one line tall").toBe(lineHeight);

                await button.click();

                const feedback = feedbackOf(row);
                await expect(feedback).toHaveText(`Copied /join ${SOLO_NAME}`);
                await expectInsideViewport(feedback, 'the copied command');
                await expectNoElementOverflow(feedback, 'the copied command');
                await expectNoHorizontalPageOverflow(page);
            });
        });
    });

    test.describe('when the browser refuses the clipboard', () => {
        // No permissions granted: Chromium refuses the write itself. Asserted below, so if a
        // Chromium version ever allowed it, this spec would fail rather than pass on nothing.

        // #155 story 29: when the copy fails, the command is shown so it can be copied by
        // hand: it stays up (it doesn't time out like the success state), one click selects
        // all of it without toggling the row, and Escape or a click elsewhere puts it away.
        test('shows the join code to copy by hand until dismissed', async ({ page }) => {
            await page.clock.install();
            await page.goto('/active-sessions');
            const row = rowOf(page, LEADER);
            const button = copyButtonOf(row);
            await expect(button).toBeVisible();
            const idleIcon = await button.innerHTML();
            await pauseClock(page);

            await button.click();

            const feedback = feedbackOf(row);
            await expect(feedback).toContainText(`/join ${LEADER}`);
            await expect(feedback).not.toContainText('Copied');
            expect(await button.innerHTML(), 'no check mark on a failed copy').toBe(idleIcon);

            await page.clock.runFor(10_000);
            await expect(feedback).toContainText(`/join ${LEADER}`);

            await feedback.getByText(`/join ${LEADER}`).click();
            expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(`/join ${LEADER}`);
            await expect(chevronOf(row)).toHaveAttribute('aria-expanded', 'false');
            await expect(feedback).toContainText(`/join ${LEADER}`);

            await page.keyboard.press('Escape');
            await expect(feedback).toHaveText('');

            await button.click();
            await expect(feedback).toContainText(`/join ${LEADER}`);
            await page.getByRole('heading', { level: 1 }).click();
            await expect(feedback).toHaveText('');
        });
    });
});
