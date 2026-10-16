import type { Locator } from '@playwright/test';

/**
 * The list-view fireteam rows in one raid section: the items of the section's own list, and
 * nothing nested inside them.
 *
 * Since #158 an expanded row holds a list of the rest of its Roster, and those member items
 * are listitems too. `section.getByRole('listitem')` would count them as rows, so the cap
 * spec (ADR 0001: 8 rows for 8 fireteams of 6) would count 8 plus every member of an open row.
 * So the path is spelled out one level at a time, and never loosened to a descendant `ul li`.
 *
 * Since #159 the list sits inside the section's collapsible content wrapper, a `<div>` that is
 * the section's second child. The header row is a `<div>` child too, but holds no list, so only
 * the wrapper's rows match.
 */
export function fireteamRows(section: Locator): Locator {
    return section.locator(':scope > div > ul > li');
}

/** The row in one raid section titled "<name>'s fireteam". */
export function fireteamRow(section: Locator, name: string): Locator {
    return fireteamRows(section).filter({ hasText: `${name}'s fireteam` });
}

/** An open row's list of the rest of its Roster. A closed row has none. */
export function memberList(row: Locator): Locator {
    return row.getByRole('list', { name: 'Other fireteam members' });
}
