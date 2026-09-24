import { MEDIAN_SPEED_CLEAR_FLOOR, type ArchiveMedianSpeedHelper } from '@/lib/db/archive/queries';
import { formatMedianDuration } from './duration-copy';

/**
 * The median speed board (#92) — who is consistently fast, as distinct from who had one
 * good night.
 *
 * **Players, not Runs**, which is the opposite choice from the fastest-clears list above
 * it and is why the two panels are both worth having: that one is about records, this
 * one is about form. A Helper reaches it by being quick across fifteen or more clears
 * rather than by being in the single fast fireteam that set a record.
 *
 * **Median rather than mean**, because this Archive contains AFK runs of several hours
 * and a mean cannot survive one of them. The query says the same thing in SQL; the
 * reason is stated on the page too, because a reader comparing this board to the records
 * above will otherwise assume they are the same statistic.
 *
 * A Helper is *present for* a Pinned Full Clear rather than the owner of one — every Run
 * in this Archive is the subject's — which is why the copy reads "present for" and the
 * column is headed with the population rather than with a possessive.
 *
 * The floor is written into the panel's own copy rather than only into the query. A
 * reader who expects to see someone and does not is owed the reason — and the reason
 * moves with the range, because fifteen clears in one February is a different bar from
 * fifteen across six years.
 */
export function MedianSpeedBoard({
    helpers,
    scope,
}: {
    helpers: ArchiveMedianSpeedHelper[];
    scope: string;
}) {
    return (
        <section aria-labelledby="archive-median-speed-heading" className="space-y-3">
            <h2 id="archive-median-speed-heading" className="text-xl font-semibold ui-text-primary">
                Consistently fastest
            </h2>
            {/* Every panel states the population it counts (#81), and this one has to
                state its floor in the same breath: the population *is* "Helpers with at
                least fifteen clears in this window", not "Helpers". */}
            <p className="ui-text-secondary text-sm leading-6">
                Guardians present for at least {MEDIAN_SPEED_CLEAR_FLOOR} Full Clears
                across {scope}, ranked by their median clear time. A median rather than an average,
                because one AFK run of several hours would wreck an average.
            </p>

            {helpers.length === 0 ? (
                // Reachable on any narrow range — a single day holds one clear, so nobody
                // can reach fifteen. An empty table with three headings would read as a
                // broken panel; this says which of the two things happened.
                <p className="ui-text-secondary text-sm leading-6">
                    No guardian was present for {MEDIAN_SPEED_CLEAR_FLOOR} Full Clears in
                    this range, so there is nobody to rank. Widen the range to see the board.
                </p>
            ) : (
                // Its own testid rather than a role locator: `getByRole('table')` binds to
                // whatever is in a `<table>`, so the Helper board above would capture an
                // assertion meant for this one (see docs/handoffs/260803-playwright-e2e.md).
                <table data-testid="archive-median-speed" className="w-full text-sm">
                    <thead>
                        <tr className="ui-text-secondary text-left text-xs">
                            <th className="py-1 font-medium">Guardian</th>
                            <th className="py-1 font-medium">Full clears</th>
                            {/* "Median clear", not "Median": the column is a duration over
                                one population, and the header is where a reader learns
                                which. */}
                            <th className="py-1 font-medium">Median clear</th>
                        </tr>
                    </thead>
                    <tbody className="ui-text-secondary">
                        {helpers.map((helper) => (
                            <tr key={helper.membershipId}>
                                {/* `Name#Code` in full, as everywhere on this site. */}
                                <td className="py-1 ui-text-primary">{helper.displayName}</td>
                                <td className="py-1 tabular-nums">
                                    {helper.clears.toLocaleString()}
                                </td>
                                <td className="py-1 tabular-nums">
                                    {formatMedianDuration(helper.medianSeconds)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}
