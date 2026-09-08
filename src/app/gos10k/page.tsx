import Link from 'next/link';
import {
    getArchiveOverview,
    getTopHelpers,
    getRunsByYear,
    getClassDistribution,
} from '@/lib/db/archive/queries';

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
 * span, and the methodology as a closed disclosure. The panels below it are still the
 * unfiltered placeholders — the range filter is #87 and every panel is its own ticket.
 */
export const dynamic = 'force-dynamic';

function formatDate(unixSeconds: number | null): string {
    if (unixSeconds === null) return 'unknown';
    return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export default function Gos10kPage() {
    const overview = getArchiveOverview();
    const helpers = getTopHelpers(25);
    const years = getRunsByYear();
    const classes = getClassDistribution();

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
                    <div
                        data-testid="archive-headline-figure"
                        className="text-5xl font-bold leading-none ui-accent-text sm:text-6xl"
                    >
                        {overview.pinnedFullClears.toLocaleString()}
                    </div>
                    <p
                        data-testid="archive-headline-population"
                        className="text-base font-medium ui-text-primary"
                    >
                        Pinned Full Clears
                    </p>
                    {/* Every panel on this page states the population it counts. This is
                        the headline's, and it is also the page default. */}
                    <p className="ui-text-secondary text-sm leading-6">
                        Garden of Salvation runs one Guardian entered at the first encounter and
                        finished himself. Every figure below counts that population unless its own
                        panel says otherwise.
                    </p>
                </div>

                {/* The nav above this page is live and the numbers in it move. This band
                    is what stops a reader assuming these do too — and it carries the date
                    the Archive stops at, so "finished" has an end rather than being a claim. */}
                <p className="ui-card ui-text-secondary rounded-md border px-4 py-3 text-sm leading-6">
                    <span className="font-medium ui-text-primary">
                        Complete through {formatDate(overview.lastRunAt)}.
                    </span>{' '}
                    This is a finished historical archive, not the live tracker in the navigation
                    above it. It was collected once and will not change; everything else on this
                    site updates in real time.
                </p>

                <p className="ui-text-secondary text-sm leading-6">
                    Every Garden of Salvation run he ever entered, from{' '}
                    {formatDate(overview.firstRunAt)} to {formatDate(overview.lastRunAt)} — and the{' '}
                    {overview.helpers.toLocaleString()} people who showed up for them.
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

            {/* The pinned full-clear tile that used to lead this grid is now the headline
                above; repeating it here would state the page's own name twice. */}
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
            </section>

            <section className="space-y-3">
                <h2 className="text-xl font-semibold ui-text-primary">By year</h2>
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

            <section className="space-y-3">
                <h2 className="text-xl font-semibold ui-text-primary">Who helped most</h2>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="ui-text-secondary text-left text-xs">
                            <th className="py-1 font-medium">Guardian</th>
                            <th className="py-1 font-medium">Runs together</th>
                            <th className="py-1 font-medium">Full clears</th>
                        </tr>
                    </thead>
                    <tbody className="ui-text-secondary">
                        {helpers.map((helper) => (
                            <tr key={helper.membershipId}>
                                <td className="py-1 ui-text-primary">{helper.displayName}</td>
                                <td className="py-1">{helper.runs.toLocaleString()}</td>
                                <td className="py-1">{helper.fullClears.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <section className="space-y-3">
                <h2 className="text-xl font-semibold ui-text-primary">Classes brought</h2>
                <p className="ui-text-secondary text-sm leading-6">
                    {classes
                        .map(
                            (row) =>
                                `${row.characterClass} ${Math.round((row.playerRuns / totalPlayerRuns) * 100)}%`
                        )
                        .join(' · ')}{' '}
                    across {totalPlayerRuns.toLocaleString()} player-runs.
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
