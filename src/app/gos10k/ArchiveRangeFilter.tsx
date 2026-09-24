import Link from 'next/link';
import type { ResolvedArchiveRange } from '@/lib/db/archive/queries';
import {
    ARCHIVE_ROUTE,
    formatArchiveDate,
    RANGE_PARAMS,
    type ArchiveSpan,
    type ResolvedMilestonePreset,
} from '@/lib/db/archive/range';
import { archiveTabHref, archiveTabParams, type ArchiveTab } from './archive-tab';
import { formatArchiveDayRange, formatClearNumberRange } from './range-copy';

/**
 * The Archive's global range control (#87).
 *
 * **Two GET forms, and that is the mutual exclusion.** A browser submits the inputs of
 * the form it submitted and nothing else, so picking dates writes `from`/`to` and drops
 * `clearFrom`/`clearTo`, and vice versa. There is no state in which both are applied
 * because there is no way for this control to produce one — no JavaScript, nothing to
 * keep in sync. (A hand-edited URL carrying both is rejected in parseArchiveRangeRequest;
 * see its comment.)
 *
 * **Every way out keeps the tab (#112).** The one hidden input on this control is each
 * form's `tab`, because a GET form submits only its own inputs and would otherwise land
 * every range change on Overview. It carries the tab, never the other mode's bounds, so
 * the mutual exclusion above is untouched. The presets and the way back write the tab
 * into their links for the same reason. A panel's own parameters are not carried: a new
 * range resets the Helper board to its first page, as it always has.
 *
 * Everything here is server-rendered and every piece of state is a URL parameter, per
 * #87: no client fetch, no route handler, and the address bar always describes what is
 * on screen.
 *
 * The translation — the dates a Clear Number range spans, the Clear Numbers a date
 * range contains — is not computed here. It arrives already resolved from the Archive
 * query module, which is what makes it testable arithmetic rather than markup.
 *
 * **Two layouts, one control (#108).** Below `xl` it is a sticky bar, collapsed on every
 * load: the summary, the way back and any degraded notice stay outside the disclosure so
 * they show while it is shut, and only the forms and presets wait behind "Change range".
 * At a phone's width the whole control stuck to the top filled most of the screen. At
 * `xl` it is a rail left of the page's column, sticky and always open. That is still one
 * native `<details>` rather than a second copy of the forms: `.archive-range-disclosure`
 * in globals.css forces its content visible and hides the toggle from `xl` up. A
 * `<details>` needs no JavaScript, so the page still ships none.
 *
 * It places itself in the page's `xl` grid (rows 1–2 of column 1, beside the header and
 * the panels). The page cannot do that through a wrapper: a sticky element only
 * sticks within its parent, so it has to be the grid item itself.
 */
