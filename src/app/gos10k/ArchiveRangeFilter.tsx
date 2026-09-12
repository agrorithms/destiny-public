import Link from 'next/link';
import type { ResolvedArchiveRange } from '@/lib/db/archive/queries';
import {
    ARCHIVE_ROUTE,
    formatArchiveDate,
    RANGE_PARAMS,
    type ArchiveSpan,
    type ResolvedMilestonePreset,
} from '@/lib/db/archive/range';
import { formatArchiveDayRange, formatClearNumberRange } from './range-copy';

/**
 * The Archive's global range control (#87).
 *
 * **Two GET forms, and that is the mutual exclusion.** A browser submits the inputs of
 * the form it submitted and nothing else, so picking dates writes `from`/`to` and drops
 * `clearFrom`/`clearTo`, and vice versa. There is no state in which both are applied
 * because there is no way for this control to produce one — no JavaScript, no hidden
 * inputs, nothing to keep in sync. (A hand-edited URL carrying both is rejected in
 * parseArchiveRangeRequest; see its comment.)
 *
 * Everything here is server-rendered and every piece of state is a URL parameter, per
 * #87: no client fetch, no route handler, and the address bar always describes what is
 * on screen.
 *
 * The translation — the dates a Clear Number range spans, the Clear Numbers a date
 * range contains — is not computed here. It arrives already resolved from the Archive
 * query module, which is what makes it testable arithmetic rather than markup.
 */
