/**
 * Prayer-time calculation methods (01 Q-05, 15 §5.2). Angles are the sun's depression below the
 * horizon. `dhuhrOffsetMin` is the customary precaution margin after the meridian transit that the
 * reference library (`adhan`, which 15 §5.2 names) and most published timetables apply.
 */

export const CALCULATION_METHODS = [
  'karachi',
  'mwl',
  'isna',
  'umm_al_qura',
  'egyptian',
  'dubai',
  'jafari',
  'tehran',
] as const;
export type CalculationMethod = (typeof CALCULATION_METHODS)[number];

/** Asr shadow length: Shafi'i, Maliki, Hanbali and Ja'fari use 1, Hanafi uses 2. */
export const ASR_SCHOOLS = ['standard', 'hanafi'] as const;
export type AsrSchool = (typeof ASR_SCHOOLS)[number];

export const HIGH_LATITUDE_RULES = [
  'middle_of_the_night',
  'seventh_of_the_night',
  'twilight_angle',
] as const;
export type HighLatitudeRule = (typeof HIGH_LATITUDE_RULES)[number];

export interface MethodParams {
  label: string;
  fajrAngle: number;
  /** Isha by angle; omitted when Isha is a fixed interval after Maghrib. */
  ishaAngle?: number;
  /** Isha as minutes after Maghrib (Umm al-Qura: 90, 120 in Ramadan). */
  ishaIntervalMin?: number;
  ishaIntervalRamadanMin?: number;
  /** Maghrib by angle below the horizon (Ja'fari and Tehran); otherwise sunset. */
  maghribAngle?: number;
  dhuhrOffsetMin: number;
  /** Per-prayer minute offsets applied after the computation (Dubai). */
  offsets?: Partial<Record<'sunrise' | 'dhuhr' | 'asr' | 'maghrib', number>>;
  tradition: 'sunni' | 'shia';
}

export const METHODS: Record<CalculationMethod, MethodParams> = {
  // University of Islamic Sciences, Karachi: Pakistan default (01 Q-05), Fajr 18, Isha 18.
  karachi: {
    label: 'University of Islamic Sciences, Karachi',
    fajrAngle: 18,
    ishaAngle: 18,
    dhuhrOffsetMin: 1,
    tradition: 'sunni',
  },
  mwl: {
    label: 'Muslim World League',
    fajrAngle: 18,
    ishaAngle: 17,
    dhuhrOffsetMin: 1,
    tradition: 'sunni',
  },
  isna: {
    label: 'Islamic Society of North America',
    fajrAngle: 15,
    ishaAngle: 15,
    dhuhrOffsetMin: 1,
    tradition: 'sunni',
  },
  umm_al_qura: {
    label: 'Umm al-Qura University, Makkah',
    fajrAngle: 18.5,
    ishaIntervalMin: 90,
    ishaIntervalRamadanMin: 120,
    dhuhrOffsetMin: 0,
    tradition: 'sunni',
  },
  egyptian: {
    label: 'Egyptian General Authority of Survey',
    fajrAngle: 19.5,
    ishaAngle: 17.5,
    dhuhrOffsetMin: 1,
    tradition: 'sunni',
  },
  dubai: {
    label: 'Dubai (Awqaf)',
    fajrAngle: 18.2,
    ishaAngle: 18.2,
    dhuhrOffsetMin: 0,
    offsets: { sunrise: -3, dhuhr: 3, asr: 3, maghrib: 3 },
    tradition: 'sunni',
  },
  // Shia Ithna Ashari, Leva Institute, Qum (15 §5.2): Fajr 16, Isha 14, Maghrib 4 below horizon.
  jafari: {
    label: 'Shia Ithna Ashari (Leva Institute, Qum)',
    fajrAngle: 16,
    ishaAngle: 14,
    maghribAngle: 4,
    dhuhrOffsetMin: 0,
    tradition: 'shia',
  },
  tehran: {
    label: 'Institute of Geophysics, University of Tehran',
    fajrAngle: 17.7,
    ishaAngle: 14,
    maghribAngle: 4.5,
    dhuhrOffsetMin: 0,
    tradition: 'shia',
  },
};

const GCC = new Set(['SA', 'BH', 'KW', 'OM', 'QA']);
const NORTH_AMERICA = new Set(['US', 'CA']);

/**
 * Default method per country (01 Q-05): Pakistan Karachi with Hanafi Asr; GCC Umm al-Qura (UAE:
 * Dubai, 15 §5.2); North America ISNA; elsewhere (UK included) Muslim World League. A Shia
 * household (`users.tradition_preference = 'shia'`) defaults to Ja'fari, which stays selectable
 * for anyone.
 */
export function defaultMethodFor(
  countryCode: string | null | undefined,
  tradition: 'shared' | 'sunni' | 'shia' = 'shared',
): { method: CalculationMethod; asr: AsrSchool } {
  const cc = (countryCode ?? '').toUpperCase();
  if (tradition === 'shia') return { method: 'jafari', asr: 'standard' };
  if (cc === 'PK') return { method: 'karachi', asr: 'hanafi' };
  if (cc === 'AE') return { method: 'dubai', asr: 'standard' };
  if (GCC.has(cc)) return { method: 'umm_al_qura', asr: 'standard' };
  if (NORTH_AMERICA.has(cc)) return { method: 'isna', asr: 'standard' };
  return { method: 'mwl', asr: 'standard' };
}

export const isCalculationMethod = (v: unknown): v is CalculationMethod =>
  typeof v === 'string' && (CALCULATION_METHODS as readonly string[]).includes(v);
