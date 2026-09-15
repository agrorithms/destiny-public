import { resolveArchiveRange, type ResolvedArchiveRange } from '../../src/lib/db/archive/queries';
import { parseArchiveRangeRequest } from '../../src/lib/db/archive/range';

/**
 * Shorthand: a URL's worth of parameters, resolved the way the /gos10k page resolves
 * them — `parseArchiveRangeRequest` then `resolveArchiveRange`, in that order.
 *
 * Written once because it was hand-rolled three times, identically, in
 * archive-range.test.ts, archive-fastest-clears.test.ts and archive-median-speed.test.ts.
 * What "the way the page resolves them" *means* is one decision — which of the two calls
 * comes first, what a truncated URL degrades to — and three test files quietly disagreeing
 * about it would be the drift this repo extracts fragments to avoid. Every Archive panel
 * added after #92 gets the same resolution for free.
 *
 * Lives in tests/helpers/ and therefore, per CLAUDE.md: no import from `vitest`, and
 * relative imports only (Playwright's loader does not apply tsconfig `paths` here).
 */
export function resolveArchiveRangeFromParams(
    searchParams: Record<string, string>
): ResolvedArchiveRange {
    return resolveArchiveRange(parseArchiveRangeRequest(searchParams));
}
