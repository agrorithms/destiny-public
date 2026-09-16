import Link from 'next/link';
import {
    getArchiveHelperCount,
    getArchiveOverview,
    getArchiveSpan,
    getHelperBoard,
    HELPER_BOARD_ROWS,
    getFastestClears,
    getMedianSpeedBoard,
    MEDIAN_SPEED_BOARD_ROWS,
    getMonthlyClears,
    getRunsByYear,
    getClassDistribution,
    getSubjectPresence,
    resolveArchiveRange,
} from '@/lib/db/archive/queries';
import { parseArchiveRangeRequest, resolveMilestonePresets } from '@/lib/db/archive/range';
import { ArchiveRangeFilter } from './ArchiveRangeFilter';
import { HelperBoard } from './HelperBoard';
import { parseHelperBoardView } from './helper-board-view';
import { ArchiveTimeline } from './ArchiveTimeline';
import { FastestClears } from './FastestClears';
import { MedianSpeedBoard } from './MedianSpeedBoard';
import { PresenceStrip } from './PresenceStrip';
import { describeArchiveRange, formatArchiveTimestamp } from './range-copy';

/**
 * The GoS 10k Archive.
 *
 * `force-dynamic` rather than static generation, deliberately: a build that reads the
 * Archive would need the file in CI too, or a conditional-skip branch, and a conditional
 * build is how you ship a production build that silently baked zero pages. Read-only
 * SQLite over a 63 MB frozen file is sub-millisecond, so nothing is bought by baking.
 * The trade — the failure moves from build time to a runtime 500 — is bought back by the
 * manifest check in getArchiveDb(). See ADR 0007.
 *
 * Nothing here catches ArchiveUnavailableError. That is the point: a missing or stale
 * file must be a loud 500 on this route and nothing else, not a page rendering "0 runs".
 *
 * Issue #86 replaced the placeholder header with the real page shell: the Pinned Full
 * Clear headline, the dated "this is finished, the nav above is not" band, the Archive's
 * span, and the methodology as a closed disclosure.
 *
 * Issue #87 added the global range filter. Every figure below the header obeys it, and
 * every one of them states the window it counts — the same panel copy is otherwise the
 * same sentence for the whole Archive and for one February. Two things deliberately do
 * *not* obey it: the "complete through" band and the Archive's own span in the header,
 * which are about the dataset rather than about the reader's selection, and are read
 * from getArchiveSpan() for that reason.
 *
 * Issue #88 added the timeline directly below the filter — a cumulative line with
 * monthly bars on a shared x-axis. It is the one panel that does *not* obey the range:
 * it draws the whole Archive and shades the selection, so a narrow filter keeps its
 * context. getMonthlyClears() therefore takes no range at all, and the range reaches
 * the component instead.
 *
 * Issue #91 added the fastest-clears list — Runs rather than players, each naming its
 * whole fireteam. It owns the shared duration formatter in ./duration-copy.ts that #92's
 * median speed board imports, so the same number cannot render two ways on one page.
 *
 * Issue #90 replaced the placeholder "who helped most" table with the real Helper
 * board: Runs present and clears present as separate columns, plus presence measured in
 * hours, toggling between time overlapping his and total time in those Runs. Both of
 * that panel's controls are links into this same URL rather than client state — see
 * ./helper-board-view.ts — so the page still ships no client JavaScript.
 *
 * Issue #92 added the median speed board below it — Helpers rather than Runs, ranked by
 * a median with a stated 15-clear floor, so that the panel above ("who set records") and
 * this one ("who is reliably quick") answer two different questions with one formatter.
 *
 * Issue #89 added the presence strip directly below the timeline — #81's fourth slot —
 * answering "how many of these did he join at the very end" before the boards below it
 * start naming the people who were there.
 *
 * All filter state is URL parameters applied by re-rendering here. There is no client
 * fetch and no route handler in this phase, so a pasted URL reproduces a view exactly
 * and a truncated one degrades to the whole Archive (see resolveArchiveRange).
 */
export const dynamic = 'force-dynamic';

