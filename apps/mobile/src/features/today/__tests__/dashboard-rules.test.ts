import {
  formatHijriDate,
  formatLongDate,
  formatUpdatedAt,
  greetingFor,
  tipForDay,
} from '../utils/dashboard-rules';

describe('Today helpers (24 S3-11)', () => {
  it('greets by time of day', () => {
    expect(greetingFor(7 * 60)).toBe('morning');
    expect(greetingFor(13 * 60)).toBe('afternoon');
    expect(greetingFor(20 * 60)).toBe('evening');
  });

  it('rotates the tip of the day and handles none', () => {
    expect(tipForDay([], 5)).toBeNull();
    expect(tipForDay(['a', 'b', 'c'], 0)).toBe('a');
    expect(tipForDay(['a', 'b', 'c'], 4)).toBe('b');
    expect(tipForDay(['a', 'b', 'c'], -1)).toBe('c');
  });

  it('formats dates and never throws for the Hijri calendar', () => {
    expect(formatLongDate('2026-10-06', 'en')).toMatch(/October/);
    const hijri = formatHijriDate('2026-10-06', 'en');
    expect(hijri === null || typeof hijri === 'string').toBe(true);
    expect(formatUpdatedAt(0)).toBeNull();
    expect(formatUpdatedAt(new Date(2026, 9, 6, 9, 5).getTime())).toBe('09:05');
  });
});
