import { describe, expect, it } from 'vitest';
import { clock, dayLabel, describeTimeZone, formatInstant, formatStepWindow, readerOffsetOf, type OffsetOf } from './activity-time';

/**
 * The Raid Activity chart's clock labels in a reader's time zone (#197), or in UTC when there
 * is no offset (JavaScript off, or the server render). Pure and colocated: a label an hour or
 * a day off still reads as a plausible time, so every expected string below is worked out by
 * hand from the instant and the offset, not by re-running the module's own arithmetic.
 *
 * Offsets are minutes east of UTC at the instant asked about, as `-getTimezoneOffset()` gives
 * them, so a zone that changes its clock is a function of the instant rather than one number.
 */

const HOUR = 3600;

// Sat 17 Oct 2026, 00:00 UTC.
const MIDNIGHT = 1792195200;

const INDIA: OffsetOf = () => 5 * 60 + 30;
const KATHMANDU: OffsetOf = () => 5 * 60 + 45;
const PACIFIC: OffsetOf = () => -8 * 60;
// London on 25 Oct 2026, when summer time ends at 01:00 UTC: the clock reads 01:00 twice.
const DST_ENDS = 1792890000;
const LONDON: OffsetOf = (at) => (at < DST_ENDS ? 60 : 0);

describe('a step window', () => {
    it('is in UTC, with the suffix, when there is no offset', () => {
        expect(formatStepWindow(MIDNIGHT + HOUR, MIDNIGHT + 2 * HOUR, null)).toBe('Sat 17 Oct, 01:00–02:00 UTC');
        // Across midnight the window still reads as one evening's hour.
        expect(formatStepWindow(MIDNIGHT - HOUR, MIDNIGHT, null)).toBe('Fri 16 Oct, 23:00–00:00 UTC');
    });

    it('is in UTC when no offset is given at all', () => {
        expect(formatStepWindow(MIDNIGHT + HOUR, MIDNIGHT + 2 * HOUR)).toBe('Sat 17 Oct, 01:00–02:00 UTC');
    });

    it('moves by a half-hour offset, with no suffix', () => {
        // India is UTC+5:30: the UTC hour 23:00–00:00 on Friday is 04:30–05:30 on Saturday.
        expect(formatStepWindow(MIDNIGHT - HOUR, MIDNIGHT, INDIA)).toBe('Sat 17 Oct, 04:30–05:30');
    });

    it('moves by a quarter-hour offset, with no suffix', () => {
        // Kathmandu is UTC+5:45: the UTC hour 23:00–00:00 on Friday is 04:45–05:45 on Saturday.
        expect(formatStepWindow(MIDNIGHT - HOUR, MIDNIGHT, KATHMANDU)).toBe('Sat 17 Oct, 04:45–05:45');
    });

    it('names the end\'s weekday when the window crosses local midnight', () => {
        // 18:00–19:00 UTC on Friday is 23:45 Friday to 00:45 Saturday in Kathmandu.
        expect(formatStepWindow(MIDNIGHT - 6 * HOUR, MIDNIGHT - 5 * HOUR, KATHMANDU)).toBe('Fri 16 Oct, 23:45–Sat 00:45');
    });

    it('does not name a weekday for an end exactly at local midnight', () => {
        // 07:00–08:00 UTC on Saturday is 23:00–00:00 in UTC-8: the window belongs to Friday.
        expect(formatStepWindow(MIDNIGHT + 7 * HOUR, MIDNIGHT + 8 * HOUR, PACIFIC)).toBe('Fri 16 Oct, 23:00–00:00');
    });

    it('goes back a day for a zone west of UTC', () => {
        expect(formatStepWindow(MIDNIGHT, MIDNIGHT + HOUR, PACIFIC)).toBe('Fri 16 Oct, 16:00–17:00');
    });

    it('reads the offset at each end, so a window across a clock change shows the clock', () => {
        // 00:00–02:00 UTC on 25 Oct: 01:00 summer time at the start, 02:00 winter time at the end.
        expect(formatStepWindow(DST_ENDS - HOUR, DST_ENDS + HOUR, LONDON)).toBe('Sun 25 Oct, 01:00–02:00');
    });
});

describe('an instant', () => {
    it('is in UTC with the suffix, or in the reader\'s zone without it', () => {
        const at = MIDNIGHT - 21 * 24 * HOUR + 6 * HOUR;
        expect(formatInstant(at, null)).toBe('Sat 26 Sep, 06:00 UTC');
        expect(formatInstant(at, KATHMANDU)).toBe('Sat 26 Sep, 11:45');
    });

    it('names the date the zone is on: the second before midnight is the day before', () => {
        expect(formatInstant(MIDNIGHT, null)).toBe('Sat 17 Oct, 00:00 UTC');
        expect(formatInstant(MIDNIGHT - 1, null)).toBe('Fri 16 Oct, 23:59 UTC');
        expect(formatInstant(MIDNIGHT, KATHMANDU)).toBe('Sat 17 Oct, 05:45');
    });

    it('carries into the next month in a zone east of UTC', () => {
        // 20:00 UTC on Saturday 31 Oct is 01:45 on Sunday 1 Nov in Kathmandu.
        expect(formatInstant(1793476800, KATHMANDU)).toBe('Sun 1 Nov, 01:45');
    });

    it('reads 01:00 twice across the clock change, one hour apart', () => {
        expect(formatInstant(DST_ENDS - HOUR, LONDON)).toBe('Sun 25 Oct, 01:00');
        expect(formatInstant(DST_ENDS, LONDON)).toBe('Sun 25 Oct, 01:00');
    });
});

describe('the pieces a tick label is made of', () => {
    it('names the day and the date as the zone sees them', () => {
        expect(dayLabel(MIDNIGHT, null)).toBe('Sat 17');
        expect(dayLabel(MIDNIGHT, PACIFIC)).toBe('Fri 16');
    });

    it('reads the hour and minute in the zone', () => {
        expect(clock(MIDNIGHT + 21 * HOUR, null)).toBe('21:00');
        expect(clock(MIDNIGHT + 21 * HOUR, KATHMANDU)).toBe('02:45');
        expect(clock(MIDNIGHT + 21 * HOUR, PACIFIC)).toBe('13:00');
    });
});

describe('the offset the page reads its labels with', () => {
    // The intro names the zone or says "Times are UTC."; the labels must agree with it.
    const browser = () => 345;

    it('is the browser\'s when the browser names its zone', () => {
        expect(formatInstant(MIDNIGHT, readerOffsetOf('Asia/Kathmandu', browser))).toBe('Sat 17 Oct, 05:45');
    });

    it('is none, so every label is UTC and says so, when the browser names no zone', () => {
        expect(formatInstant(MIDNIGHT, readerOffsetOf(null, browser))).toBe('Sat 17 Oct, 00:00 UTC');
    });
});

describe('the sentence naming the time zone', () => {
    it('says UTC when no zone is known', () => {
        expect(describeTimeZone(null)).toBe('Times are UTC.');
    });

    it('names the reader\'s zone', () => {
        expect(describeTimeZone('Asia/Kathmandu')).toBe('Times are in your time zone (Asia/Kathmandu).');
    });
});
