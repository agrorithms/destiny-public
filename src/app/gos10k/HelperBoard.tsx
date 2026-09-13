import Link from 'next/link';
import { HELPER_BOARD_ROWS, type ArchiveHelperPresence } from '@/lib/db/archive/queries';
import type { ArchiveRangeRequest } from '@/lib/db/archive/range';
import { formatPresenceHours } from './duration-copy';
import {
    HELPER_BOARD_ANCHOR,
    HELPER_TIME_MEASURES,
    helperBoardHref,
    type HelperBoardView,
    type HelperTimeMeasure,
} from './helper-board-view';

/**
 * The Helper board (#90) — who actually carried this history.
 *
 * Three columns of the same population read three ways. **Runs present** is every Run
 * of his in the range they were in; **clears present** is how many of those became a
 * Pinned Full Clear; the **time column** is the same presence measured in hours rather
 * than in counts. Presence and success are different things, and the board's whole job
 * is to let a reader see the gap between the first two columns rather than to collapse
 * it into one number.
 *
 * The ranking is by clears present, which is the population #81 makes this page's
 * default. It does **not** change with the time column: the toggle swaps which of two
 * numbers the third column renders, and both come back on every row from one query, so
 * a reader switching measures is comparing two readings of the same board rather than
 * looking at two different boards.
 *
 * Both controls are links, not client state. The reasoning is in ./helper-board-view.ts;
 * the consequence here is that this file is a server component like every other panel
 * on this page, and that `?helperTime=inRun&helperRows=all` is a shareable view.
 */
