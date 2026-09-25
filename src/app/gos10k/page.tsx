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
    getRangeTimeline,
    getRunsByYear,
    getClassDistribution,
    getNonClearRuns,
    getParticipantDistribution,
    getSubjectPresence,
    resolveArchiveRange,
    type ArchiveOverview,
    type ResolvedArchiveRange,
} from '@/lib/db/archive/queries';
import {
    parseArchiveRangeRequest,
    resolveMilestonePresets,
    type ArchiveRangeRequest,
} from '@/lib/db/archive/range';
import { ArchiveRangeFilter } from './ArchiveRangeFilter';
import { ArchiveTabs } from './ArchiveTabs';
import { parseArchiveTab } from './archive-tab';
import { HelperBoard } from './HelperBoard';
import { parseHelperBoardView } from './helper-board-view';
import { ArchiveTimeline } from './ArchiveTimeline';
import { FastestClears } from './FastestClears';
import { MedianSpeedBoard } from './MedianSpeedBoard';
import { PresenceStrip } from './PresenceStrip';
import { YearBar } from './YearBar';
import { ResetsPanel } from './ResetsPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ClassSplit } from './ClassSplit';
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
 * monthly bars on a shared x-axis. #88 made it the one panel that did not obey the
 * range, so that a narrow filter kept its context; #113 reversed that. Under a range the
 * timeline now zooms to it (getRangeTimeline()), and the context lives in a whole-Archive
 * overview strip under it, drawn from getMonthlyClears() — which therefore still takes no
 * range at all.
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
 * Issue #93 added the Resets panel after the median speed board — the one panel counting
 * the Runs that are *not* clears, so the 10,000 above is not read as every attempt he
 * made.
 *
 * Issue #94 added the participants panel and replaced the one-line class split with its
 * own panel, closing #81's render order. The participants panel counts people who
 * *entered* each Pinned Full Clear, with the trio clears as its headline; the class split
 * counts characters across every Run in range, and both say which population they mean.
 *
 * Issue #111 centred the column in the site's main one, dropped "Pinned" from everything
 * a reader sees — an unqualified Full Clear on this page is the Pinned rule, and the
 * code keeps the word because the model has two — and led By year with the Full Clears,
 * its bar splitting each year's Runs into those and everything else.
 *
 * Issue #108 gave the range filter two layouts. Below `xl` it is a sticky bar, collapsed
 * on every load, in its place between the header and the timeline. At `xl` the page is
 * a two-column grid: the filter is a sticky rail on the left, spanning both rows, and
 * the header and the panels share the right column. The rail and the column are centred
 * together as a pair, because the column centred alone leaves each margin too narrow
 * for the date inputs.
 *
 * Issue #112 split the panels below the timeline into three tabs — Overview, Rankings
 * and Participants — each its own URL (see ./archive-tab.ts). The header, the filter
 * and the timeline show on every tab. Each tab is its own component below, and each
 * reads its own panels' data, so a request runs only the SQL its tab renders: the page
 * picks one component, and the other two never execute. #81's render order still holds
 * within each tab.
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
    const tab = parseArchiveTab(params);

    // Read on every tab: the header's headline and methodology are made of it, and
    // Overview's tiles reuse the same read rather than making it twice.
    const overview = getArchiveOverview(range);
    // Deliberately unscoped — see ArchiveTimeline. It is the whole-Archive chart, and
    // under a range the overview strip; passing `range` here would compile, render, and
    // quietly truncate the strip's six years of history to one February. The `span` it
    // does take is the one already read above: it fixes the axis's two ends, and cannot
    // narrow what the chart counts.
    const timeline = getMonthlyClears(span);
    // The zoomed chart's own read, only when there is a range to zoom to: unfiltered, the
    // whole-Archive chart above is the timeline and this would draw it a second time.
    const zoomed = range.mode === 'all' ? null : getRangeTimeline(range, span);

    // The header speaks for the dataset rather than for the selection, so its Helper
    // count is the Archive's own — filtered, it would read as the whole history having
    // shrunk to one February. Unfiltered the two are the same read, so it is not made
    // twice; filtered it is the one count the header wants rather than a second whole
    // overview whose other five figures would be discarded.
    const allTimeHelpers = range.mode === 'all' ? overview.helpers : getArchiveHelperCount();

    return (
        <section
            className={
                'mx-auto flex max-w-4xl flex-col gap-8 '
                + 'xl:grid xl:max-w-none xl:grid-cols-[17.5rem_minmax(0,56rem)] xl:items-start xl:justify-center'
            }
        >
            <header className="space-y-5 xl:col-start-2">
                {/* The page's name, for screen readers only: every other page has an h1
                    to land on, and sighted readers get the headline figure instead (a
                    visible title above it was removed in fd57638). Matches the metadata
                    title in layout.tsx, less the site's name. */}
                <h1 className="sr-only">The GoS 10k</h1>

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
                            Garden of Salvation Full Clears
                        </figcaption>
                    </figure>
                    {/* Every figure on this page states the population it counts; this is
                        the headline's. Deliberately not phrased as a page-wide default: the
                        tiles below count three other populations, and #87's filter and the
                        panel tickets behind it are what make the default true. */}
                    <p className="ui-text-secondary text-sm leading-6">
                        Counting {scope}.
                    </p>
                </div>

                {/* The nav above this page is live and the numbers in it move. This band
                    is what stops a reader assuming these do too — and it carries the date
                    the Archive stops at, so "finished" has an end rather than being a claim. */}
                <p className="ui-card ui-text-secondary rounded-md border px-4 py-3 text-sm leading-6">
                    <span className="font-medium ui-text-primary">
                        Complete through {formatArchiveTimestamp(span.lastRunAt)}.
                    </span>{' '}
                    This is a finished historical archive, not the live tracker. It was collected once and will not change; everything else on this
                    site updates in real time.
                </p>

                <p className="ui-text-secondary text-sm leading-6">
                    Every Garden of Salvation run he ever entered, from{' '}
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

            {/* Between the header and the panels in the flow, and the rail from `xl` up —
                it places itself in this grid; see its comment. */}
            <ArchiveRangeFilter range={range} span={span} presets={presets} tab={tab} />

            <div className="space-y-8 xl:col-start-2">
                {/* #81's render order: the filter, then the timeline, then the panels.
                    The timeline follows the control directly because it zooms to the
                    control's own selection, and shades it on the overview strip. */}
                <ArchiveTimeline months={timeline} zoomed={zoomed} range={range} />

                {/* Below the timeline rather than above it: the timeline is the filter's
                    companion and shows on every tab, and the strip introduces what changes. */}
                <ArchiveTabs tab={tab} request={request} />

                {tab === 'rankings' ? (
                    <RankingsTab range={range} request={request} params={params} scope={scope} />
                ) : tab === 'participants' ? (
                    <ParticipantsTab range={range} scope={scope} />
                ) : (
                    <OverviewTab range={range} overview={overview} scope={scope} />
                )}

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
            </div>
        </section>
    );
}

