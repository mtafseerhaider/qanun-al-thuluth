import { asrAltitude, hourAngle, julianDay, solarPosition } from './astronomy.ts';
import { METHODS } from './methods.ts';
import type { AsrSchool, CalculationMethod, HighLatitudeRule, MethodParams } from './methods.ts';

/**
 * Daily prayer times (FR-FAST-05, 15 §5.2), computed astronomically for a local calendar date and
 * a coordinate. Results are UTC instants rounded to the nearest minute; format them in the
 * household time zone with `formatLocalTime`. No time-zone arithmetic happens here, so the same
 * code works in Deno, Node and React Native.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Metres above sea level; lowers the sunrise and sunset altitude slightly. Default 0. */
  elevationM?: number;
}

export interface PrayerParams {
  method: CalculationMethod;
  /** Default: 'hanafi' for the Karachi method, 'standard' otherwise. */
  asr?: AsrSchool;
  /** Applied when Fajr or Isha is undefined or later than the rule allows. */
  highLatitudeRule?: HighLatitudeRule;
  /** Umm al-Qura lengthens the Isha interval in Ramadan. */
  ramadan?: boolean;
  /** Manual per-prayer adjustments in minutes (local moon-sighting committees, user tweaks). */
  adjustmentsMin?: Partial<Record<PrayerName, number>>;
}

export const PRAYER_NAMES = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = (typeof PRAYER_NAMES)[number];

export interface PrayerTimes {
  date: string;
  method: CalculationMethod;
  asr_school: AsrSchool;
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  /** Geometric sunset (sun's upper limb on the horizon). */
  sunset: Date;
  maghrib: Date;
  isha: Date;
}

const SUNRISE_ALTITUDE = -0.8333; // refraction 34' plus solar semi-diameter 16'

function parseDate(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/**
 * Solver for one day: hours are UT hours counted from 0h UT of the local calendar date (they may
 * be negative or above 24 for longitudes far from Greenwich).
 */
function daySolver(date: string, coords: Coordinates) {
  const { y, m, d } = parseDate(date);
  const jd0 = julianDay(y, m, d);
  const { latitude, longitude } = coords;

  const noonAt = (hours: number) => {
    const { equationOfTimeMin } = solarPosition(jd0 + hours / 24);
    return 12 - longitude / 15 - equationOfTimeMin / 60;
  };
  let noon = 12 - longitude / 15;
  for (let i = 0; i < 3; i++) noon = noonAt(noon);

  /** Time the sun reaches `altitude` before (-1) or after (+1) transit; NaN if it never does. */
  const atAltitude = (altitude: number | ((decl: number) => number), side: -1 | 1): number => {
    let t = noon + side * 6;
    for (let i = 0; i < 4; i++) {
      const { declination } = solarPosition(jd0 + t / 24);
      const alt = typeof altitude === 'function' ? altitude(declination) : altitude;
      const h = hourAngle(alt, latitude, declination);
      if (Number.isNaN(h)) return Number.NaN;
      t = noonAt(t) + (side * h) / 15;
    }
    return t;
  };
  return { noon, atAltitude, utcMidnightMs: Date.UTC(y, m - 1, d) };
}

const NIGHT_PORTION: Record<HighLatitudeRule, (angle: number) => number> = {
  middle_of_the_night: () => 1 / 2,
  seventh_of_the_night: () => 1 / 7,
  twilight_angle: (angle) => angle / 60,
};

export function prayerTimes(date: string, coords: Coordinates, params: PrayerParams): PrayerTimes {
  const method: MethodParams = METHODS[params.method];
  const asrSchool: AsrSchool = params.asr ?? (params.method === 'karachi' ? 'hanafi' : 'standard');
  const rule: HighLatitudeRule = params.highLatitudeRule ?? 'middle_of_the_night';
  const { noon, atAltitude, utcMidnightMs } = daySolver(date, coords);
  const horizon = SUNRISE_ALTITUDE - 0.0347 * Math.sqrt(Math.max(0, coords.elevationM ?? 0));

  const sunrise = atAltitude(horizon, -1);
  const sunset = atAltitude(horizon, 1);
  if (Number.isNaN(sunrise) || Number.isNaN(sunset)) {
    throw new Error('PRAYER_TIMES_UNAVAILABLE: the sun does not rise or set on this date');
  }
  const factor = asrSchool === 'hanafi' ? 2 : 1;
  const asr = atAltitude((decl) => asrAltitude(factor, coords.latitude, decl), 1);
  const night = 24 - (sunset - sunrise);

  let fajr = atAltitude(-method.fajrAngle, -1);
  const safeFajr = sunrise - NIGHT_PORTION[rule](method.fajrAngle) * night;
  if (Number.isNaN(fajr) || safeFajr > fajr) fajr = safeFajr;

  const maghrib = method.maghribAngle !== undefined ? atAltitude(-method.maghribAngle, 1) : sunset;

  let isha: number;
  if (method.ishaAngle !== undefined) {
    isha = atAltitude(-method.ishaAngle, 1);
    const safeIsha = sunset + NIGHT_PORTION[rule](method.ishaAngle) * night;
    if (Number.isNaN(isha) || safeIsha < isha) isha = safeIsha;
  } else {
    const interval =
      params.ramadan && method.ishaIntervalRamadanMin
        ? method.ishaIntervalRamadanMin
        : (method.ishaIntervalMin ?? 90);
    isha = (Number.isNaN(maghrib) ? sunset : maghrib) + interval / 60;
  }

  const offsets = method.offsets ?? {};
  const adj = params.adjustmentsMin ?? {};
  const at = (hours: number, name: PrayerName, methodMin = 0): Date => {
    const minutes = hours * 60 + methodMin + (adj[name] ?? 0);
    // Nearest minute (published timetables print whole minutes).
    return new Date(utcMidnightMs + Math.round(minutes) * 60_000);
  };
  return {
    date,
    method: params.method,
    asr_school: asrSchool,
    fajr: at(fajr, 'fajr'),
    sunrise: at(sunrise, 'sunrise', offsets.sunrise ?? 0),
    dhuhr: at(noon, 'dhuhr', method.dhuhrOffsetMin + (offsets.dhuhr ?? 0)),
    asr: at(asr, 'asr', offsets.asr ?? 0),
    sunset: at(sunset, 'maghrib', 0),
    maghrib: at(Number.isNaN(maghrib) ? sunset : maghrib, 'maghrib', offsets.maghrib ?? 0),
    isha: at(isha, 'isha'),
  };
}

export interface FastingTimes {
  date: string;
  /** Fajr: the fast begins; suhoor must end. */
  suhoor_end: Date;
  /** Fajr minus the imsak margin (display and reminder only, 15 §5.2). */
  imsak: Date;
  /** Maghrib (Ja'fari: by the method's Maghrib angle, after sunset). */
  iftar: Date;
}

/** Suhoor end (Fajr), imsak (default Fajr minus 10 minutes) and iftar (Maghrib). */
export function fastingTimes(
  date: string,
  coords: Coordinates,
  params: PrayerParams,
  opts: { imsakOffsetMin?: number } = {},
): FastingTimes {
  const t = prayerTimes(date, coords, params);
  const imsak = Math.min(20, Math.max(0, opts.imsakOffsetMin ?? 10));
  return {
    date,
    suhoor_end: t.fajr,
    imsak: new Date(t.fajr.getTime() - imsak * 60_000),
    iftar: t.maghrib,
  };
}

/** `HH:mm` of an instant in an IANA time zone. */
export function formatLocalTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}
