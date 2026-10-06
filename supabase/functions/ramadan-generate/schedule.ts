import {
  cityCoordinates,
  defaultMethodFor,
  formatLocalTime,
  METHODS,
  prayerTimes,
  shiftIsoDate,
  toHijri,
} from '@thuluth/shared/prayer/index.ts';
import type {
  AsrSchool,
  CalculationMethod,
  CityInfo,
  PrayerTimes,
  Tradition,
} from '@thuluth/shared/prayer/index.ts';

import { HttpError } from '../_shared/errors.ts';
import { daysBetween } from '../_shared/plan/pipeline.ts';
import type { RamadanMeta } from '../_shared/plan/ramadan.ts';

/**
 * Ramadan dates and the daily prayer-time schedule (15 §5.2, FR-RAM-02, FR-RAM-05). Pure: the
 * computed timetable is the default source (`computed_fallback`); an Aladhan source can be added
 * behind `PrayerTimesSource` and stays off until configured (06 §4.9 lists it as primary, but no
 * outbound call is made in this release).
 */

// ---- dates -------------------------------------------------------------------------------------

/** 1 Ramadan of `hijriYear` in the Umm al-Qura calendar shifted by the household offset. */
export function firstOfMonth(hijriYear: number, month: number, offsetDays: number): string {
  // Tabular estimate, then the nearby date whose (offset) Hijri date is the 1st of the month.
  const estimate = tabularGuess(hijriYear, month);
  for (let d = -4; d <= 4; d++) {
    const date = shiftIsoDate(estimate, d);
    const h = toHijri(date, { offsetDays });
    if (h.year === hijriYear && h.month === month && h.day === 1) return date;
  }
  return estimate;
}

function tabularGuess(year: number, month: number): string {
  // Civil tabular epoch: 16 July 622 (Julian) = JD 1948439.5.
  const jd =
    Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + 1948439.5;
  return new Date(Math.round((jd - 2440587.5) * 86_400_000)).toISOString().slice(0, 10);
}

export interface RamadanDates {
  start_date: string;
  end_date: string;
  /** The calendar's start before any user correction. */
  computed_start: string;
  computed_end: string;
  corrected: boolean;
}

/** Days a user correction may move the start from the calendar (local moon sighting). */
export const MAX_START_CORRECTION_DAYS = 3;

/**
 * The Ramadan range: calendar dates by default; `start_date` / `end_date` override them for local
 * moon sighting. Ramadan is 29 or 30 days.
 */
export function ramadanDates(
  hijriYear: number,
  offsetDays: number,
  override: { start_date?: string | undefined; end_date?: string | undefined },
): RamadanDates {
  const computedStart = firstOfMonth(hijriYear, 9, offsetDays);
  const computedEnd = shiftIsoDate(firstOfMonth(hijriYear, 10, offsetDays), -1);
  const length = daysBetween(computedStart, computedEnd) + 1;
  const start = override.start_date ?? computedStart;
  if (Math.abs(daysBetween(computedStart, start)) > MAX_START_CORRECTION_DAYS) {
    throw new HttpError(
      'VALIDATION_FAILED',
      `Ramadan ${hijriYear} is expected to begin around ${computedStart}. Choose a start date within ${MAX_START_CORRECTION_DAYS} days of it.`,
      { field: 'start_date', rule: 'start_near_calendar', expected: computedStart },
    );
  }
  const end = override.end_date ?? shiftIsoDate(start, Math.min(30, Math.max(29, length)) - 1);
  const days = daysBetween(start, end) + 1;
  if (days < 29 || days > 30) {
    throw new HttpError('VALIDATION_FAILED', 'Ramadan lasts 29 or 30 days.', {
      field: 'end_date',
      rule: 'ramadan_length',
      days,
    });
  }
  return {
    start_date: start,
    end_date: end,
    computed_start: computedStart,
    computed_end: computedEnd,
    corrected: start !== computedStart || end !== computedEnd,
  };
}

// ---- calculation parameters --------------------------------------------------------------------

/** Aladhan method ids (06 §4.9 `calculation.method`) the local calculator supports. */
export const ALADHAN_METHODS: Record<number, CalculationMethod> = {
  0: 'jafari',
  1: 'karachi',
  2: 'isna',
  3: 'mwl',
  4: 'umm_al_qura',
  5: 'egyptian',
  7: 'tehran',
  16: 'dubai',
};

export interface CalcParams {
  method: CalculationMethod;
  asr: AsrSchool;
  iftar_at: 'sunset' | 'maghrib';
  suhoor_buffer_min: number;
  tradition: Tradition;
  latitude: number;
  longitude: number;
  city: string;
  time_zone: string;
  /** True when the city was not recognised and the country's main city was used. */
  location_fallback: boolean;
  high_latitude_rule: 'middle_of_the_night';
}

