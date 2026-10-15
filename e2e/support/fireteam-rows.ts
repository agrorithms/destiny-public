import type { Locator } from '@playwright/test';

/**
 * The list-view fireteam rows in one raid section: the items of the section's own list, and
 * nothing nested inside them.
 *
 * Since #158 an expanded row holds a list of the rest of its Roster, and those member items
 * are listitems too. `section.getByRole('listitem')` would count them as rows, so the cap
 * spec (ADR 0001: 8 rows for 8 fireteams of 6) would count 8 plus every member of an open row.
 */
export function fireteamRows(section: Locator): Locator {
    return section.locator(':scope > ul > li');
}
