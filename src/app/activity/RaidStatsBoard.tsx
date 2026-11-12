import { Suspense } from 'react';
import { isDatabaseMaintenanceError } from '@/lib/db';
import type { RaidStatsRead } from '@/lib/cache/raid-stats-cache';
import type { RaidScopeStats, RaidStatsFrameRow } from '@/lib/db/queries';
import { settle, type Peeked, type Settled } from './peek';
import { raidStatsBoard, scopePanel, type RaidStatsCard, type StatsFigure } from './raid-stats-view';

/** What the frame's read gives. */
type FrameValue = RaidStatsRead<RaidStatsFrameRow[]>;
/** What the shown scope's read gives. */
type ScopeValue = RaidStatsRead<Map<string, RaidScopeStats> | null>;
/** A read the page made (./page.tsx), and what its peek saw of it. */
type Staged<T> = { read: Promise<T>; seen: Peeked<T> };

/** What a card's scope part shows: the scope's stats, a skeleton while they compute, or maintenance. */
type ScopeState = Map<string, RaidScopeStats> | 'pending' | 'maintenance';

/**
 * The Raid Stats board (#200): one card per raid, streamed in two steps.
 *
 * **Two `Suspense` boundaries, nested, and nothing route-level.** The first waits for the frame
 * and then knows which cards there are, with their Clear Time; the second, inside it, waits for the
 * shown scope and fills in KDA and Classes. Its fallback is the same cards with those parts as
 * skeletons, so Clear Time is on screen as soon as the frame is. Two boundaries can't each sit
 * inside every card, so a cold load sends the Clear Time markup twice; that is the price of one
 * boundary per stage. There is no `loading.tsx`: it would leave the chart tab blank for a reader
 * with JavaScript off (#200's streaming prototype, 2026-11-12).
 *
 * **The page makes both reads, not these components** (./page.tsx), the scope's after the frame's:
 * better-sqlite3 blocks the thread, and a component that starts its own query streams nothing.
 * The pause that lets each stage flush is in src/lib/cache/raid-stats-cache.ts. On a warm cache
 * both reads settle at once and the whole board is in the first HTML, skeleton-free.
 *
 * **What has already settled is plain markup.** The page peeks at both reads after one turn of
 * the event loop (./peek.ts): a cache hit has settled by then, a miss is still in its pause.
 * A settled read renders in place, with no boundary; only a pending one goes behind `Suspense`.
 * React outlines every async component into a later chunk, so a warm read awaited inside one can
 * still reach the reader as a fallback plus a hidden segment, and a reader with JavaScript off
 * would never see it swapped in. Peeked, a warm board is in the first HTML, skeleton-free.
 *
 * With JavaScript off a cold stage never swaps its skeleton out, so each skeleton says so in a
 * `<noscript>` line.
 */
export function RaidStatsBoard({
    frame,
    scopeStats,
    definitions,
}: {
    frame: Staged<FrameValue>;
    scopeStats: Staged<ScopeValue>;
    definitions: Record<string, { name: string }>;
}) {
    return (
        <div data-testid="raid-stats-board">
            {frame.seen.state === 'pending' ? (
                <Suspense fallback={<RaidStatsSkeleton />}>
                    <FrameStage frame={frame.read} scopeStats={scopeStats.read} definitions={definitions} />
                </Suspense>
            ) : (
                <FrameContent frame={frame.seen} scopeStats={scopeStats} definitions={definitions} />
            )}
        </div>
    );
}

/** The frame's stage when it was pending at the peek: awaits it, then is what a settled frame is. */
async function FrameStage({
    frame,
    scopeStats,
    definitions,
}: {
    frame: Promise<FrameValue>;
    scopeStats: Promise<ScopeValue>;
    definitions: Record<string, { name: string }>;
}) {
    const settled = await settle(frame);
    return <FrameContent frame={settled} scopeStats={{ read: scopeStats, seen: { state: 'pending' } }} definitions={definitions} />;
}

/** A settled frame: maintenance, the empty state, or the cards with their scope part. */
function FrameContent({
    frame,
    scopeStats,
    definitions,
}: {
    frame: Settled<FrameValue>;
    scopeStats: Staged<ScopeValue>;
    definitions: Record<string, { name: string }>;
}) {
    if (frame.state === 'rejected') {
        if (!isDatabaseMaintenanceError(frame.error)) throw frame.error;
        return <RaidStatsMaintenance />;
    }
    const board = raidStatsBoard(frame.value.value, definitions);
    if (board.kind === 'empty') {
        return (
            <p data-testid="raid-stats-empty" className="ui-text-secondary">
                No raids have been counted in this range yet.
            </p>
        );
    }
    if (scopeStats.seen.state === 'pending') {
        return (
            <Suspense fallback={<RaidStatsCards cards={board.cards} scope="pending" />}>
                <ScopeStage cards={board.cards} scopeStats={scopeStats.read} />
            </Suspense>
        );
    }
    return <RaidStatsCards cards={board.cards} scope={scopeOf(scopeStats.seen)} />;
}

/** The scope's stage when it was pending at the peek. */
async function ScopeStage({ cards, scopeStats }: { cards: RaidStatsCard[]; scopeStats: Promise<ScopeValue> }) {
    const settled = await settle(scopeStats);
    return <RaidStatsCards cards={cards} scope={scopeOf(settled)} />;
}