export function calcParams(args: {
  location: { city: string; country_code: string };
  calculation: {
    method?: number | undefined;
    asr_school?: AsrSchool | undefined;
    iftar_at?: 'sunset' | 'maghrib' | undefined;
    suhoor_buffer_min: number;
  };
  tradition: Tradition;
  timeZone: string;
}): CalcParams {
  const cc = args.location.country_code.toUpperCase();
  const exact = cityCoordinates(args.location.city, null);
  const city: CityInfo | null = exact ?? cityCoordinates(null, cc);
  if (!city) {
    throw new HttpError(
      'PRAYER_TIMES_UNAVAILABLE',
      'We could not find prayer times for this city yet. Choose the nearest large city.',
      { reason: 'unknown_city', city: args.location.city, country_code: cc },
    );
  }
  const defaults = defaultMethodFor(cc, args.tradition);
  let method = defaults.method;
  if (args.calculation.method !== undefined) {
    const m = ALADHAN_METHODS[args.calculation.method];
    if (!m) {
      throw new HttpError('VALIDATION_FAILED', 'This calculation method is not supported yet.', {
        field: 'calculation.method',
        rule: 'method_unsupported',
        supported: Object.keys(ALADHAN_METHODS).map(Number),
      });
    }
    method = m;
  }
  return {
    method,
    asr: args.calculation.asr_school ?? (method === defaults.method ? defaults.asr : 'standard'),
    // 06 §4.9: Maghrib for a Shia preference (several minutes after sunset with Ja'fari angles);
    // for the other methods Maghrib is sunset, so the default is the same instant.
    iftar_at:
      args.calculation.iftar_at ?? (METHODS[method].tradition === 'shia' ? 'maghrib' : 'sunset'),
    suhoor_buffer_min: args.calculation.suhoor_buffer_min,
    tradition: args.tradition,
    latitude: city.latitude,
    longitude: city.longitude,
    city: city.name,
    time_zone: args.timeZone,
    location_fallback: !exact,
    high_latitude_rule: 'middle_of_the_night',
  };
}

// ---- daily schedule ----------------------------------------------------------------------------

export type SuhoorStrategy = 'just_before_fajr' | 'after_tahajjud' | 'before_sleep';

/** One `ramadan_plans.prayer_times` entry: local `HH:mm` in the household time zone. */
export interface DaySchedule {
  date: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  /** Fajr minus the suhoor buffer: last sips (display and reminder only; the fast begins at Fajr). */
  imsak: string;
  suhoor: string;
  iftar: string;
  /** Main iftar meal 20 to 30 minutes after opening with dates and water (15 §5.3). */
  iftar_meal: string;
  taraweeh_snack: string;
  breakfast: string;
  lunch: string;
}

export interface PrayerTimesSource {
  readonly name: 'aladhan' | 'cache' | 'computed_fallback';
  day(date: string, params: CalcParams): PrayerTimes;
}

/** The local astronomical calculator (`packages/shared/src/prayer`). */
export const computedSource: PrayerTimesSource = {
  name: 'computed_fallback',
  day(date, params) {
    return prayerTimes(
      date,
      { latitude: params.latitude, longitude: params.longitude },
      {
        method: params.method,
        asr: params.asr,
        highLatitudeRule: params.high_latitude_rule,
        ramadan: true,
      },
    );
  },
};

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

/** Daily schedule for every Ramadan date (15 §5.2 table). */
export function buildSchedule(
  dates: { start_date: string; end_date: string },
  params: CalcParams,
  strategy: SuhoorStrategy,
  source: PrayerTimesSource = computedSource,
): DaySchedule[] {
  const out: DaySchedule[] = [];
  const tz = params.time_zone;
  const days = daysBetween(dates.start_date, dates.end_date) + 1;
  for (let i = 0; i < days; i++) {
    const date = shiftIsoDate(dates.start_date, i);
    let t: PrayerTimes;
    try {
      t = source.day(date, params);
    } catch {
      throw new HttpError(
        'PRAYER_TIMES_UNAVAILABLE',
        'Prayer times could not be calculated for this place and date.',
        { date },
      );
    }
    const local = (d: Date) => formatLocalTime(d, tz);
    const fajr = minutes(local(t.fajr));
    const isha = minutes(local(t.isha));
    const iftar = minutes(local(params.iftar_at === 'maghrib' ? t.maghrib : t.sunset));
    const imsak = fajr - params.suhoor_buffer_min;
    // Suhoor slot Fajr-45 to Fajr-15 (15 §5.2): the meal starts 30 minutes before imsak.
    const suhoor =
      strategy === 'just_before_fajr'
        ? imsak - 30
        : strategy === 'after_tahajjud'
          ? fajr - 90
          : Math.min(isha + 120, 23 * 60 + 30);
    out.push({
      date,
      fajr: hhmm(fajr),
      sunrise: local(t.sunrise),
      dhuhr: local(t.dhuhr),
      asr: local(t.asr),
      maghrib: local(t.maghrib),
      isha: hhmm(isha),
      imsak: hhmm(imsak),
      suhoor: hhmm(suhoor),
      iftar: hhmm(iftar),
      iftar_meal: hhmm(iftar + 25),
      // Taraweeh is about an hour after Isha starts; the light snack follows it.
      taraweeh_snack: hhmm(Math.min(isha + 90, 23 * 60 + 45)),
      breakfast: '08:00',
      lunch: hhmm(Math.max(minutes(local(t.dhuhr)) + 30, 13 * 60)),
    });
  }
  return out;
}

/** `RamadanMeta.times` for the plan pipeline. */
export function slotTimes(schedule: readonly DaySchedule[]): RamadanMeta['times'] {
  const out: RamadanMeta['times'] = {};
  for (const d of schedule) {
    out[d.date] = {
      suhoor: d.suhoor,
      breakfast: d.breakfast,
      lunch: d.lunch,
      snack: d.taraweeh_snack,
      // The iftar slot opens with dates and water at iftar time; the meal follows.
      iftar: d.iftar,
    };
  }
  return out;
}
