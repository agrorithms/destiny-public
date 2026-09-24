import type { ArchiveClassCount } from '@/lib/db/archive/queries';
import { formatShare } from './share-copy';
import { ShareBar } from './ShareBar';

/**
 * The class split (#94) — the population's class preferences across every Run in range.
 *
 * **Characters, and the copy says so.** Class belongs to a character, and someone who brought
 * two characters into one Run brought two classes; the query counts both (see
 * getClassDistribution). Calling the total "player-runs" would be off by exactly those
 * second characters — 220 in production — so the population line names the unit it counts.
 *
 * **Every Run, not only the clears.** This is the one panel on the Participants tab that
 * is not about the 10,000, and it states that outright rather than leaving a reader to
 * assume the page default.
 *
 * Shares are one decimal through the page's shared percentage rule, because the unknown row
 * is 0.2% and a whole number would print it as nobody.
 */
export function ClassSplit({
    classes,
    scope,
}: {
    classes: ArchiveClassCount[];
    scope: string;
}) {
    const total = classes.reduce((sum, row) => sum + row.characters, 0);
    const largest = Math.max(...classes.map((row) => row.characters), 1);

    return (
        <section aria-labelledby="archive-classes-heading" className="space-y-3">
            <h2 id="archive-classes-heading" className="text-xl font-semibold ui-text-primary">
                Classes brought
            </h2>
            <p className="ui-text-secondary text-sm leading-6">
                Every character brought into a run across {scope}, finished or not —{' '}
                {total.toLocaleString()} of them. Someone who brought two characters into one run
                counts once for each, because each had its own class.
            </p>

            {total === 0 ? (
                // Every Run in the Archive has player rows, and a range with no Runs degrades
                // to the whole Archive, so this is a guard against a division, not a state a
                // reader should meet.
                <p className="ui-text-secondary text-sm leading-6">
                    No characters to count in this range.
                </p>
            ) : (
                <ul data-testid="archive-class-split" className="space-y-2">
                    {classes.map((row) => (
                        <li key={row.characterClass} className="space-y-1">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="ui-text-primary">{row.characterClass}</span>
                                <span className="ui-text-secondary tabular-nums">
                                    {row.characters.toLocaleString()} ·{' '}
                                    {formatShare(row.characters / total)}
                                </span>
                            </div>
                            <ShareBar value={row.characters} of={largest} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