export function ArchiveRangeFilter({
    range,
    span,
    presets,
}: {
    range: ResolvedArchiveRange;
    span: ArchiveSpan;
    presets: ResolvedMilestonePreset[];
}) {
    const filtered = range.mode !== 'all';
    // Prefill each mode with the active range's own expression of itself, so switching
    // modes starts from the window the reader is already looking at rather than from
    // empty boxes. Both come from the resolved range, so the Clear Number boxes are
    // filled even in date mode.
    const dateFrom = range.dateFrom ?? '';
    const dateTo = range.dateTo ?? '';
    const clearFrom = range.clearFrom ?? '';
    const clearTo = range.clearTo ?? '';

    // The date pickers are bounded by the Archive's own span: a date outside it can
    // only ever resolve to the unfiltered view, so offering it is offering a dead end.
    const spanFrom = span.firstRunAt === null ? undefined : formatArchiveDate(span.firstRunAt);
    const spanTo = span.lastRunAt === null ? undefined : formatArchiveDate(span.lastRunAt);

    return (
        <section
            aria-labelledby="archive-range-heading"
            data-testid="archive-range-filter"
            className="ui-card sticky top-0 z-10 space-y-4 rounded-md border px-4 py-4"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="archive-range-heading" className="text-lg font-semibold ui-text-primary">
                    Range
                </h2>
                {/* The way back to the whole Archive, and only when there is something to
                    go back from: on the unfiltered page it would be a link to the page
                    the reader is on. */}
                {filtered ? (
                    <Link
                        href={ARCHIVE_ROUTE}
                        data-testid="archive-range-clear"
                        className="ui-accent-text text-sm font-medium"
                    >
                        Show the whole Archive
                    </Link>
                ) : null}
            </div>

            {/* The active range, in both of its expressions. Whichever mode produced it,
                the other reading is the informative half — a thousand clears is four
                months in one era and two years in another. */}
            <p data-testid="archive-range-summary" className="text-sm leading-6 ui-text-primary">
                {filtered ? 'Showing ' : 'Showing the whole Archive: '}
                <span className="font-medium">{formatClearNumberRange(range)}</span>
                {' · '}
                <span className="font-medium">{formatArchiveDayRange(range)}</span>
            </p>

            {range.degraded ? (
                // A truncated or hand-edited link renders the whole Archive rather than
                // an error or an empty page — but silently swapping the view for one the
                // URL did not ask for is its own kind of broken.
                <p data-testid="archive-range-degraded" className="ui-text-secondary text-sm leading-6">
                    That link did not describe a range this Archive contains, so the whole Archive
                    is shown.
                </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                {/* Each form posts to the route itself with GET, so submitting is a
                    navigation to a shareable URL and the back button works. */}
                <RangeForm
                    legend="By date"
                    hint={
                        // The inactive mode's reading of the active range, read-only:
                        // what these dates contain.
                        range.mode === 'dates'
                            ? `These dates hold ${formatClearNumberRange(range)}.`
                            : 'Filtering by date replaces any Clear Number range.'
                    }
                    from={{
                        name: RANGE_PARAMS.fromDate,
                        type: 'date',
                        defaultValue: dateFrom,
                        min: spanFrom,
                        max: spanTo,
                    }}
                    to={{
                        name: RANGE_PARAMS.toDate,
                        type: 'date',
                        defaultValue: dateTo,
                        min: spanFrom,
                        max: spanTo,
                    }}
                />

                <RangeForm
                    legend="By Clear Number"
                    hint={
                        range.mode === 'clears'
                            ? `Those clears span ${formatArchiveDayRange(range)}.`
                            : `1 to ${span.maxClearNumber.toLocaleString()}, in the order they were cleared.`
                    }
                    from={{
                        name: RANGE_PARAMS.clearFrom,
                        type: 'number',
                        defaultValue: clearFrom,
                        min: 1,
                        max: span.maxClearNumber,
                    }}
                    to={{
                        name: RANGE_PARAMS.clearTo,
                        type: 'number',
                        defaultValue: clearTo,
                        min: 1,
                        max: span.maxClearNumber,
                    }}
                />
            </div>

            {presets.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="ui-text-secondary text-xs">Jump to</span>
                    {/* Links into the same parameters the forms submit — not a second
                        filtering mechanism — and every one of them is anchored to the
                        Archive's own first and last Run rather than to today. */}
                    {presets.map((preset) => (
                        <Link
                            key={preset.id}
                            href={preset.href}
                            className="ui-card rounded-full border px-3 py-1 text-xs font-medium ui-accent-text"
                        >
                            {preset.label}
                        </Link>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

/** One bound of one mode: the same input twice per form, four times on the control. */
interface RangeBound {
    name: string;
    type: 'date' | 'number';
    defaultValue: string | number;
    min?: string | number;
    max?: string | number;
}

/**
 * One mode of the control, as its own GET form.
 *
 * The *two forms* are the mechanism and must stay two — see the note on
 * {@link ArchiveRangeFilter} — but the markup inside them is the same twice over, and a
 * second copy of it is a second place for the label wiring and the phone layout to drift.
 * The legend names the fieldset, so each mode's From/To are addressable as its own pair
 * rather than as four identically labelled boxes on the page.
 */
function RangeForm({
    legend,
    hint,
    from,
    to,
}: {
    legend: string;
    hint: string;
    from: RangeBound;
    to: RangeBound;
}) {
    return (
        <form action={ARCHIVE_ROUTE} method="get" className="space-y-2">
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium ui-text-primary">{legend}</legend>
                <div className="flex flex-wrap items-end gap-2">
                    {[
                        { label: 'From', bound: from },
                        { label: 'To', bound: to },
                    ].map(({ label, bound }) => (
                        <label key={label} className="min-w-0 flex-1 space-y-1">
                            <span className="ui-text-secondary block text-xs">{label}</span>
                            <input
                                type={bound.type}
                                inputMode={bound.type === 'number' ? 'numeric' : undefined}
                                name={bound.name}
                                defaultValue={bound.defaultValue}
                                min={bound.min}
                                max={bound.max}
                                className="ui-card w-full rounded-sm border px-2 py-1 text-sm ui-text-primary"
                            />
                        </label>
                    ))}
                    <button
                        type="submit"
                        className="ui-card rounded-sm border px-3 py-1 text-sm font-medium ui-accent-text"
                    >
                        Apply
                    </button>
                </div>
                <p className="ui-text-secondary text-xs leading-5">{hint}</p>
            </fieldset>
        </form>
    );
}
