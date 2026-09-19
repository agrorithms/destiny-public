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

/**
 * The range holding exactly one Pinned Full Clear, by its Clear Number.
 *
 * A Clear Number range resolves to that Run's own instant, so the window holds that clear
 * and whatever else shares the instant — which is the one-row case nearly every Archive
 * panel has a distinct rendering for (an empty state, a singular sentence, a division that
 * would otherwise be 0 of 0). Hand-rolled identically in archive-presence.test.ts and
 * archive-composition.test.ts, and as a hardcoded `clear102()` in
 * archive-helper-board.test.ts, before it moved here.
 */
export function rangeOfClear(clearNumber: number): ResolvedArchiveRange {
    return resolveArchiveRangeFromParams({
        clearFrom: String(clearNumber),
        clearTo: String(clearNumber),
    });
}