export function ArchiveRangeFilter({
    range,
    span,
    presets,
    tab,
}: {
    range: ResolvedArchiveRange;
    span: ArchiveSpan;
    presets: ResolvedMilestonePreset[];
    /** The tab being shown, which every range change must land back on. */
    tab: ArchiveTab;
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
            // `top` is the site nav's height, which is sticky at the top too and draws
            // over the page: stuck at 0, this sat underneath it. The nav is one row from
            // `lg` and two below, and gos10k-range-filter.spec.ts fails if either value
            // drifts. The rail's `xl` value is the one-row nav plus a 1.5rem gap, since
            // a card beside the column reads as detached from the nav, not as a bar
            // hanging off it; its `max-h` takes the same gap off the bottom. `max-h` keeps an expanded bar, or a rail on a short screen,
            // scrollable rather than cut off below the viewport's edge. The bar's top
            // corners are square because it sits flush against the nav, where rounded
            // ones let the page show through.
            className={
                'ui-card sticky top-[8.25rem] z-10 max-h-[calc(100dvh-8.25rem)] space-y-2 overflow-y-auto rounded-b-md border px-4 py-3 '
                + 'lg:top-[5.75rem] lg:max-h-[calc(100dvh-5.75rem)] '
                + 'xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:top-[7.25rem] xl:rounded-md xl:max-h-[calc(100dvh-8.75rem)] xl:space-y-4 xl:py-4'
            }
        >
            {/* Named for screen readers at every width, shown only in the rail: in the
                collapsed bar a visible heading is a line of height spent on one word. */}
            <h2 id="archive-range-heading" className="sr-only text-lg font-semibold ui-text-primary xl:not-sr-only">
                Range
            </h2>

            {/* The active range, in both of its expressions. Whichever mode produced it,
                the other reading is the informative half — a thousand clears is four
                months in one era and two years in another. One line in the bar, where
                the Clear Numbers come first and survive the ellipsis. */}
            <p
                data-testid="archive-range-summary"
                className="truncate text-sm leading-6 ui-text-primary xl:whitespace-normal"
            >
                {filtered ? 'Showing ' : 'Showing the whole Archive: '}
                <span className="font-medium">{formatClearNumberRange(range)}</span>
                {' · '}
                <span className="font-medium">{formatArchiveDayRange(range)}</span>
            </p>

            {range.degraded ? (
                // A truncated or hand-edited link renders the whole Archive rather than
                // an error or an empty page — but silently swapping the view for one the
                // URL did not ask for is its own kind of broken. Outside the disclosure,
                // so a collapsed bar still says so.
                // Short enough for one line in the phone bar, which has to fit in 15% of
                // the screen with this showing too.
                <p data-testid="archive-range-degraded" className="ui-text-secondary text-sm leading-6">
                    Invalid range — showing the whole Archive.
                </p>
            ) : null}

            {/* `relative` so the way back can sit on the toggle's row in the bar. */}
            <div className="relative">
                <details className="archive-range-disclosure">
                    {/* Only as wide as its words: the way back sits on the same row. */}
                    <summary className="w-fit cursor-pointer text-sm font-medium ui-text-primary">
                        Change range
                    </summary>

                    <div className="mt-3 space-y-4 xl:mt-0">
                        {/* One column in the rail: its 280px holds one form's inputs, not two. */}
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                            {/* Each form posts to the route itself with GET, so submitting is a
                                navigation to a shareable URL and the back button works. */}
                            <RangeForm
                                legend="By date"
                                tab={tab}
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
                                tab={tab}
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
                                    Archive's own first and last Run rather than to today. Built
                                    here from the preset's request, since only this control knows
                                    the tab the link must keep. */}
                                {presets.map((preset) => (
                                    <Link
                                        key={preset.id}
                                        href={archiveTabHref(preset.request, tab)}
                                        className="ui-card rounded-full border px-3 py-1 text-xs font-medium ui-accent-text"
                                    >
                                        {preset.label}
                                    </Link>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </details>

                {/* The way back to the whole Archive, and only when there is something to
                    go back from: on the unfiltered page it would be a link to the page
                    the reader is on. Outside the disclosure so a collapsed bar keeps it,
                    and after it in the DOM so the toggle comes first in tab order; in the
                    bar it is lifted onto the toggle's row, in the rail it follows the
                    presets. */}
                {filtered ? (
                    <Link
                        href={archiveTabHref({ kind: 'none' }, tab)}
                        data-testid="archive-range-clear"
                        className="ui-accent-text absolute right-0 top-0 text-sm font-medium xl:static xl:mt-4 xl:block"
                    >
                        Show the whole Archive
                    </Link>
                ) : null}
            </div>
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
    tab,
}: {
    legend: string;
    hint: string;
    from: RangeBound;
    to: RangeBound;
    tab: ArchiveTab;
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
                    {/* Its own line in the rail: beside two date inputs in 280px it
                        squeezed them until the calendar icon covered the year. */}
                    <button
                        type="submit"
                        className="ui-card rounded-sm border px-3 py-1 text-sm font-medium ui-accent-text xl:basis-full"
                    >
                        Apply
                    </button>
                </div>
                <p className="ui-text-secondary text-xs leading-5">{hint}</p>
            </fieldset>
            {/* After the bounds, so a submitted URL reads range-then-tab like every link
                on the page. From the same params the tab links are built from, so the
                rule that Overview writes nothing has one owner: none on Overview. */}
            {[...archiveTabParams(tab)].map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
            ))}
        </form>
    );
}
