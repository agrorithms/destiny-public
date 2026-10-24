import type { RaidsInProgressPoint, RaidsInProgressSeries } from '@/lib/db/queries';

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 200;
export const LAST_LABELLED_TICK_PERCENT = 88;

export interface ActivityTick {
    percent: number;
    label: string | null;
}

export interface ValueAxis {
    max: number;
    ticks: Array<{ value: number; label: string; percent: number }>;
}

export function dayTicks(from: number, to: number): ActivityTick[] {
    void from;
    void to;
    return [];
}

export function valueAxis(busiest: number): ValueAxis {
    void busiest;
    return { max: 1, ticks: [] };
}

export function linePath(points: RaidsInProgressPoint[], from: number, to: number, max: number): string {
    void points;
    void from;
    void to;
    void max;
    return '';
}

export function notYetCounted(series: Pick<RaidsInProgressSeries, 'from' | 'to' | 'countedUntil'>): { startPercent: number; endPercent: number } {
    void series;
    return { startPercent: 0, endPercent: 0 };
}

export function busiestStep(points: RaidsInProgressPoint[]): RaidsInProgressPoint | null {
    void points;
    return null;
}

export function formatStepWindow(start: number, end: number): string {
    void start;
    void end;
    return '';
}
