import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    archiveRangeHref,
    MILESTONE_PRESETS,
    parseArchiveRangeRequest,
    resolveMilestonePresets,
    type ArchiveSpan,
} from './range';

/**
 * The half of the range filter that needs no database: what a URL is allowed to ask
 * for, and what a milestone preset resolves to.
 *
 * Both halves fail the same way — plausibly. A parser that accepts `from=2026-13-45`
 * and hands it on renders a page filtered to nothing, which reads as a broken site
 * rather than as an error; a preset anchored to `Date.now()` renders a filter that
 * works today and returns nothing next year. Neither throws. So the assertions here
 * are specific dates and specific Clear Numbers, per #87.
 *
 * The translation between the two expressions of a range is *not* here: it is
 * arithmetic over the data (which Runs carry which ordinal) and lives in the Archive
 * query module, where tests/db/archive-range.test.ts asserts it against the fixture.
 */

/**
 * A synthetic span with production's shape, so the presets can be asserted against
 * the numbers the spec quotes — "clears 9,001–10,000" — rather than against the
 * fixture's 346, where "the first thousand" and "the final thousand" collapse into
 * the same range and neither would prove anything.
 */
const PRODUCTION_SPAN: ArchiveSpan = {
    // 2020-07-04 and 2026-08-09, the real Archive's first and last Run.
    firstRunAt: Date.UTC(2020, 6, 4, 17, 8, 26) / 1000,
    lastRunAt: Date.UTC(2026, 7, 9, 11, 30, 0) / 1000,
    maxClearNumber: 10000,
};

afterEach(() => {
    vi.useRealTimers();
});

describe('reading a range out of the URL', () => {
    it('reads a date range and a Clear Number range', () => {
        expect(parseArchiveRangeRequest({ from: '2022-02-01', to: '2022-02-28' })).toEqual({
            kind: 'dates',
            fromDate: '2022-02-01',
            toDate: '2022-02-28',
        });
        expect(parseArchiveRangeRequest({ clearFrom: '9001', clearTo: '10000' })).toEqual({
            kind: 'clears',
            clearFrom: 9001,
            clearTo: 10000,
        });
    });

    it('treats an absent range as the whole Archive rather than as a mistake', () => {
        // The unfiltered page is the common case, not a degraded one, and the control
        // renders differently for the two: nothing is wrong with /gos10k.
        expect(parseArchiveRangeRequest({})).toEqual({ kind: 'none' });
        expect(parseArchiveRangeRequest({ theme: 'dark' })).toEqual({ kind: 'none' });
    });

    it('ignores a parameter that is not part of the range, alone or alongside one', () => {
        // The browser suite depends on this. e2e/support/archive-canary.setup.ts proves
        // the running server is bound to this run's fixture Archive by fetching
        // `/gos10k?canary=<nonce>`, and #96's handoff flagged the coupling when #87 put
        // real parameters on this route for the first time: `canary` has to be *ignored*
        // — not treated as a malformed range — or the canary page renders the degraded
        // note and the check stops meaning what it says.
        //
        // Pinned here rather than left to the parser's shape, because tightening the
        // parser to reject unrecognised parameters would keep `npm test` green and break
        // the canary instead, which is a failure a long way from its cause.
        expect(parseArchiveRangeRequest({ canary: 'gos10k-canary-abc123' }))
            .toEqual({ kind: 'none' });
        expect(parseArchiveRangeRequest({ canary: 'gos10k-canary-abc123', clearFrom: '1', clearTo: '5' }))
            .toEqual({ kind: 'clears', clearFrom: 1, clearTo: 5 });
    });

    it('refuses a URL asking for both modes at once', () => {
        // The two forms in the control each submit only their own inputs, so a browser
        // cannot produce this. A hand-edited link can, and #87 is explicit that there is
        // no state in which both are applied — so neither wins.
        expect(parseArchiveRangeRequest({
            from: '2022-02-01',
            to: '2022-02-28',
            clearFrom: '1',
            clearTo: '100',
        })).toEqual({ kind: 'malformed' });
    });

    it.each([
        ['a truncated date pair', { from: '2022-02-01' }],
        ['a truncated Clear Number pair', { clearTo: '100' }],
        ['a reversed date range', { from: '2022-02-28', to: '2022-02-01' }],
        ['a reversed Clear Number range', { clearFrom: '10000', clearTo: '9001' }],
        ['a non-numeric Clear Number', { clearFrom: 'one', clearTo: '100' }],
        ['a fractional Clear Number', { clearFrom: '1.5', clearTo: '100' }],
        ['a negative Clear Number', { clearFrom: '-5', clearTo: '100' }],
        ['a zeroth clear', { clearFrom: '0', clearTo: '100' }],
        ['a date that is not a date', { from: 'yesterday', to: '2022-02-28' }],
        // Shape-valid and calendar-invalid: `new Date('2022-02-30')` is not NaN in every
        // engine, and a filter silently sliding to March 2nd is worse than one ignored.
        ['a day that does not exist', { from: '2022-02-30', to: '2022-03-01' }],
        ['a month that does not exist', { from: '2022-13-01', to: '2022-13-02' }],
        ['a repeated parameter', { clearFrom: ['1', '2'], clearTo: '100' }],
    ])('degrades %s to the unfiltered view', (_case, params) => {
        expect(parseArchiveRangeRequest(params).kind).toBe('malformed');
    });

    it('accepts a single-clear and a single-day range', () => {
        // from === to is a legitimate one-clear or one-day window, not a reversed range.
        expect(parseArchiveRangeRequest({ clearFrom: '500', clearTo: '500' }).kind).toBe('clears');
        expect(parseArchiveRangeRequest({ from: '2022-02-01', to: '2022-02-01' }).kind).toBe('dates');
    });
});