/**
 * A settled scope read as the cards' scope part. The shown scope is always one the window computes
 * (statsScopeFor), so a null value doesn't occur; read as no Player-Runs, it would show "0 runs"
 * rather than break the board.
 */
function scopeOf(read: Settled<ScopeValue>): ScopeState {
    if (read.state === 'rejected') {
        if (!isDatabaseMaintenanceError(read.error)) throw read.error;
        return 'maintenance';
    }
    return read.value.value ?? new Map();
}

/** The board's line in maintenance, in place of every card. */
function RaidStatsMaintenance() {
    return (
        <p data-testid="activity-maintenance" className="ui-text-secondary">
            Database maintenance is in progress. Raid Stats is temporarily unavailable.
        </p>
    );
}

/** The `<noscript>` line under a skeleton: with JavaScript off a cold stage is never swapped in. */
function StillComputing() {
    return (
        <noscript>
            <p className="ui-text-secondary text-sm">Still computing. Reload shortly.</p>
        </noscript>
    );
}

/** The first stage's fallback: the board's shape, before the frame says which raids there are. */
function RaidStatsSkeleton() {
    return (
        <div data-testid="raid-stats-skeleton" className="space-y-4">
            <StillComputing />
            <ul className="grid gap-4 md:grid-cols-2" aria-hidden="true">
                {[0, 1].map((index) => (
                    <li key={index} className="ui-card space-y-3 p-4">
                        <div className="ui-skeleton h-6 w-40 rounded" />
                        <div className="ui-skeleton h-12 rounded" />
                        <div className="ui-skeleton h-12 rounded" />
                    </li>
                ))}
            </ul>
        </div>
    );
}

function RaidStatsCards({ cards, scope }: { cards: RaidStatsCard[]; scope: ScopeState }) {
    return (
        <div className="space-y-4">
            {scope === 'pending' && <StillComputing />}
            <ul className="grid gap-4 md:grid-cols-2">
                {cards.map((card) => (
                    <li key={card.raidKey} data-testid="raid-stats-card" data-raid={card.raidKey} className="ui-card space-y-4 p-4">
                        <h2 className="text-lg font-semibold ui-text-primary">{card.name}</h2>
                        <section data-testid="raid-stats-clear-time" className="space-y-2">
                            <PanelHeading title="Clear Time" sample={card.clearTime.kind === 'figures' ? card.clearTime.sample : null} />
                            <p className="text-xs ui-text-muted">Always Full Clears, whatever the scope. Suspect clears are not filtered.</p>
                            {card.clearTime.kind === 'figures' ? <Figures figures={card.clearTime.figures} /> : <TooFew line={card.clearTime.line} />}
                        </section>
                        <ScopePart stats={scope === 'pending' || scope === 'maintenance' ? scope : scope.get(card.raidKey)} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** KDA and Classes for one card: figures, one too-few line for both, a skeleton, or maintenance. */
function ScopePart({ stats }: { stats: RaidScopeStats | undefined | 'pending' | 'maintenance' }) {
    if (stats === 'pending') {
        return (
            <KdaSection title="KDA">
                <div data-testid="raid-stats-skeleton" className="ui-skeleton h-12 rounded" aria-hidden="true" />
            </KdaSection>
        );
    }
    if (stats === 'maintenance') {
        return (
            <KdaSection title="KDA">
                <p className="ui-text-secondary text-sm">Unavailable during database maintenance.</p>
            </KdaSection>
        );
    }
    const panel = scopePanel(stats);
    if (panel.kind === 'tooFew') {
        return (
            <KdaSection title="KDA and Classes">
                <TooFew line={panel.line} />
            </KdaSection>
        );
    }
    return (
        <>
            <section data-testid="raid-stats-kda" className="space-y-2">
                <PanelHeading title="KDA" sample={panel.sample} />
                <Figures figures={panel.figures} />
            </section>
            <section className="space-y-1">
                <PanelHeading title="Classes" sample={null} />
                <p data-testid="raid-stats-classes" className="text-sm ui-text-primary tabular-nums">
                    {panel.classes}
                </p>
            </section>
        </>
    );
}

/** The KDA panel with no figures in it: a skeleton, maintenance, or too few to show. */
function KdaSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section data-testid="raid-stats-kda" className="space-y-2">
            <PanelHeading title={title} sample={null} />
            {children}
        </section>
    );
}

/** A panel's title, with its sample size muted beside it. */
function PanelHeading({ title, sample }: { title: string; sample: string | null }) {
    return (
        <h3 className="text-sm font-medium ui-text-secondary">
            {title}
            {sample !== null && (
                <>
                    {' · '}
                    <span data-testid="raid-stats-sample" className="font-normal ui-text-muted">
                        {sample}
                    </span>
                </>
            )}
        </h3>
    );
}

function Figures({ figures }: { figures: StatsFigure[] }) {
    return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {figures.map(({ label, value }) => (
                <div key={label} data-testid="raid-stats-figure">
                    <dt className="text-xs ui-text-muted">{label}</dt>
                    <dd className="text-base tabular-nums ui-text-primary">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function TooFew({ line }: { line: string }) {
    return <p className="text-sm ui-text-secondary">{line}</p>;
}
