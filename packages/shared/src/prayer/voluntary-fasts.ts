import { toHijri } from './hijri.ts';
import type { HijriDate } from './hijri.ts';

/**
 * Voluntary fast days (FR-FAST-04, 15 §5.8): Monday and Thursday, Ayyam al-Bid (13 to 15 of each
 * Hijri month except Ramadan), Arafah (9 Dhu al-Hijjah) and Ashura (10 Muharram with the 9th or
 * 11th alongside). Days on which fasting is not suggested are never returned: Ramadan (obligatory
 * fast), 1 Shawwal, 10 Dhu al-Hijjah and, for Sunni users, 11 to 13 Dhu al-Hijjah (Ayyam
 * al-Tashriq). For a Shia household (15 §5.8) Ashura is a day of mourning without a fasting
 * suggestion and Monday/Thursday are not suggested (pending scholar review). The app suggests;
 * it never rules (00 §10).
 */

export type VoluntaryFastKind = 'sunnah_monday_thursday' | 'ayyam_al_bid' | 'arafah' | 'ashura';

export interface VoluntaryFastSettings {
  monday_thursday?: boolean;
  ayyam_al_bid?: boolean;
  arafah?: boolean;
  ashura?: boolean;
  /** Companion day for Ashura: 9 Muharram (default) or 11 Muharram. */
  ashura_companion?: '9' | '11';
}

export interface VoluntaryFast {
  date: string;
  kind: VoluntaryFastKind;
  /** i18n key, e.g. `fast.ayyam_al_bid`. */
  label_key: string;
  hijri: HijriDate;
}

export type Tradition = 'shared' | 'sunni' | 'shia';

/** ISO weekday of a `YYYY-MM-DD` date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function voluntaryFastsOn(
  date: string,
  opts: {
    tradition?: Tradition;
    hijriOffsetDays?: number;
    settings?: VoluntaryFastSettings;
    forceTabular?: boolean;
  } = {},
): VoluntaryFast[] {
  const tradition = opts.tradition ?? 'shared';
  const s = opts.settings ?? {};
  const on = (k: keyof Omit<VoluntaryFastSettings, 'ashura_companion'>) => s[k] !== false;
  const hijri = toHijri(date, {
    offsetDays: opts.hijriOffsetDays ?? 0,
    forceTabular: opts.forceTabular ?? false,
  });
  const { month, day } = hijri;

  // Days with no voluntary-fast suggestion at all.
  if (month === 9) return [];
  if (month === 10 && day === 1) return [];
  if (month === 12 && day === 10) return [];
  if (tradition !== 'shia' && month === 12 && day >= 11 && day <= 13) return [];

  const out: VoluntaryFast[] = [];
  const add = (kind: VoluntaryFastKind, labelKey: string) =>
    out.push({ date, kind, label_key: labelKey, hijri });

  if (month === 12 && day === 9 && on('arafah')) add('arafah', 'fast.arafah');
  if (tradition !== 'shia' && month === 1 && on('ashura')) {
    const companion = s.ashura_companion === '11' ? 11 : 9;
    if (day === 10) add('ashura', 'fast.ashura');
    else if (day === companion) add('ashura', `fast.ashura_companion_${companion}`);
  }
  if (day >= 13 && day <= 15 && on('ayyam_al_bid')) add('ayyam_al_bid', 'fast.ayyam_al_bid');
  const weekday = isoWeekday(date);
  if (tradition !== 'shia' && (weekday === 1 || weekday === 4) && on('monday_thursday')) {
    add('sunnah_monday_thursday', weekday === 1 ? 'fast.monday' : 'fast.thursday');
  }
  // One reminder per day: the most specific occasion first.
  return out.slice(0, 1);
}