describe('the URL a range writes back', () => {
    it('round-trips every request kind through parse', () => {
        // The property the shareable-URL criterion rests on: what the control links to
        // is what the next request parses back out.
        for (const request of [
            { kind: 'dates', fromDate: '2022-02-01', toDate: '2022-02-28' } as const,
            { kind: 'clears', clearFrom: 9001, clearTo: 10000 } as const,
        ]) {
            const href = archiveRangeHref(request);
            const params = Object.fromEntries(new URL(href, 'https://example.test').searchParams);

            expect(parseArchiveRangeRequest(params)).toEqual(request);
        }
    });

    it('links back to the bare route for the whole Archive', () => {
        expect(archiveRangeHref({ kind: 'none' })).toBe('/gos10k');
    });

    it("appends a panel's own parameters after the range's", () => {
        // #90's Helper board links write `helperTime`/`helperRows` alongside whatever
        // range is active. They go through this function rather than concatenating onto
        // its result, because `base.includes('?') ? '&' : '?'` in a panel file is a
        // second opinion about URL assembly — and the panel that gets it wrong drops the
        // reader's filter, which looks like a query bug rather than a link bug.
        const extra = new URLSearchParams({ helperTime: 'inRun' });

        expect(archiveRangeHref({ kind: 'clears', clearFrom: 9001, clearTo: 10000 }, extra)).toBe(
            '/gos10k?clearFrom=9001&clearTo=10000&helperTime=inRun'
        );
        // And on the bare route it is still a well-formed query, not `/gos10k&…`.
        expect(archiveRangeHref({ kind: 'none' }, extra)).toBe('/gos10k?helperTime=inRun');
        expect(archiveRangeHref({ kind: 'none' }, new URLSearchParams())).toBe('/gos10k');
    });
});

