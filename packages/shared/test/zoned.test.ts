import { describe, expect, it } from 'vitest';

import {
  localDate,
  localMinutes,
  parseHhmm,
  timeZoneOffsetMin,
  zonedTimeToInstant,
} from '../src/prayer/zoned.ts';

describe('zoned time helpers', () => {
  it('converts Pakistan local time (UTC+5, no DST)', () => {
    expect(zonedTimeToInstant('2026-10-06', '12:30', 'Asia/Karachi').toISOString()).toBe(
      '2026-10-06T07:30:00.000Z',
    );
    expect(timeZoneOffsetMin(new Date('2026-10-06T00:00:00Z'), 'Asia/Karachi')).toBe(300);
  });

  it('handles London summer and winter time', () => {
    expect(zonedTimeToInstant('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(zonedTimeToInstant('2026-12-01', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-12-01T09:00:00.000Z',
    );
    // 2027-03-28 01:30 does not exist in London; it moves forward to 02:30 BST (01:30Z).
    expect(zonedTimeToInstant('2027-03-28', '01:30', 'Europe/London').toISOString()).toBe(
      '2027-03-28T01:30:00.000Z',
    );
    // 2026-10-25 01:30 happens twice in London; the earlier (BST) instant wins.
    expect(zonedTimeToInstant('2026-10-25', '01:30', 'Europe/London').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('reads local date and minutes across midnight', () => {
    const instant = new Date('2026-10-06T20:30:00Z');
    expect(localDate(instant, 'Asia/Karachi')).toBe('2026-10-07');
    expect(localMinutes(instant, 'Asia/Karachi')).toBe(90);
    expect(localDate(instant, 'Europe/London')).toBe('2026-10-06');
  });

  it('parses HH:mm strictly', () => {
    expect(parseHhmm('07:05')).toBe(425);
    expect(parseHhmm('12:30:00')).toBe(750);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('noon')).toBeNull();
    expect(parseHhmm(null)).toBeNull();
  });
});