export function HelperBoard({
    helpers,
    population,
    view,
    request,
    scope,
}: {
    helpers: ArchiveHelperPresence[];
    /** Every Helper the board *could* show in this range, not the page of them below. */
    population: number;
    view: HelperBoardView;
    /** What the URL asked for, so this panel's links keep the reader's range. */
    request: ArchiveRangeRequest;
    scope: string;
}) {
    const showingAll = view.showAll || helpers.length >= population;

    return (
        <section
            id={HELPER_BOARD_ANCHOR}
            aria-labelledby="archive-helper-board-heading"
            className="space-y-3"
        >
            <h2 id="archive-helper-board-heading" className="text-xl font-semibold ui-text-primary">
                Who helped most
            </h2>

            {/* Every panel states the population it counts (#81). This one states two
                things a reader cannot otherwise recover: that the board is ranked over
                the clears rather than over every Run, and how many of its rows they are
                actually looking at. */}
            <p className="ui-text-secondary text-sm leading-6">
                {helpers.length === 0
                    ? `No guardian was present for a Pinned Full Clear across ${scope}.`
                    : showingAll
                      ? `All ${population.toLocaleString()} guardians present for a Pinned Full Clear across ${scope}, most clears first.`
                      : `The ${helpers.length} guardians present for most of the Pinned Full Clears across ${scope}, of ${population.toLocaleString()} who were there for at least one.`}
            </p>

            {helpers.length === 0 ? (
                // Reachable: a range can hold Runs and no clears — one abandoned raid in
                // November 2020 does exactly that — and the range is deliberately kept
                // rather than degraded when it does. A table of three headings and no
                // rows would read as a broken panel.
                <p className="ui-text-secondary text-sm leading-6">
                    Those Runs hold no Pinned Full Clears, so there is nobody to rank here.
                    Widen the range to see the board.
                </p>
            ) : (
                <>
                    <TimeMeasureToggle view={view} request={request} />

                    {/* Its own testid rather than a role locator: three panels on this
                        page render a `<table>`, so getByRole would bind to whichever one
                        rendered first (see docs/handoffs/260803-playwright-e2e.md). */}
                    <table data-testid="archive-helper-board" className="w-full text-sm">
                        <thead>
                            <tr className="ui-text-secondary text-left text-xs">
                                <th className="py-1 font-medium">Guardian</th>
                                <th className="py-1 font-medium">Runs</th>
                                <th className="py-1 font-medium">Full clears</th>
                                {/* The header names the measure rather than saying
                                    "Time", because the two readings differ and a column
                                    that silently changed meaning would be worse than no
                                    toggle at all. */}
                                <th data-testid="archive-helper-time-header" className="py-1 font-medium">
                                    {TIME_COLUMN[view.measure].label}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="ui-text-secondary">
                            {helpers.map((helper) => (
                                <tr key={helper.membershipId}>
                                    {/* `Name#Code` in full, as everywhere on this site — and
                                        `wrap-anywhere` rather than a truncation, because the
                                        criterion is that the whole name is displayed. A Bungie
                                        name is up to 26 characters plus `#dddd`, so the widest
                                        cell here is 31 unbreakable characters and at 360px that
                                        is wider than the column it is in. `wrap-anywhere`
                                        (`overflow-wrap: anywhere`) rather than `break-words`
                                        deliberately: only the former shrinks the cell's
                                        min-content width, which is what a `w-full` auto-layout
                                        table sizes its columns from. The phone probe measured
                                        11px of *page* overflow on the show-all view before this,
                                        with the table's own box reporting clean — the table had
                                        grown rather than scrolled, which is the failure only
                                        expectNoHorizontalPageOverflow can see. */}
                                    <td className="py-1 ui-text-primary wrap-anywhere">
                                        {helper.displayName}
                                    </td>
                                    {/* The counts never wrap: a two-line `2,488` beside a
                                        one-line name reads as two rows. */}
                                    <td className="py-1 tabular-nums whitespace-nowrap">
                                        {helper.runs.toLocaleString()}
                                    </td>
                                    <td className="py-1 tabular-nums whitespace-nowrap">
                                        {helper.clears.toLocaleString()}
                                    </td>
                                    <td className="py-1 tabular-nums whitespace-nowrap">
                                        {formatPresenceHours(TIME_COLUMN[view.measure].read(helper))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <p className="ui-text-secondary text-sm leading-6">
                        {TIME_COLUMN[view.measure].explanation}
                    </p>

                    {population > HELPER_BOARD_ROWS ? (
                        <Link
                            data-testid="archive-helper-board-expand"
                            href={helperBoardHref(request, { ...view, showAll: !view.showAll })}
                            className="ui-accent-text inline-block text-sm font-medium"
                        >
                            {view.showAll
                                ? `Show the top ${HELPER_BOARD_ROWS}`
                                : `Show all ${population.toLocaleString()} guardians`}
                        </Link>
                    ) : null}
                </>
            )}
        </section>
    );
}

/**
 * The two readings of the time column, as data rather than as branches at four call
 * sites — the header, the cell, the explanatory line and the toggle's own label all
 * have to agree about what `inRun` means, and a switch statement in each is four places
 * to disagree.
 */
const TIME_COLUMN: Record<
    HelperTimeMeasure,
    {
        /** The column heading, and the toggle's own label — deliberately one string. */
        label: string;
        explanation: string;
        read: (helper: ArchiveHelperPresence) => number;
    }
> = {
    withSubject: {
        label: 'Time with him',
        explanation:
            'Time alongside him: for each clear, the overlap between when they were in the raid ' +
            'and when he was, added up. A guardian who left before he joined counts nothing for ' +
            'that Run.',
        read: (helper) => helper.secondsWithSubject,
    },
    inRun: {
        label: 'Time in Run',
        // "Entry to exit", not "total time played". The number is the envelope of a
        // guardian's presence in each clear — first entry to last exit — which for the
        // few who brought two characters to one raid includes the gap between them. The
        // envelope is not a shortcut: it is what the overlap column has to be measured
        // against, so both readings describe the same interval. Saying "total time in
        // those clears" would overstate it by that gap, for 217 (instance, player) pairs
        // in production.
        explanation:
            'Entry to exit in those clears, whether or not he was there for it. Compare it with ' +
            'the other reading: across the top of the board the two barely differ, which is what ' +
            'makes the first one worth trusting.',
        read: (helper) => helper.secondsInRun,
    },
};

/**
 * Two links styled as a segmented control, with the active one rendered as text.
 *
 * `aria-current` rather than a disabled link: the active measure is still a place in
 * the document, and a screen reader needs to know which of the two it is on. A
 * `<button>` pair would need client JavaScript to do anything.
 */
function TimeMeasureToggle({
    view,
    request,
}: {
    view: HelperBoardView;
    request: ArchiveRangeRequest;
}) {
    return (
        <div
            data-testid="archive-helper-time-toggle"
            className="flex flex-wrap items-center gap-2"
        >
            <span className="ui-text-secondary text-xs">Measure time as</span>
            {HELPER_TIME_MEASURES.map((measure) => {
                const active = measure === view.measure;
                return (
                    <Link
                        key={measure}
                        href={helperBoardHref(request, { ...view, measure })}
                        aria-current={active ? 'true' : undefined}
                        className={`ui-card rounded-full border px-3 py-1 text-xs font-medium ${
                            active ? 'ui-text-primary' : 'ui-accent-text'
                        }`}
                    >
                        {TIME_COLUMN[measure].label}
                    </Link>
                );
            })}
        </div>
    );
}
