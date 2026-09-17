import type { ArchiveParticipantBucket } from '@/lib/db/archive/queries';

/** The bucket the panel leads with: the most impressive population figure the Archive has. */
const HEADLINE_PEOPLE = 3;

/**
 * The participants panel (#94) — how many people were in each Pinned Full Clear, so a
 * reader can find the low-population ones.
 *
 * **People who entered, never fireteam size**, in the column header and in the population
 * line both. The figure is distinct people across the whole Run, so a clear where someone
 * left and was replaced has seven or more; calling that a fireteam of seven would be wrong,
 * and a maximum-concurrent figure would have to be invented. See **Participant** in
 * CONTEXT.md.
 *
 * **The trio clears are the headline, not a row.** 42 of them in production is the most
 * impressive population statistic in the dataset, and a seven-row table dominated by 9,480
 * sixes buries it — so it is a `figure` above the table, and its row is emphasised in it.
 * A trio here means three people entered and nobody else ever did, which is a stronger
 * claim than "three at the end", and the caption says the stronger one because it is true.
 *
 * **The duos are kept and said to be kept.** #81 treats all four as genuine, and a reader
 * who doubts a duo is owed the reason it is on the page rather than a silent row.
 *
 * Bars are scaled to the largest bucket, so the small buckets are slivers beside the sixes.
 * That is the shape of the data rather than a rendering problem; the counts carry the
 * detail, and a populated bucket keeps a visible minimum so it cannot read as empty.
 */
export function ParticipantsPanel({
    buckets,
    scope,
}: {
    buckets: ArchiveParticipantBucket[];
    scope: string;
}) {
    const clears = buckets.reduce((sum, bucket) => sum + bucket.clears, 0);
    const largest = Math.max(...buckets.map((bucket) => bucket.clears), 1);
    const trio = buckets.find((bucket) => bucket.people === HEADLINE_PEOPLE)?.clears ?? 0;
    const duo = buckets.find((bucket) => bucket.people === 2)?.clears ?? 0;

    return (
        <section aria-labelledby="archive-participants-heading" className="space-y-3">
            <h2 id="archive-participants-heading" className="text-xl font-semibold ui-text-primary">
                How many people were in each clear
            </h2>
            {/* Every panel states the population it counts (#81), and this one has to say
                what "people" means before a reader takes the column for fireteam size. */}
            <p className="ui-text-secondary text-sm leading-6">
                Pinned Full Clears across {scope}, by how many different people entered each
                one. This counts everyone who entered at any point, not the size of the fireteam
                at any one moment: when someone left and was replaced, both count, which is how a
                clear can have seven or more.
            </p>

            {clears === 0 ? (
                // Reachable for a range holding Runs but no clears (November 2020). Seven rows
                // of zero would read as a broken panel rather than as an empty window.
                <p className="ui-text-secondary text-sm leading-6">
                    There are no Pinned Full Clears in this range, so there is nobody to count.
                </p>
            ) : (
                <div data-testid="archive-participants" className="space-y-4">
                    {/* A `figure`/`figcaption` pair, like the page's own headline, so the
                        number is read out with the population it counts. */}
                    <figure className="space-y-1">
                        <div className="text-4xl font-bold leading-none ui-accent-text tabular-nums">
                            {trio.toLocaleString()}
                        </div>
                        <figcaption className="text-sm leading-6 ui-text-secondary">
                            <span className="font-medium ui-text-primary">
                                {trio === 1 ? 'trio clear' : 'trio clears'}
                            </span>{' '}
                            — {trio === 1 ? 'a Pinned Full Clear' : 'Pinned Full Clears'} that three
                            people entered, and nobody else ever did.
                        </figcaption>
                    </figure>

                    <table className="w-full text-sm">
                        <thead>
                            <tr className="ui-text-secondary text-left text-xs">
                                <th className="py-1 font-medium">People who entered</th>
                                <th className="py-1 font-medium">Clears</th>
                                <th className="py-1 font-medium" aria-hidden />
                            </tr>
                        </thead>
                        <tbody className="ui-text-secondary">
                            {buckets.map((bucket) => {
                                const isHeadline = bucket.people === HEADLINE_PEOPLE;
                                return (
                                    <tr
                                        key={bucket.people}
                                        className={isHeadline ? 'font-medium ui-text-primary' : undefined}
                                    >
                                        <td className="whitespace-nowrap py-1 pr-3">
                                            {peopleLabel(bucket)}
                                        </td>
                                        <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                                            {bucket.clears.toLocaleString()}
                                        </td>
                                        <td className="w-1/2 py-1">
                                            <div
                                                className="h-2 rounded-sm bg-current opacity-40"
                                                style={{
                                                    width: `${(bucket.clears / largest) * 100}%`,
                                                    minWidth: bucket.clears > 0 ? '2px' : undefined,
                                                }}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {duo > 0 && (
                        <p className="ui-text-secondary text-xs leading-5">
                            The {duo === 1 ? 'duo clear is' : `${duo.toLocaleString()} duo clears are`}{' '}
                            kept rather than filtered out: a genuine two-person clear in an era that
                            allowed one, or Bungie&apos;s reporting of who started a run being
                            unreliable at the time. Either way, that is what the record says.
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

function peopleLabel({ people, orMore }: ArchiveParticipantBucket): string {
    if (orMore) return `${people} or more`;
    return people === 1 ? 'Solo' : String(people);
}
