import type { ArchiveRangeTimeline, ArchiveTimelineMonth } from '@/lib/db/archive/queries';
import { plural } from './plural-copy';
import { formatArchiveMonth, formatTimelineBucketLabel } from './range-copy';

/**
 * What the timeline's hover tooltips say (#114): one pair of strings per bucket, one for
 * the cumulative line and one for the bar.
 *
 * **Worked out on the server and handed to the client as plain strings.** The tooltip is
 * the page's first client JavaScript, and everything the client file imports is shipped
 * to the browser — so it imports none of this. The client component only decides *which*
 * bucket is under the pointer and where to put the box; what the box says is decided
 * here, beside the page that read the data, in the same formatters every other date and
 * count on the page goes through.
 *
 * **Both of the main chart's data shapes become this one shape**, so the client never
 * branches on whether a range is active: the whole Archive's months unfiltered, and the
 * range's own buckets under a range.
 */
export interface TimelineTooltip {
    /** `Clear 4,388 · Mar 2021` — the Clear Number the line has reached by the bucket's end. */
    line: string;
    /** `Mar 2021 · 268 clears · #4,121–#4,388` — the bucket's clears and the span they hold. */
    bar: string;
}

/** The unfiltered chart's tooltips: every month of the Archive, counted from clear 1. */
export function wholeArchiveTooltips(months: ArchiveTimelineMonth[]): TimelineTooltip[] {
    return tooltipsFor(
        months.map((month) => ({ ...month, label: formatArchiveMonth(month.month) })),
        0
    );
}

/**
 * The zoomed chart's tooltips: the range's own buckets, labelled by their size, counted
 * from the Clear Number the Archive had reached when the range opens.
 */
export function zoomedTooltips({ size, buckets, clearsBefore }: ArchiveRangeTimeline): TimelineTooltip[] {
    return tooltipsFor(
        buckets.map((bucket) => ({ ...bucket, label: formatTimelineBucketLabel(size, bucket.start) })),
        clearsBefore
    );
}

/** A bucket as the tooltip reads it, whichever read it came from. */
interface LabelledBucket {
    label: string;
    clears: number;
    cumulativeClears: number;
}

/**
 * The tooltips for a run of buckets, where `clearsBefore` is the Clear Number reached
 * before the first of them.
 *
 * A bar's span is not stored anywhere: it runs from one past the previous bucket's
 * cumulative Clear Number to its own. Clear Numbers are dense within the Pinned rule
 * (ADR 0008), so that is exactly the set of clears the bar counts.
 */
function tooltipsFor(buckets: LabelledBucket[], clearsBefore: number): TimelineTooltip[] {
    let reached = clearsBefore;
    return buckets.map((bucket) => {
        const first = reached + 1;
        reached = bucket.cumulativeClears;
        return { line: lineCopy(bucket), bar: barCopy(bucket, first) };
    });
}

function lineCopy({ label, cumulativeClears }: LabelledBucket): string {
    // "Clear 0" would name a clear that does not exist.
    if (cumulativeClears === 0) return `No clears yet · ${label}`;
    return `Clear ${cumulativeClears.toLocaleString()} · ${label}`;
}

function barCopy({ label, clears, cumulativeClears }: LabelledBucket, first: number): string {
    // An empty bucket holds no Clear Numbers, so there is no span to name.
    if (clears === 0) return `${label} · no clears`;
    const count = `${clears.toLocaleString()} ${plural(clears, 'clear', 'clears')}`;
    const span =
        first === cumulativeClears
            ? `#${first.toLocaleString()}`
            : `#${first.toLocaleString()}–#${cumulativeClears.toLocaleString()}`;
    return `${label} · ${count} · ${span}`;
}
