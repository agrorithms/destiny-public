/**
 * The completeness curve behind Raid Activity's Provisional estimate (#196, ADR 0009).
 *
 * A step's count is complete only once every raid that overlapped it has ended, because a
 * raid still running has no PGCR. The curve says how much of a step's raid time is known a
 * given age after the step ends — "age" is always measured to the step's end — separately
 * for each hour of the day, because run lengths differ by hour. The estimate for a recent
 * step is its partial count divided by that share.
 *
 * **Learned from whole steps of the range's own size.** A step is an average over its
 * length, so the curve is learned from training steps of the same length, not from
 * instants: reading an instant curve at a coarse step's end age is off by 35% at 1 hour.
 *
 * **From `ended_at`, never `fetched_at`.** The curve is about how long runs last. The
 * scanner's fetch lag is operational: on the 2026-10-23 backup it was hours behind until
 * 15 October, and a curve that learned it over-estimated by 20–65% on a good day.
 *
 * Pure: the rows come from `getCompletenessCurve` in ./queries.ts, which is the only SQL.
 * Shares are kept every {@link CURVE_BIN_SECONDS} up to {@link CURVE_MAX_AGE_SECONDS}, the
 * oldest end age a Provisional step has (under 2 hours, since a step whose end is 2 hours
 * old is counted).
 */

/** The spacing of the curve's points, and so its resolution in age. */
export const CURVE_BIN_SECONDS = 300;

/** The oldest end age a Provisional step has: a step 2 hours past its end is counted. */
export const CURVE_MAX_AGE_SECONDS = 7200;

/**
 * How old a training step's end must be to count as complete. Runs over 24 hours are rare
 * (57 in 12 days of prod) and the choice barely matters: 6, 12, 24 and 48 hours gave the
 * same backtest error to within 0.2 points.
 */
export const CURVE_COMPLETE_AGE_SECONDS = 86400;

/** How far back the training steps reach: the week before the completeness bound. */
export const CURVE_TRAINING_SECONDS = 604800; // seven days

const HOURS_IN_DAY = 24;
// A point every CURVE_BIN_SECONDS from age 0 to CURVE_MAX_AGE_SECONDS: 0, 5 … 120 minutes. A
// literal, not derived: a top-level calculation is out of reach of the mutation run; a test
// holds it equal to the two constants.
const BINS = 25;

/**
 * Shares at ages 0, 5, 10 … 120 minutes, per hour of day (null where no training step fell
 * in that hour), and for every hour together. Each series is non-decreasing.
 */
export interface CompletenessCurve {
    byHour: Array<readonly number[] | null>;
    overall: readonly number[];
}

/**
 * Raid seconds seen per hour of day, how many of them were known by each age bin, and how
 * many runs overlapped the training steps at all (#199: a raid's curve is only trusted past
 * {@link MIN_RAID_CURVE_RUNS} of them).
 */
export interface CurveTally {
    seconds: number[];
    counted: number[][];
    runs: number;
}

/** The training steps: whole steps starting at `from` and ending by `until`. */
export interface TrainingWindow {
    from: number;
    until: number;
}

/** The steps to learn from for a range with this step size, as of `now`. */
export function trainingWindow(now: number, stepSeconds: number): TrainingWindow {
    const until = Math.floor((now - CURVE_COMPLETE_AGE_SECONDS) / stepSeconds) * stepSeconds;
    return { from: until - CURVE_TRAINING_SECONDS, until };
}

export function newTally(): CurveTally {
    return {
        seconds: new Array<number>(HOURS_IN_DAY).fill(0),
        counted: Array.from({ length: HOURS_IN_DAY }, () => new Array<number>(BINS).fill(0)),
        runs: 0,
    };
}

/** The UTC hour of the day a step belongs to: that of its midpoint. */
export function hourOfStep(start: number, stepSeconds: number): number {
    return Math.floor((start + stepSeconds / 2) / 3600) % HOURS_IN_DAY;
}

