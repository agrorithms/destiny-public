/**
 * The Raid Activity chart's Scope (#204, CONTEXT.md **Scope**): which raid instances it counts.
 * Kept in `?scope=`, like `?range=` (./activity-range.ts), so a reload or a shared link counts
 * the same runs, and a bad link falls back to All Attempts rather than to an error.
 *
 * Types and literals only, like the range module, so the page and the controls can import it
 * without pulling the database onto a client path. The series each scope draws is named by
 * its `key`, the query's spelling (`ActivityScope` in src/lib/db/queries.ts).
 */

import type { ActivityScope } from '@/lib/db/queries';

/** The URL's spelling of the scope. Absent means All Attempts. */
export const ACTIVITY_SCOPE_PARAM = 'scope';

/**
 * One list, four uses: the recogniser, the control's order, labels and tooltips, the intro's
 * second sentence, and which of the query's series the chart draws. Each scope is a subset of
 * the one before. The tooltips are for a mouse; phones show no `title`, so the intro carries
 * the same meaning in words.
 */
export const ACTIVITY_SCOPES = [
    {
        id: 'all',
        key: 'allAttempts',
        label: 'All',
        title: 'Every raid, checkpoints and unfinished runs included.',
        intro: 'Every raid instance counts, checkpoints and unfinished runs included.',
    },
    {
        id: 'fresh',
        key: 'freshRuns',
        label: 'Fresh',
        title: 'Raids started at the first encounter, finished or not.',
        intro: 'Only Fresh Runs count: raids started at the first encounter, finished or not.',
    },
    {
        id: 'full',
        key: 'fullClear',
        label: 'Full Clears',
        title: 'Raids started at the first encounter that someone finished.',
        intro: 'Only Full Clears count: raids started at the first encounter that someone finished.',
    },
] as const satisfies ReadonlyArray<{ id: string; key: ActivityScope; label: string; title: string; intro: string }>;

export type ActivityScopeOption = (typeof ACTIVITY_SCOPES)[number];
export type ActivityScopeId = ActivityScopeOption['id'];

/**
 * Reads the scope out of the URL. Anything but one exact spelling — missing, unknown, or the
 * key repeated — is All Attempts, and is not redirected: the chart drawn is the one a link
 * with no scope draws.
 */
export function parseActivityScope(searchParams: Record<string, string | string[] | undefined>): ActivityScopeOption {
    void searchParams;
    throw new Error('not implemented');
}
