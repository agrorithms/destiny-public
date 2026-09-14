import { PRESENCE_LATE_JOIN_SECONDS, type ArchiveSubjectPresence } from '@/lib/db/archive/queries';
import { formatMeanDuration, formatPresenceShare } from './duration-copy';

/**
 * The presence strip (#89) — how much of each clear he was actually there for.
 *
 * It exists to answer the first thing a sceptical reader thinks on being told one
 * Guardian has 10,000 full clears: how many of those did he join at the very end? The
 * panel answers with the share of the clears' time he was in them, the two averages that
 * share is made of, and a count of the clears he was in for under five minutes — so the
 * reading is on the page rather than asserted.
 *
 * **The share is total time over total time, not an average of per-clear ratios**, and
 * the copy says so by stating the two averages beside it. The other reading is 98.9%
 * unfiltered, eight points kinder, because it weights a seven-minute clear the same as a
 * five-hour AFK Run. getSubjectPresence's docblock carries the comparison.
 *
 * The bar is decoration for a figure already stated in text beside it, so it is hidden
 * from assistive technology rather than given a second accessible name that could drift
 * from the number.
 */
export function PresenceStrip({
    presence,
    scope,
}: {
    presence: ArchiveSubjectPresence;
    scope: string;
}) {
    const thresholdMinutes = PRESENCE_LATE_JOIN_SECONDS / 60;

    return (
        <section aria-labelledby="archive-presence-heading" className="space-y-3">
            <h2 id="archive-presence-heading" className="text-xl font-semibold ui-text-primary">
                How much of each clear he was there for
            </h2>
            {/* Every panel states the population it counts (#81). This one also has to
                state what "his time" is, because two characters in one Run make that a
                choice rather than a column. */}
            <p className="ui-text-secondary text-sm leading-6">
                His own time in the Pinned Full Clears across {scope} — from when he entered each
                one to when he left — against how long those clears ran.
            </p>

            {presence.clears === 0 ? (
                // Reachable for a range holding Runs but no clears, which
                // resolveArchiveRange keeps rather than degrading. A share of 0 of 0
                // seconds is not 0%, and printing one would read as "he was never there".
                <p className="ui-text-secondary text-sm leading-6">
                    No Pinned Full Clears in this range, so there is no presence to measure.
                </p>
            ) : (
                <PresenceFigures presence={presence} thresholdMinutes={thresholdMinutes} />
            )}
        </section>
    );
}

function PresenceFigures({
    presence,
    thresholdMinutes,
}: {
    presence: ArchiveSubjectPresence;
    thresholdMinutes: number;
}) {
    const share = presence.presentSeconds / presence.durationSeconds;
    const clearWord = presence.clears === 1 ? 'clear' : 'clears';

    return (
        <div data-testid="archive-presence-strip" className="ui-card space-y-3 rounded-md border px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-bold ui-accent-text tabular-nums">
                    {formatPresenceShare(share)}
                </span>
                <span className="ui-text-secondary text-sm">of the time those clears ran</span>
            </div>

            {/* Track and fill are siblings, not parent and child: `opacity` on a parent
                dims everything inside it, so a faded track would fade the fill with it. */}
            <div aria-hidden className="relative h-2 w-full overflow-hidden rounded-sm">
                <div className="ui-text-secondary absolute inset-0 bg-current opacity-20" />
                {/* Clamped as the formatter clamps: a share over 100% is a data fault. */}
                <div
                    className="ui-accent-text absolute inset-y-0 left-0 bg-current"
                    style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
                />
            </div>

            <p className="ui-text-secondary text-sm leading-6">
                On average he was in a clear for{' '}
                <span className="font-medium ui-text-primary tabular-nums">
                    {formatMeanDuration(presence.presentSeconds / presence.clears)}
                </span>{' '}
                of its{' '}
                <span className="font-medium ui-text-primary tabular-nums">
                    {formatMeanDuration(presence.durationSeconds / presence.clears)}
                </span>
                .
            </p>

            {/* The sceptical reading, answered with a count rather than a reassurance —
                and with its threshold in the sentence, so the count can be checked. */}
            <p className="ui-text-secondary text-sm leading-6">
                {presence.lateJoins === 0 ? (
                    <>
                        In none of the {presence.clears.toLocaleString()} {clearWord} was he present
                        for under {thresholdMinutes} minutes.
                    </>
                ) : (
                    <>
                        <span className="font-medium ui-text-primary tabular-nums">
                            {presence.lateJoins.toLocaleString()}
                        </span>{' '}
                        of the {presence.clears.toLocaleString()} {clearWord} had him present for under{' '}
                        {thresholdMinutes} minutes — joined at the very end.
                    </>
                )}
            </p>
        </div>
    );
}