/**
 * Adds one run to the tally, once per training step it overlaps. In each, the run's
 * raid time in the step is added to that hour's total, and to the age bin at which it
 * became known: the run is reported by the time it ends, so the bin is how long after the
 * step's end that is (0 when it ended inside the step). A run that ends after the curve's
 * longest age never lands in a bin. The tally also counts the run, once, if it overlaps any
 * training step.
 */
export function tallyRun(
    tally: CurveTally,
    window: TrainingWindow,
    stepSeconds: number,
    period: number,
    endedAt: number
): void {
    const first = Math.max(Math.floor(period / stepSeconds) * stepSeconds, window.from);
    const last = Math.min(Math.ceil(endedAt / stepSeconds) * stepSeconds, window.until);
    if (first < last) tally.runs++;
    for (let start = first; start < last; start += stepSeconds) {
        const end = start + stepSeconds;
        const overlap = Math.min(endedAt, end) - Math.max(period, start);
        const hour = hourOfStep(start, stepSeconds);
        tally.seconds[hour] += overlap;
        const bin = Math.max(0, Math.ceil((endedAt - end) / CURVE_BIN_SECONDS));
        if (bin < BINS) tally.counted[hour][bin] += overlap;
    }
}

/** Turns a tally into shares, or null when it holds nothing to learn from. */
export function curveFromTally(tally: CurveTally): CompletenessCurve | null {
    const overallSeconds = tally.seconds.reduce((sum, seconds) => sum + seconds, 0);
    if (overallSeconds === 0) return null;
    const overallBins = new Array<number>(BINS).fill(0);
    for (const bins of tally.counted) bins.forEach((value, bin) => (overallBins[bin] += value));
    return {
        byHour: tally.counted.map((bins, hour) => (tally.seconds[hour] === 0 ? null : cumulative(bins, tally.seconds[hour]))),
        overall: cumulative(overallBins, overallSeconds),
    };
}

/** Running share of `total` known by each bin. */
function cumulative(bins: number[], total: number): number[] {
    let running = 0;
    return bins.map((value) => (running += value) / total);
}

/**
 * The share of a step's raid time known `ageSeconds` after the step's end, for a step in
 * this hour of the day. Linear between the curve's points; held at the first before age 0
 * and at the last past the longest age. An hour with no data of its own uses the all-hours curve.
 */
export function shareAt(curve: CompletenessCurve, hour: number, ageSeconds: number): number {
    const shares = curve.byHour[hour] ?? curve.overall;
    const position = Math.min(Math.max(ageSeconds, 0), CURVE_MAX_AGE_SECONDS) / CURVE_BIN_SECONDS;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, BINS - 1);
    return shares[lower] + (shares[upper] - shares[lower]) * (position - lower);
}

/** The count a partial `observed` stands for, or null when the share is nothing to divide by. */
export function estimateTotal(observed: number, share: number): number | null {
    return share > 0 ? observed / share : null;
}

/**
 * The tallies of several sets of runs, added up as if one set had been tallied. The total's
 * curve is the sum of the raids' tallies (#199), so every run is tallied once, into its own
 * raid's tally, and the total costs a few small arrays rather than a second pass.
 */
export function sumTallies(tallies: readonly CurveTally[]): CurveTally {
    const sum = newTally();
    for (const tally of tallies) {
        sum.runs += tally.runs;
        tally.seconds.forEach((seconds, hour) => {
            sum.seconds[hour] += seconds;
            tally.counted[hour].forEach((value, bin) => (sum.counted[hour][bin] += value));
        });
    }
    return sum;
}

/**
 * How many runs a raid needs in the training week before it gets a curve of its own (#199).
 * Chosen from the per-raid backtest (docs/progress/199-per-raid-provisional.md): thinning
 * prod's raids to simulate smaller ones, the median error at 15 minutes passed 10% and the
 * 90th percentile 28% below about 5,000 runs.
 */
export const MIN_RAID_CURVE_RUNS = 5000;

/**
 * A raid's curve, or null when its tally holds fewer than `minRuns` runs: too thin a week
 * to scale up on, so the raid is shown counted and not estimated.
 */
export function raidCurveFromTally(tally: CurveTally, minRuns: number): CompletenessCurve | null {
    return tally.runs >= minRuns ? curveFromTally(tally) : null;
}
