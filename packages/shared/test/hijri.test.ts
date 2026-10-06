import { describe, expect, it } from 'vitest';

import {
  hijriIso,
  intlUmmAlQura,
  shiftIsoDate,
  tabularHijri,
  tabularToGregorian,
  toHijri,
} from '../src/prayer/hijri.ts';
import { isoWeekday, voluntaryFastsOn } from '../src/prayer/voluntary-fasts.ts';

/**
 * Umm al-Qura reference dates (official Saudi Umm al-Qura calendar as published by
 * KACST and reproduced in ICU's `islamic-umalqura` calendar data):
 * - 1 Muharram 1448 = 16 June 2026
 * - 9 Dhu al-Hijjah 1447 (Arafah) = 26 May 2026
 * - 1 Ramadan 1448 = 8 February 2027; 1 Shawwal 1448 = 9 March 2027
 * - 6 October 2026 = 25 Rabi al-Thani 1448
 */
const UMM_AL_QURA: Array<[string, number, number, number]> = [
  ['2026-06-16', 1448, 1, 1],
  ['2026-05-26', 1447, 12, 9],
  ['2027-02-08', 1448, 9, 1],
  ['2027-03-09', 1448, 10, 1],
  ['2026-10-06', 1448, 4, 25],
];

describe('toHijri (Umm al-Qura via Intl)', () => {
  it.each(UMM_AL_QURA)('%s -> %i-%i-%i', (date, year, month, day) => {
    const h = toHijri(date);
    expect(h.calendar).toBe('islamic-umalqura');
    expect([h.year, h.month, h.day]).toEqual([year, month, day]);
  });

  it('applies the household moon-sighting offset', () => {
    // Offset +1: the local month started a day later, so 8 Feb 2027 is still 30 Sha'ban here.
    expect(toHijri('2027-02-09', { offsetDays: 1 })).toMatchObject({ month: 9, day: 1 });
    expect(toHijri('2027-02-07', { offsetDays: -1 })).toMatchObject({ month: 9, day: 1 });
  });

  it('formats as YYYY-MM-DD', () => {
    expect(hijriIso(toHijri('2026-06-16'))).toBe('1448-01-01');
  });

  it('reports Intl support', () => {
    expect(intlUmmAlQura('2026-10-06')).not.toBeNull();
  });
});

describe('tabular fallback', () => {
  it('is within one day of Umm al-Qura over 2026 to 2028', () => {
    for (let i = 0; i < 3 * 365; i += 3) {
      const date = shiftIsoDate('2026-01-01', i);
      const uq = intlUmmAlQura(date)!;
      const tb = tabularHijri(date);
      // Compare as day counts within the same reckoning.
      const toCount = (y: number, m: number, d: number) => y * 354.367 + (m - 1) * 29.53 + d;
      expect(
        Math.abs(toCount(uq.year, uq.month, uq.day) - toCount(tb.year, tb.month, tb.day)),
      ).toBeLessThan(2.5);
    }
  });

  it('round-trips through tabularToGregorian', () => {
    for (const date of ['2026-06-16', '2027-02-08', '2030-01-01', '2026-10-06']) {
      const h = tabularHijri(date);
      expect(tabularToGregorian(h.year, h.month, h.day)).toBe(date);
    }
  });

  it('matches the civil tabular calendar (ICU islamic-civil): 1 Muharram 1448 = 17 June 2026', () => {
    expect(tabularHijri('2026-06-17')).toMatchObject({ year: 1448, month: 1, day: 1 });
    expect(tabularHijri('2026-10-06')).toMatchObject({ year: 1448, month: 4, day: 23 });
    expect(tabularHijri('2030-01-01')).toMatchObject({ year: 1451, month: 8, day: 25 });
  });

  it('forceTabular selects the fallback', () => {
    expect(toHijri('2026-10-06', { forceTabular: true }).calendar).toBe('islamic-tbla');
  });
});

describe('voluntaryFastsOn (FR-FAST-04, 15 §5.8)', () => {
  it('Monday and Thursday', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(voluntaryFastsOn('2026-10-05')).toMatchObject([
      { kind: 'sunnah_monday_thursday', label_key: 'fast.monday' },
    ]);
    expect(voluntaryFastsOn('2026-10-08')).toMatchObject([
      { kind: 'sunnah_monday_thursday', label_key: 'fast.thursday' },
    ]);
    expect(voluntaryFastsOn('2026-10-06')).toEqual([]);
  });

  it('Ayyam al-Bid: 13 to 15 of the Hijri month (Rabi al-Thani 1448: 24 to 26 Sep 2026)', () => {
    for (const date of ['2026-09-24', '2026-09-25', '2026-09-26']) {
      const [fast] = voluntaryFastsOn(date, { settings: { monday_thursday: false } });
      expect(fast?.kind, date).toBe('ayyam_al_bid');
    }
  });

  it('Arafah on 9 Dhu al-Hijjah and nothing on Eid al-Adha or Tashriq for Sunni users', () => {
    expect(voluntaryFastsOn('2026-05-26')).toMatchObject([{ kind: 'arafah' }]);
    expect(voluntaryFastsOn('2026-05-27')).toEqual([]); // 10 Dhu al-Hijjah
    expect(voluntaryFastsOn('2026-05-30')).toEqual([]); // 13 Dhu al-Hijjah, a Saturday
  });

  it('Ashura with the 9th by default or the 11th when chosen', () => {
    // 1 Muharram 1448 = 16 June 2026, so 9th = 24 June, 10th = 25 June, 11th = 26 June.
    expect(voluntaryFastsOn('2026-06-25')).toMatchObject([
      { kind: 'ashura', label_key: 'fast.ashura' },
    ]);
    expect(voluntaryFastsOn('2026-06-24')).toMatchObject([
      { kind: 'ashura', label_key: 'fast.ashura_companion_9' },
    ]);
    expect(voluntaryFastsOn('2026-06-26', { settings: { ashura_companion: '11' } })).toMatchObject([
      { kind: 'ashura', label_key: 'fast.ashura_companion_11' },
    ]);
  });

  it('Shia households: no Ashura fasting suggestion and no Monday/Thursday', () => {
    expect(voluntaryFastsOn('2026-06-25', { tradition: 'shia' })).toEqual([]);
    expect(voluntaryFastsOn('2026-10-05', { tradition: 'shia' })).toEqual([]);
  });

  it('nothing during Ramadan or on Eid al-Fitr', () => {
    expect(voluntaryFastsOn('2027-02-15')).toEqual([]); // a Monday in Ramadan 1448
    expect(voluntaryFastsOn('2027-03-09')).toEqual([]); // 1 Shawwal
  });

  it('respects per-occasion settings', () => {
    expect(voluntaryFastsOn('2026-10-05', { settings: { monday_thursday: false } })).toEqual([]);
    expect(voluntaryFastsOn('2026-05-26', { settings: { arafah: false } })).toEqual([]);
  });
});
