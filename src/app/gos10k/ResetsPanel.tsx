import { RESET_RESTART_SECONDS, type ArchiveNonClearRuns } from '@/lib/db/archive/queries';
import { formatMeanDuration } from './duration-copy';
import { Figure } from './Figure';
import { plural } from './plural-copy';

const RESTART_MINUTES = RESET_RESTART_SECONDS / 60;

/**
 * Below this share of the Runs in range, the panel is willing to say checkpoint farming
 * "barely figures". An editorial threshold rather than a query one, which is why it lives
 * beside the copy it governs instead of in the query module — but named, like
 * {@link RESET_RESTART_SECONDS}, so the sentence's condition is legible rather than a
 * bare number inside JSX.
 */
const CHECKPOINT_RARE_SHARE = 0.01;

/**
 * The Resets panel (#93) — the Runs that did not become clears, so the 10,000 is not
 * presented as though every attempt succeeded.
 *
 * **Prose with figures, not a filter state.** #81 rejected making the non-clears
 * something a reader toggles into view: the interesting thing about them is a sentence
 * ("these are restarts, not collapses"), and a toggle would leave that sentence for the
 * reader to discover. Every population is always stated, including as "none", so a
 * narrow range cannot make one silently disappear.
 *
 * **Restart versus collapse is a count, not an adjective.** The mean (5:56 unfiltered) is
 * pulled up by a tail of hour-long Runs (the median is under three minutes), so the panel
 * states how many Resets ended inside {@link RESET_RESTART_SECONDS} beside the mean. That
 * stays true in any range — including one whose only Reset lasted an hour, where calling
 * it a restart would be wrong.
 *
 * The closing line reconciles the populations to the Runs in range with the query's own
 * `runs` rather than a sum of the figures above it, so a data fault that broke the
 * partition would show as an equation that does not add up instead of being hidden.
 */
export function ResetsPanel({
    outcomes,
    scope,
}: {
    outcomes: ArchiveNonClearRuns;
    scope: string;
}) {
    const nonClears = outcomes.runs - outcomes.pinnedFullClears;

    return (
        <section aria-labelledby="archive-resets-heading" className="space-y-3">
            <h2 id="archive-resets-heading" className="text-xl font-semibold ui-text-primary">
                The runs that did not become clears
            </h2>
            {/* Every panel states the population it counts (#81), and this one counts the
                opposite of every other panel on the page — so it says so outright. */}
            <p className="ui-text-secondary text-sm leading-6">
                Everything except the Full Clears: {nonClears.toLocaleString()} of the{' '}
                {outcomes.runs.toLocaleString()} {plural(outcomes.runs, 'run', 'runs')} he
                entered across {scope}.
            </p>

            {nonClears === 0 ? (
                // Reachable for a one-clear range (clears 102–102): the window holds that
                // Run and nothing else. Three "none" sentences would read as a broken panel.
                <p className="ui-text-secondary text-sm leading-6">
                    Every run in this range was a Full Clear, so there is nothing to
                    report here.
                </p>
            ) : (
                <div data-testid="archive-resets" className="ui-card space-y-3 rounded-md border px-4 py-3">
                    <p className="ui-text-secondary text-sm leading-6">
                        <ResetSentence outcomes={outcomes} />
                    </p>
                    <p className="ui-text-secondary text-sm leading-6">
                        <ClearedWithoutSubjectSentence outcomes={outcomes} />
                    </p>
                    <p className="ui-text-secondary text-sm leading-6">
                        <CheckpointSentence outcomes={outcomes} />
                    </p>
                    <p className="ui-text-secondary text-xs leading-5 tabular-nums">
                        {outcomes.pinnedFullClears.toLocaleString()} clears +{' '}
                        {outcomes.resets.toLocaleString()} +{' '}
                        {outcomes.clearedWithoutSubject.toLocaleString()} +{' '}
                        {outcomes.checkpointRuns.toLocaleString()} ={' '}
                        {outcomes.runs.toLocaleString()} {plural(outcomes.runs, 'run', 'runs')}.
                    </p>
                </div>
            )}
        </section>
    );
}

