import {
  addDays,
  dateRange,
  dayNumber,
  formatTime,
  localIsoDate,
  localMinutes,
  timeToMinutes,
  weekday,
} from '../local-date';

describe('household-local dates (02 §3.3)', () => {
  // 2026-10-06 21:30 UTC is already 2026-10-07 02:30 in Karachi (UTC+5).
  const now = new Date('2026-10-06T21:30:00Z');

  it('computes today and the minute of day in the household time zone', () => {
    expect(localIsoDate('Asia/Karachi', now)).toBe('2026-10-07');
    expect(localMinutes('Asia/Karachi', now)).toBe(2 * 60 + 30);
    expect(localIsoDate('Europe/London', now)).toBe('2026-10-06');
  });

  it('falls back to device time for a missing or bad zone', () => {
    expect(localIsoDate('Not/AZone', now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(localIsoDate(null, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does calendar arithmetic without zone drift', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dateRange('2026-10-06', '2026-10-08')).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ]);
    expect(weekday('2026-10-06')).toBe(2);
    expect(dayNumber('1970-01-02')).toBe(1);
  });

  it('parses and formats meal times', () => {
    expect(timeToMinutes('13:05:00')).toBe(785);
    expect(timeToMinutes('nope')).toBeNull();
    expect(formatTime('7:5')).toBeNull();
    expect(formatTime('07:05:00')).toBe('07:05');
  });
});
