import type { ArchiveFastestClear } from '@/lib/db/archive/queries';
import { formatRunDuration } from './duration-copy';
import { formatArchiveTimestamp, formatClearNumber } from './range-copy';

/**
 * The fastest clears list (#91) — records, and the fireteams that set them.
 *
 * **Runs, not players.** A board ranking people by personal best was considered and
 * rejected: the six people in the fastest Run would occupy the top six rows with
 * identical times, a tie that says nothing. Ranking Runs puts the fireteam on the page,
 * which is the more interesting object and the thing a reader actually wants to see.
 *
 * Two lines per row, deliberately. The record — rank, duration, date — is one line and
 * reads as a table; the fireteam is a wrapping set of chips on the next, because six to
 * ten `Name#Code`s cannot be a table column at phone width without either truncating a
 * name or scrolling sideways. `flex-wrap` is what makes the second line grow downward
 * instead of overflowing (#91's phone criterion, asserted in e2e/gos10k-fastest-clears.spec.ts).
 *
 * Durations arrive as raw seconds and are rendered through the one shared formatter that
 * #92's median speed board also imports. The query does no formatting, so there is no
 * second place for `453` to become something other than `7:33`.
 */
export function FastestClears({ clears, scope }: { clears: ArchiveFastestClear[]; scope: string }) {
    // One condition, read twice by the sentence below. Written out twice inline it was
    // two ternaries a future editor had to keep in sync by eye to change one wording.
    const isSingle = clears.length === 1;

    return (
        <section aria-labelledby="archive-fastest-heading" className="space-y-3">
            <h2 id="archive-fastest-heading" className="text-xl font-semibold ui-text-primary">
                Fastest clears
            </h2>
            {/* Every panel states the population it counts (#81), and after #87 that
                population has a range attached. `clears.length` rather than a written-down
                ten: a one-day filter legitimately returns one row, and a heading claiming
                ten above a list of one is the panel lying about its own contents. That case
                is reachable — tests/db/archive-fastest-clears.test.ts pins a one-clear range —
                so the sentence has to survive it rather than read "The 1 fastest". */}
            <p className="ui-text-secondary text-sm leading-6">
                {isSingle
                    ? 'The fastest Full Clear'
                    : `The ${clears.length} fastest Full Clears`}{' '}
                across {scope}, and everyone who was in {isSingle ? 'it' : 'them'}.
            </p>

            {clears.length === 0 ? (
                // Reachable only for a range holding Runs but no clears — which
                // resolveArchiveRange deliberately keeps rather than degrading, because
                // "Runs, no full clears" is a true answer. Saying so beats an empty box.
                <p className="ui-text-secondary text-sm leading-6">
                    No Full Clears in this range.
                </p>
            ) : (
                <ol data-testid="archive-fastest-clears" className="space-y-3">
                    {clears.map((clear, index) => (
                        <li
                            key={clear.instanceId}
                            data-testid="archive-fastest-clear-row"
                            className="ui-card space-y-2 rounded-md border px-4 py-3"
                        >
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span className="ui-text-secondary text-xs font-medium tabular-nums">
                                    #{index + 1}
                                </span>
                                <span className="text-lg font-bold ui-accent-text tabular-nums">
                                    {formatRunDuration(clear.durationSeconds)}
                                </span>
                                <span className="ui-text-secondary text-sm">
                                    {formatArchiveTimestamp(clear.period)}
                                </span>
                                {/* The Run's own place in the 10,000, which is the fact
                                    that ties this row back to the range control above it. */}
                                <span className="ui-text-secondary text-xs tabular-nums">
                                    {formatClearNumber(clear.clearNumber)}
                                </span>
                            </div>
                            {/* Not a fireteam of six: everyone who entered, which is seven
                                or more whenever somebody left and was replaced. The chips
                                wrap rather than overflow — see this file's header. */}
                            <ul
                                data-testid="archive-fastest-clear-participants"
                                className="flex flex-wrap gap-1.5"
                            >
                                {clear.participants.map((player) => (
                                    <li
                                        key={player.membershipId}
                                        className="ui-card rounded-full border px-2.5 py-0.5 text-xs ui-text-primary"
                                    >
                                        {player.displayName}
                                    </li>
                                ))}
                            </ul>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