/** The Reset population, with the restart-versus-collapse reading as a count. */
function ResetSentence({ outcomes }: { outcomes: ArchiveNonClearRuns }) {
    const { resets, quickResets } = outcomes;

    if (resets === 0) {
        return <>No run in this range was started from the first encounter and abandoned.</>;
    }

    const mean = formatMeanDuration(outcomes.resetSeconds / resets);
    const lead = (
        <>
            <Figure>{resets.toLocaleString()}</Figure> {plural(resets, 'run', 'runs')} started
            fresh that nobody finished,{' '}
            {resets === 1 ? 'lasting' : 'averaging'} <Figure>{mean}</Figure>.
        </>
    );

    // One Reset: say which it was, rather than "1 of the 1".
    if (resets === 1) {
        return (
            <>
                {lead}{' '}
                {quickResets === 1
                    ? `Over within ${RESTART_MINUTES} minutes.`
                    : `Longer than ${RESTART_MINUTES} minutes.`}
            </>
        );
    }

    if (quickResets === 0) {
        return (
            <>
                {lead} None ended inside {RESTART_MINUTES} minutes.
            </>
        );
    }

    return (
        <>
            {lead} <Figure>{quickResets.toLocaleString()}</Figure> of them ended inside{' '}
            {RESTART_MINUTES} minutes.
        </>
    );
}

function ClearedWithoutSubjectSentence({ outcomes }: { outcomes: ArchiveNonClearRuns }) {
    const n = outcomes.clearedWithoutSubject;

    if (n === 0) {
        return <>No run in this range was cleared by his fireteam after he had left.</>;
    }

    return (
        <>
            <Figure>{n.toLocaleString()}</Figure> fresh {plural(n, 'run', 'runs')} his fireteam finished
            without him, {n === 1 ? 'lasting' : 'averaging'}{' '}
            <Figure>{formatMeanDuration(outcomes.clearedWithoutSubjectSeconds / n)}</Figure>. A
            Full Clear on this page needs him to finish it himself, so {n === 1 ? 'it is' : 'these are'}{' '}
            not counted.
        </>
    );
}

/**
 * Checkpoint Runs, with who finished them.
 *
 * The rule sentence is what keeps 483 honest: most of them opened on the first encounter's
 * phase index, and only Bungie's own report says they did not start from the beginning.
 * The count behind the 10,000 trusts that report after the pin, so this panel does too —
 * and a reader who finds one of these on raid.report should not have to guess why.
 */
function CheckpointSentence({ outcomes }: { outcomes: ArchiveNonClearRuns }) {
    const n = outcomes.checkpointRuns;

    if (n === 0) {
        return <>No Checkpoint Runs in this range.</>;
    }

    return (
        <>
            <Figure>{n.toLocaleString()}</Figure> Checkpoint {plural(n, 'Run', 'Runs')} — started
            at a checkpoint rather than fresh — out of {outcomes.runs.toLocaleString()}.{' '}
            <CheckpointFinishers outcomes={outcomes} />
            {/* Only where it is true: October 2020 is 5 Checkpoint Runs of 9, and saying
                farming "barely figures" there would be the page contradicting its own
                figure. Unfiltered it is 483 of 13,420, so the clause does not show. */}
            {n / outcomes.runs < CHECKPOINT_RARE_SHARE && (
                <> Checkpoint farming barely figures in this history.</>
            )}
        </>
    );
}

function CheckpointFinishers({ outcomes }: { outcomes: ArchiveNonClearRuns }) {
    const n = outcomes.checkpointRuns;
    const his = outcomes.checkpointRunsFinished;
    const theirs = outcomes.checkpointRunsClearedWithoutSubject;

    if (his === 0 && theirs === 0) {
        return <>Nobody finished {n === 1 ? 'it' : 'any of them'}.</>;
    }

    // One Checkpoint Run: say who finished it, rather than "of those, he finished 1".
    if (n === 1) {
        return his === 1 ? <>He finished it.</> : <>His fireteam finished it without him.</>;
    }

    return (
        <>
            Of those,{' '}
            {his > 0 && (
                <>
                    he finished <Figure>{his.toLocaleString()}</Figure>
                </>
            )}
            {his > 0 && theirs > 0 && ' and '}
            {theirs > 0 && (
                <>
                    the fireteam finished <Figure>{theirs.toLocaleString()}</Figure> without him
                </>
            )}
            .
        </>
    );
}
