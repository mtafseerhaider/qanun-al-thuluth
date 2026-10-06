/**
 * Hijri dates (15 §5.2): Umm al-Qura through `Intl` (`islamic-umalqura`) where the runtime ships
 * the calendar (Node, Deno, browsers, iOS JSC), with the tabular (arithmetic, "Kuwaiti") Islamic
 * calendar as the fallback (Hermes builds without ICU calendars). The tabular calendar can differ
 * from Umm al-Qura by a day either way; both can differ from local moon sighting, which
 * `households.hijri_offset_days` (-2..2) corrects.
 */

export interface HijriDate {
  year: number;
  /** 1 = Muharram ... 9 = Ramadan, 12 = Dhu al-Hijjah. */
  month: number;
  day: number;
  calendar: 'islamic-umalqura' | 'islamic-tbla';
}

export const HIJRI_MONTHS = [
  'muharram',
  'safar',
  'rabi_al_awwal',
  'rabi_al_thani',
  'jumada_al_ula',
  'jumada_al_akhirah',
  'rajab',
  'shaban',
  'ramadan',
  'shawwal',
  'dhu_al_qadah',
  'dhu_al_hijjah',
] as const;

function parseIso(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Adds days to a `YYYY-MM-DD` date. */
export function shiftIsoDate(date: string, days: number): string {
  const { y, m, d } = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---- tabular Islamic calendar (civil epoch, 16 July 622 Julian; leap years 2,5,7,10,13,16,18,21,24,26,29)

const ISLAMIC_EPOCH = 1948439.5;

function gregorianToJd(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 86_400_000 + 2440587.5;
}

function islamicToJd(year: number, month: number, day: number): number {
  return (
    day +
    Math.ceil(29.5 * (month - 1)) +
    (year - 1) * 354 +
    Math.floor((3 + 11 * year) / 30) +
    ISLAMIC_EPOCH -
    1
  );
}

/** Tabular Hijri date of a Gregorian `YYYY-MM-DD`. */
export function tabularHijri(date: string): HijriDate {
  const { y, m, d } = parseIso(date);
  const jd = Math.floor(gregorianToJd(y, m, d)) + 0.5;
  const year = Math.floor((30 * (jd - ISLAMIC_EPOCH) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((jd - (29 + islamicToJd(year, 1, 1))) / 29.5) + 1);
  const day = jd - islamicToJd(year, month, 1) + 1;
  return { year, month, day, calendar: 'islamic-tbla' };
}

/** Gregorian `YYYY-MM-DD` of a tabular Hijri date. */
export function tabularToGregorian(year: number, month: number, day: number): string {
  const ms = (islamicToJd(year, month, day) - 2440587.5) * 86_400_000;
  return new Date(Math.round(ms)).toISOString().slice(0, 10);
}

// ---- Umm al-Qura via Intl ---------------------------------------------------------------------------

let formatter: Intl.DateTimeFormat | null | undefined;

function umalquraFormatter(): Intl.DateTimeFormat | null {
  if (formatter !== undefined) return formatter;
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    formatter = f.resolvedOptions().calendar === 'islamic-umalqura' ? f : null;
  } catch {
    formatter = null;
  }
  return formatter;
}

/** Umm al-Qura date from Intl, or null when the runtime lacks the calendar. */
export function intlUmmAlQura(date: string): HijriDate | null {
  const f = umalquraFormatter();
  if (!f) return null;
  const { y, m, d } = parseIso(date);
  const parts = f.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
  const num = (type: string) =>
    Number((parts.find((p) => p.type === type)?.value ?? '').replace(/\D/g, ''));
  const year = num('year');
  const month = num('month');
  const day = num('day');
  if (!year || !month || !day) return null;
  return { year, month, day, calendar: 'islamic-umalqura' };
}

/**
 * Hijri date of a local Gregorian date. `offsetDays` is the household moon-sighting adjustment:
 * +1 means the local Hijri date is one day behind Umm al-Qura's (the month started a day later).
 */
export function toHijri(
  date: string,
  opts: { offsetDays?: number; forceTabular?: boolean } = {},
): HijriDate {
  const offset = Math.max(-2, Math.min(2, Math.trunc(opts.offsetDays ?? 0)));
  const shifted = offset ? shiftIsoDate(date, -offset) : date;
  return (!opts.forceTabular && intlUmmAlQura(shifted)) || tabularHijri(shifted);
}

/** `YYYY-MM-DD` form of a Hijri date (stored in `fasting_logs.hijri_date`, 15 §5.1). */
export const hijriIso = (h: HijriDate): string =>
  `${String(h.year).padStart(4, '0')}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