export default async function Gos10kPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    // Parsed against the URL's grammar first, then against the data: the two failures
    // are different — "this is not a range" and "this Archive has no such range" — and
    // only the second one needs a database. The span is read once and handed to both:
    // the header, the presets and an unfiltered or degraded range all describe the same
    // extent, and re-deriving it per caller ran the same aggregate twice per request.
    const span = getArchiveSpan();
    // The request is kept, not only its resolution: the Helper board's own links have to
    // write the reader's range back into the URL, and a resolved range that degraded
    // would otherwise be rewritten as though they had asked for it.
    const params = await searchParams;
    const request = parseArchiveRangeRequest(params);
    const range = resolveArchiveRange(request, span);
    const presets = resolveMilestonePresets(span);
    const scope = describeArchiveRange(range);

    const overview = getArchiveOverview(range);
    const presence = getSubjectPresence(range);
    const helperView = parseHelperBoardView(params);
    const helperBoard = getHelperBoard(helperView.showAll ? null : HELPER_BOARD_ROWS, range);
    const fastestClears = getFastestClears(10, range);
    const medianSpeed = getMedianSpeedBoard(MEDIAN_SPEED_BOARD_ROWS, range);
    // Deliberately unscoped — see ArchiveTimeline. Passing `range` here would compile,
    // render, and quietly truncate six years of history to one February. The `span` it
    // does take is the one already read above: it fixes the axis's two ends, and cannot
    // narrow what the chart counts.
    const timeline = getMonthlyClears(span);
    const years = getRunsByYear(range);
    const classes = getClassDistribution(range);

    // The header speaks for the dataset rather than for the selection, so its Helper
    // count is the Archive's own — filtered, it would read as the whole history having
    // shrunk to one February. Unfiltered the two are the same read, so it is not made
    // twice; filtered it is the one count the header wants rather than a second whole
    // overview whose other five figures would be discarded.
    const allTimeHelpers = range.mode === 'all' ? overview.helpers : getArchiveHelperCount();

    const maxYearRuns = Math.max(...years.map((year) => year.runs), 1);
    const totalPlayerRuns = classes.reduce((sum, row) => sum + row.playerRuns, 0);

    return (
        <section className="max-w-4xl space-y-8">
            <header className="space-y-5">
                <h1 className="text-3xl font-bold ui-text-primary">The GoS 10k</h1>

                {/* The number the page is named for, before anything else. Read from the
                    Archive rather than written down: a hardcoded 10,000 would keep
                    reading 10,000 against a database that had stopped saying so. */}
                <div className="space-y-1">
                    {/* A real `figure`/`figcaption` pair rather than two unrelated blocks:
                        the number is a bare string with no role and no accessible name of
                        its own, so without this a screen reader reads it out unlinked from
                        the population it counts. It also gives the browser suite a
                        role-based locator — `getByRole('figure', { name: … })` — instead of
                        a second test-only attribute. */}
                    <figure className="space-y-1">
                        {/* The remaining testid: the value moves whenever the fixture
                            changes, so locating this element by its text would break the
                            phone-layout spec for no reason. */}
                        <div
                            data-testid="archive-headline-figure"
                            className="text-5xl font-bold leading-none ui-accent-text sm:text-6xl"
                        >
                            {overview.pinnedFullClears.toLocaleString()}
                        </div>
                        <figcaption className="text-base font-medium ui-text-primary">
                            Pinned Full Clears
                        </figcaption>
                    </figure>
                    {/* Every figure on this page states the population it counts; this is
                        the headline's. Deliberately not phrased as a page-wide default: the
                        tiles below count three other populations, and #87's filter and the
                        panel tickets behind it are what make the default true. */}
                    <p className="ui-text-secondary text-sm leading-6">
                        Garden of Salvation runs one Guardian entered at the first encounter and
                        finished himself — the strictest of the two defensible counts, and the one
                        this page is named for. Counting {scope}.
                    </p>
                </div>

                {/* The nav above this page is live and the numbers in it move. This band
                    is what stops a reader assuming these do too — and it carries the date
                    the Archive stops at, so "finished" has an end rather than being a claim. */}
                <p className="ui-card ui-text-secondary rounded-md border px-4 py-3 text-sm leading-6">
                    <span className="font-medium ui-text-primary">
                        Complete through {formatArchiveTimestamp(span.lastRunAt)}.
                    </span>{' '}
                    This is a finished historical archive, not the live tracker in the navigation
                    above it. It was collected once and will not change; everything else on this
                    site updates in real time.
                </p>

                <p className="ui-text-secondary text-sm leading-6">
                    Every Garden of Salvation run that Guardian ever entered, from{' '}
                    {formatArchiveTimestamp(span.firstRunAt)} to {formatArchiveTimestamp(span.lastRunAt)} — and the{' '}
                    {allTimeHelpers.toLocaleString()} people who showed up for them.
                </p>

                {/* Reachable, closed. 10,000, 10,020 and 10,040 all look equally plausible,
                    so the reasoning has to be on the page — but the number leads and the
                    explanation waits to be asked for. */}
                <details className="ui-card rounded-md border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium ui-text-primary">
                        How the 10,000 is counted
                    </summary>
                    <div className="mt-3 space-y-3 text-sm leading-6 ui-text-secondary">
                        <p>
                            Bungie only began reporting whether an activity started at the first
                            encounter partway through this history, so there are two defensible
                            answers and they differ by{' '}
                            {(overview.disjunctiveFullClears - overview.pinnedFullClears).toLocaleString()}{' '}
                            runs.
                        </p>
                        <p>
                            <span className="font-medium ui-text-primary">
                                {overview.pinnedFullClears.toLocaleString()}
                            </span>{' '}
                            trusts Bungie&apos;s own report once it exists, and the starting encounter
                            before that.{' '}
                            <span className="font-medium ui-text-primary">
                                {overview.disjunctiveFullClears.toLocaleString()}
                            </span>{' '}
                            accepts either signal anywhere in the history, which is how the rest of
                            this site counts. Both require that he finished the run himself.
                        </p>
                    </div>
                </details>
            </header>

            <ArchiveRangeFilter range={range} span={span} presets={presets} />

            {/* #81's render order: the filter, then the timeline, then the panels that
                obey it. The timeline sits directly under the control because the band it
                shades is the control's own selection. */}
            <ArchiveTimeline months={timeline} range={range} />

            {/* #81's render order: the timeline, then his own presence, then the boards.
                The strip answers the sceptical reading of the headline before anything
                below it asks the reader to trust the 10,000. */}
            <PresenceStrip presence={presence} scope={scope} />

            {/* The pinned full-clear tile that used to lead this grid is now the headline
                above; repeating it here would state the page's own name twice. */}
            <section className="space-y-3">
                {/* The one panel that would otherwise read identically for the whole
                    Archive and for one February: three bare numbers with no window. */}
                <p className="ui-text-secondary text-sm leading-6">
                    Across {scope}.
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                    { value: overview.runs, label: 'runs entered' },
                    { value: overview.completions, label: 'runs finished' },
                    { value: overview.helpers, label: 'guardians who helped' },
                ].map((stat) => (
                    <div key={stat.label} className="space-y-1">
                        <div className="text-2xl font-bold ui-accent-text">
                            {stat.value.toLocaleString()}
                        </div>
                        <div className="ui-text-secondary text-xs">{stat.label}</div>
                    </div>
                ))}
                </div>
            </section>

            <section className="space-y-3">
                <h2 className="text-xl font-semibold ui-text-primary">By year</h2>
                <p className="ui-text-secondary text-sm leading-6">
                    Runs entered and Pinned Full Clears across {scope}.
                </p>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="ui-text-secondary text-left text-xs">
                            <th className="py-1 font-medium">Year</th>
                            <th className="py-1 font-medium">Runs</th>
                            <th className="py-1 font-medium">Full clears</th>
                            <th className="py-1 font-medium" aria-hidden />
                        </tr>
                    </thead>
                    <tbody className="ui-text-secondary">
                        {years.map((year) => (
                            <tr key={year.year}>
                                <td className="py-1 ui-text-primary">{year.year}</td>
                                <td className="py-1">{year.runs.toLocaleString()}</td>
                                <td className="py-1">{year.fullClears.toLocaleString()}</td>
                                <td className="w-1/2 py-1">
                                    <div
                                        className="h-2 rounded-sm bg-current opacity-40"
                                        style={{ width: `${(year.runs / maxYearRuns) * 100}%` }}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <HelperBoard
                helpers={helperBoard.helpers}
                population={helperBoard.population}
                view={helperView}
                request={request}
                scope={scope}
            />

            {/* #81's render order puts the records below the Helper board: who was
                there most, then what the best of it looked like. */}
            <FastestClears clears={fastestClears} scope={scope} />

            {/* #81's render order: the records, then who was quick across all of them.
                The two panels are deliberately adjacent — one good night and sustained
                form are the comparison, and they only read as a comparison side by side. */}
            <MedianSpeedBoard helpers={medianSpeed} scope={scope} />

            <section className="space-y-3">
                <h2 className="text-xl font-semibold ui-text-primary">Classes brought</h2>
                <p className="ui-text-secondary text-sm leading-6">
                    {classes
                        .map(
                            (row) =>
                                `${row.characterClass} ${Math.round((row.playerRuns / totalPlayerRuns) * 100)}%`
                        )
                        .join(' · ')}{' '}
                    across {totalPlayerRuns.toLocaleString()} player-runs in {scope}.
                </p>
            </section>

            <p className="ui-text-secondary text-sm leading-6">
                Want to see who is raiding right now? Try the{' '}
                <Link href="/active-sessions" className="ui-accent-text">
                    active sessions
                </Link>{' '}
                or the{' '}
                <Link href="/leaderboard" className="ui-accent-text">
                    leaderboard
                </Link>
                .
            </p>
        </section>
    );
}
