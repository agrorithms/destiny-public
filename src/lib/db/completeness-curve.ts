/**
 * The completeness curve behind Raid Activity's Provisional estimate (#196, ADR 0009).
 * Stub: the tests come first.
 */

export const CURVE_BIN_SECONDS = 300;
export const CURVE_MAX_AGE_SECONDS = 7200;
export const CURVE_COMPLETE_AGE_SECONDS = 86400;
export const CURVE_TRAINING_SECONDS = 7 * 86400;

export interface CompletenessCurve {
    byHour: Array<readonly number[] | null>;
    overall: readonly number[];
}

export interface CurveTally {
    seconds: number[];
    counted: number[][];
}

export interface TrainingWindow {
    from: number;
    until: number;
}

export function trainingWindow(_now: number, _stepSeconds: number): TrainingWindow {
    throw new Error('not implemented');
}

export function newTally(): CurveTally {
    throw new Error('not implemented');
}

export function hourOfStep(_start: number, _stepSeconds: number): number {
    throw new Error('not implemented');
}

export function tallyRun(
    _tally: CurveTally,
    _window: TrainingWindow,
    _stepSeconds: number,
    _period: number,
    _endedAt: number
): void {
    throw new Error('not implemented');
}

export function curveFromTally(_tally: CurveTally): CompletenessCurve | null {
    throw new Error('not implemented');
}

export function shareAt(_curve: CompletenessCurve, _hour: number, _ageSeconds: number): number {
    throw new Error('not implemented');
}

export function estimateTotal(_observed: number, _share: number): number | null {
    throw new Error('not implemented');
}