/*
 * The three tabs (#112). Each reads its own panels' data in its body, so the tab the
 * page does not render never queries. Plain functions rather than async components: the
 * Archive's reads are synchronous.
 */

/** Presence, the tiles, By year and the Resets panel — the reading of the headline. */
function OverviewTab({
    range,
    overview,
    scope,
}: {
    range: ResolvedArchiveRange;
    /** Already read for the header; the tiles are three more of its figures. */
    overview: ArchiveOverview;
    scope: string;
}) {
    const presence = getSubjectPresence(range);
    const years = getRunsByYear(range);
    const nonClears = getNonClearRuns(range);

    const maxYearRuns = Math.max(...years.map((year) => year.runs), 1);

    return (
        <div className="space-y-8">
            {/* #81's render order: the timeline, then his own presence. The strip answers
                the sceptical reading of the headline before anything below it — or on the
                Rankings tab — asks the reader to trust the 10,000. */}
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
                {/* The red segment is the one thing on this panel with no column of its
                    own, so the description is where it gets its name. */}
                <p className="ui-text-secondary text-sm leading-6">
                    Full Clears and runs entered across {scope}. The faded red is every run
                    that was not a Full Clear: Resets, Checkpoint Runs, and runs his fireteam
                    cleared without him.
                </p>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="ui-text-secondary text-left text-xs">
                            <th className="py-1 font-medium">Year</th>
                            <th className="py-1 font-medium">Full clears</th>
                            <th className="py-1 font-medium">Runs</th>
                            <th className="py-1 font-medium" aria-hidden />
                        </tr>
                    </thead>
                    <tbody className="ui-text-secondary">
                        {years.map((year) => (
                            <tr key={year.year}>
                                <td className="py-1 ui-text-primary">{year.year}</td>
                                <td className="py-1">{year.fullClears.toLocaleString()}</td>
                                <td className="py-1">{year.runs.toLocaleString()}</td>
                                <td className="w-1/2 py-1">
                                    <YearBar year={year} of={maxYearRuns} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {/* Last on Overview, beside the headline it qualifies rather than after the
                boards (#112). Everything else here counts the 10,000; this is where the
                page says what else he started. */}
            <ResetsPanel outcomes={nonClears} scope={scope} />
        </div>
    );
}

/** Who helped most, Fastest clears, Consistently fastest — the ranked lists. */
function RankingsTab({
    range,
    request,
    params,
    scope,
}: {
    range: ResolvedArchiveRange;
    /** The Helper board's links write this back, so they keep the reader's range. */
    request: ArchiveRangeRequest;
    /** The Helper board's own view state is read here, where the board is. */
    params: Record<string, string | string[] | undefined>;
    scope: string;
}) {
    const helperView = parseHelperBoardView(params);
    const helperBoard = getHelperBoard(helperView.showAll ? null : HELPER_BOARD_ROWS, range);
    const fastestClears = getFastestClears(10, range);
    const medianSpeed = getMedianSpeedBoard(MEDIAN_SPEED_BOARD_ROWS, range);

    return (
        <div className="space-y-8">
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
        </div>
    );
}

/** The participants panel and the class split — who was in the Runs. */
function ParticipantsTab({ range, scope }: { range: ResolvedArchiveRange; scope: string }) {
    const participants = getParticipantDistribution(range);
    const classes = getClassDistribution(range);

    return (
        <div className="space-y-8">
            {/* How many people were in the clears, then which characters were in every
                Run — the rest of #81's render order, on its own tab since #112. */}
            <ParticipantsPanel buckets={participants} scope={scope} />

            {/* #81's last slot. Characters across every Run in range, not the clears —
                the panel says so, since the one above it counts clears. */}
            <ClassSplit classes={classes} scope={scope} />
        </div>
    );
}