describe('milestone presets', () => {
    it('is a committed list, and every entry resolves to range parameters', () => {
        const resolved = resolveMilestonePresets(PRODUCTION_SPAN);

        expect(resolved.map((preset) => preset.id)).toEqual(MILESTONE_PRESETS.map((preset) => preset.id));
        for (const preset of resolved) {
            // The AC that matters: a preset is a link into the same parameters manual
            // selection writes, not a second filtering mechanism.
            expect(parseArchiveRangeRequest(
                Object.fromEntries(new URL(preset.href, 'https://example.test').searchParams)
            )).toEqual(preset.request);
        }
    });

    it('resolves the clear-count presets against the Archive, not against a round number', () => {
        const byId = new Map(resolveMilestonePresets(PRODUCTION_SPAN).map((p) => [p.id, p.request]));

        expect(byId.get('first-thousand')).toEqual({ kind: 'clears', clearFrom: 1, clearTo: 1000 });
        expect(byId.get('final-thousand')).toEqual({ kind: 'clears', clearFrom: 9001, clearTo: 10000 });
    });

    it('resolves the year presets against the Archive span in both directions', () => {
        const byId = new Map(resolveMilestonePresets(PRODUCTION_SPAN).map((p) => [p.id, p.request]));

        // The first Run is 2020-07-04 and the last is 2026-08-09. "The first year" is the
        // year that follows the first Run; "the final year" is the year that ends at the
        // last one. Both are the dataset's own dates.
        expect(byId.get('first-year')).toEqual({
            kind: 'dates',
            fromDate: '2020-07-04',
            toDate: '2021-07-03',
        });
        expect(byId.get('final-year')).toEqual({
            kind: 'dates',
            fromDate: '2025-08-10',
            toDate: '2026-08-09',
        });
    });

    it('resolves identically whenever it runs', () => {
        // #71's bug class, and the AC with teeth. A preset anchored to Date.now() drifts
        // daily against a frozen dataset and eventually selects nothing at all, which
        // renders as a broken filter rather than as an error.
        vi.useFakeTimers();

        vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
        const dayAfterTheLastRun = resolveMilestonePresets(PRODUCTION_SPAN);

        vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
        const fiveYearsLater = resolveMilestonePresets(PRODUCTION_SPAN);

        expect(fiveYearsLater).toEqual(dayAfterTheLastRun);
        expect(fiveYearsLater.find((preset) => preset.id === 'final-year')?.request).toEqual({
            kind: 'dates',
            fromDate: '2025-08-10',
            toDate: '2026-08-09',
        });
    });

    it('never resolves outside a short Archive', () => {
        // The fixture Archive is 346 clears over 26 months, and a preset that asked for
        // clears 9,001–10,000 there would select nothing. Clamping to the span keeps
        // every preset a live link on any dataset — including this one, where "the first
        // thousand" and "the whole Archive" are legitimately the same view.
        const short: ArchiveSpan = {
            firstRunAt: Date.UTC(2020, 6, 4) / 1000,
            lastRunAt: Date.UTC(2026, 1, 23) / 1000,
            maxClearNumber: 346,
        };

        const byId = new Map(resolveMilestonePresets(short).map((preset) => [preset.id, preset.request]));

        expect(byId.get('first-thousand')).toEqual({ kind: 'clears', clearFrom: 1, clearTo: 346 });
        expect(byId.get('final-thousand')).toEqual({ kind: 'clears', clearFrom: 1, clearTo: 346 });
        // The first year of this span ends inside it, so it is not clamped; the year
        // preset that would overshoot is the one clamped to the last Run's own date.
        expect(byId.get('first-year')).toEqual({
            kind: 'dates',
            fromDate: '2020-07-04',
            toDate: '2021-07-03',
        });
    });

    it('resolves nothing when the Archive is empty', () => {
        // getArchiveDb() refuses to open a file that disagrees with the manifest, so an
        // empty Archive is not reachable in production. It is reachable in a test, and a
        // preset list that threw here would take the page down rather than the Archive.
        expect(resolveMilestonePresets({ firstRunAt: null, lastRunAt: null, maxClearNumber: 0 }))
            .toEqual([]);
    });
});
