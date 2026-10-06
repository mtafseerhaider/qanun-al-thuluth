import { CHILD_AGE_YEARS, FLUID_TIMING } from '@thuluth/shared';
import type { ActivityLevel, MealType, SexAtBirth } from '@thuluth/shared';

import { CALCULATORS_VERSION } from './energy.ts';

/**
 * Hydration targets (FR-HYD-01) and the Thuluth fluid schedule (FR-HYD-02), per
 * 15-family-health-modules.md §6. `daily_ml` is beverage fluid: 80 percent of EFSA (2010) total
 * water, since about 20 percent comes from food.
 */

export type ClimateBand = 'temperate' | 'warm' | 'hot' | 'very_hot';

/** `regions.climate_zone` values (05 §7.3). */
export type ClimateZone =
  | 'hot_arid'
  | 'hot_semi_arid'
  | 'humid_subtropical'
  | 'tropical'
  | 'mediterranean'
  | 'temperate_oceanic'
  | 'continental'
  | 'subarctic';

const HOT_ZONE_BY_MONTH: Record<number, ClimateBand> = {
  1: 'temperate',
  2: 'temperate',
  3: 'warm',
  4: 'hot',
  5: 'very_hot',
  6: 'very_hot',
  7: 'very_hot',
  8: 'very_hot',
  9: 'hot',
  10: 'warm',
  11: 'temperate',
  12: 'temperate',
};

/**
 * Climate band for a zone and calendar month (1-12). The Lahore month mapping in 15 §6.2
 * (Nov-Feb temperate, Mar/Oct warm, Apr/Sep hot, May-Aug very hot) is applied to all hot zones in
 * the northern hemisphere; tropical never drops below warm; temperate zones are warm in Jun-Aug.
 * Southern-hemisphere regions are out of the MVP rollout (01 §4.1).
 */
export function climateBand(zone: ClimateZone | null, month: number): ClimateBand {
  switch (zone) {
    case 'hot_arid':
    case 'hot_semi_arid':
    case 'humid_subtropical':
      return HOT_ZONE_BY_MONTH[month] ?? 'temperate';
    case 'tropical': {
      const band = HOT_ZONE_BY_MONTH[month] ?? 'warm';
      return band === 'temperate' ? 'warm' : band;
    }
    case 'mediterranean':
      return month >= 6 && month <= 8 ? 'hot' : month === 5 || month === 9 ? 'warm' : 'temperate';
    case 'temperate_oceanic':
    case 'continental':
      return month >= 6 && month <= 8 ? 'warm' : 'temperate';
    default:
      return 'temperate';
  }
}

export const CLIMATE_UPLIFT: Record<ClimateBand, number> = {
  temperate: 0,
  warm: 0.1,
  hot: 0.2,
  very_hot: 0.3,
};

/** Pregnancy +250 ml beverage (15 §6.2). */
export const PREGNANCY_UPLIFT_ML = 250;
/**
 * Breastfeeding uplift. 15 §6.2 says +550 ml beverage (80 percent of EFSA's +700 ml total), but
 * FR-HYD-01 acceptance requires at least 700 ml above the non-breastfeeding baseline, so the
 * binding acceptance criterion wins.
 */
export const BREASTFEEDING_UPLIFT_ML = 700;

export interface HydrationInput {
  ageMonths: number;
  sex: SexAtBirth;
  weightKg?: number | null | undefined;
  climate: ClimateBand;
  activity: ActivityLevel;
  pregnant?: boolean | undefined;
  breastfeeding?: boolean | undefined;
}

export interface HydrationResult {
  engineVersion: string;
  dailyMl: number;
  /** Beverage baseline before uplifts, for the basis record. */
  baseMl: number;
  basis: {
    source: 'efsa_2010';
    age_months: number;
    climate: ClimateBand;
    pregnancy: boolean;
    breastfeeding: boolean;
    adjustments: string[];
  };
  note: string | null;
}

/** Beverage base by age and sex (15 §6.2 table). */
export function baseBeverageMl(ageMonths: number, sex: SexAtBirth): number {
  const years = ageMonths / 12;
  const female = sex === 'female';
  const pick = (m: number, f: number) => (sex === 'unspecified' ? (m + f) / 2 : female ? f : m);
  if (years < 2) return 900;
  if (years < 4) return 1050;
  if (years < 9) return 1300;
  if (years < 14) return pick(1700, 1500);
  return pick(2000, 1600);
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function dailyFluidTarget(b: HydrationInput): HydrationResult {
  const adjustments: string[] = [];
  const basis = (dailyMl: number, baseMl: number, note: string | null): HydrationResult => ({
    engineVersion: CALCULATORS_VERSION,
    dailyMl,
    baseMl,
    basis: {
      source: 'efsa_2010',
      age_months: b.ageMonths,
      climate: b.climate,
      pregnancy: !!b.pregnant,
      breastfeeding: !!b.breastfeeding,
      adjustments,
    },
    note,
  });
  if (b.ageMonths < 6) return basis(0, 0, 'infant_milk_only');
  if (b.ageMonths < 12) return basis(180, 180, 'infant_open_cup_with_meals');

  const adult = b.ageMonths >= CHILD_AGE_YEARS * 12;
  const base = baseBeverageMl(b.ageMonths, b.sex);
  let ml = base;
  if (adult && b.weightKg) {
    const ref = b.sex === 'male' ? 70 : 60;
    const factor = clamp(b.weightKg / ref, 0.85, 1.25);
    if (factor !== 1) adjustments.push(`weight_x${factor.toFixed(2)}`);
    ml *= factor;
  }
  const uplift = CLIMATE_UPLIFT[b.climate] * (adult ? 1 : 0.9);
  if (uplift > 0) adjustments.push(`climate_${b.climate}`);
  ml *= 1 + uplift;
  const activityMl = adult
    ? { sedentary: 0, light: 0, moderate: 250, active: 500, very_active: 750 }[b.activity]
    : { sedentary: 0, light: 0, moderate: 150, active: 250, very_active: 350 }[b.activity];
  if (activityMl) adjustments.push(`activity_${b.activity}`);
  ml += activityMl;
  // Uplifts for pregnancy and breastfeeding are added after rounding so the documented
  // difference is exact (FR-HYD-01: breastfeeding at least +700 ml).
  let dailyMl = roundTo(ml, 50);
  if (adult && b.pregnant) {
    adjustments.push('pregnancy');
    dailyMl += PREGNANCY_UPLIFT_ML;
  }
  if (adult && b.breastfeeding) {
    adjustments.push('breastfeeding');
    dailyMl += BREASTFEEDING_UPLIFT_ML;
  }
  return basis(Math.min(dailyMl, 6000), base, null);
}

// ---- Schedule (FR-HYD-02, 15 §6.3) ----

export type WindowKind =
  'on_waking' | 'pre_meal' | 'with_meal' | 'post_meal' | 'between' | 'before_sleep';

/** One `hydration_targets.schedule` entry. `window` keeps the 05 §12.2 key ('pre_lunch'). */
export interface HydrationWindow {
  window: string;
  kind: WindowKind;
  start: string;
  end: string;
  ml: number;
  meal_type?: MealType;
}

export interface ScheduleInput {
  dailyMl: number;
  isChild: boolean;
  meals: ReadonlyArray<{ mealType: MealType; time: string }>;
  wake?: string | null | undefined;
  sleep?: string | null | undefined;
}

/** Main meals that get a pre-meal window (lunch and dinner always, breakfast too). */
const MAIN_MEALS: readonly MealType[] = ['breakfast', 'lunch', 'dinner'];

/** Default meal times when the intake has none (typical Lahore family day). */
export const DEFAULT_MEAL_TIMES: ReadonlyArray<{ mealType: MealType; time: string }> = [
  { mealType: 'breakfast', time: '08:00' },
  { mealType: 'lunch', time: '13:30' },
  { mealType: 'dinner', time: '20:00' },
];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0) + 1440) % 1440;
}

export function toHhMm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * The Thuluth fluid schedule: a glass 20 to 30 minutes before each main meal, small sips with the
 * meal, freer drinking 30 to 60 minutes after, a glass on waking and before sleep. Children get
 * half-size glasses and water (not milk) before meals. Window volumes sum to `dailyMl`.
 */
export function hydrationSchedule(s: ScheduleInput): HydrationWindow[] {
  if (s.dailyMl <= 0) return [];
  const glass = s.isChild ? 120 : 250;
  const meals = [...(s.meals.length ? s.meals : DEFAULT_MEAL_TIMES)]
    .filter((m) => MAIN_MEALS.includes(m.mealType))
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  const windows: HydrationWindow[] = [];
  const wake = s.wake ? toMinutes(s.wake) : null;
  const sleep = s.sleep ? toMinutes(s.sleep) : null;
  windows.push({
    window: 'on_waking',
    kind: 'on_waking',
    start: toHhMm(wake ?? toMinutes(meals[0]?.time ?? '08:00') - 60),
    end: toHhMm((wake ?? toMinutes(meals[0]?.time ?? '08:00') - 60) + 15),
    ml: s.isChild ? 100 : 220,
  });
  for (const meal of meals) {
    const t = toMinutes(meal.time);
    windows.push({
      window: `pre_${meal.mealType}`,
      kind: 'pre_meal',
      start: toHhMm(t - FLUID_TIMING.preMealMinutes.max),
      end: toHhMm(t - FLUID_TIMING.preMealMinutes.min),
      ml: glass,
      meal_type: meal.mealType,
    });
    windows.push({
      window: `post_${meal.mealType}`,
      kind: 'post_meal',
      start: toHhMm(t + FLUID_TIMING.postMealMinutes.min),
      end: toHhMm(t + FLUID_TIMING.postMealMinutes.max),
      ml: 0,
      meal_type: meal.mealType,
    });
  }
  const lastMeal = meals[meals.length - 1];
  const sleepStart = sleep ?? (lastMeal ? toMinutes(lastMeal.time) + 150 : 22 * 60);
  windows.push({
    window: 'before_sleep',
    kind: 'before_sleep',
    // Young children: nothing large in the hour before sleep, so their cup comes earlier.
    start: toHhMm(sleepStart - (s.isChild ? 90 : 45)),
    end: toHhMm(sleepStart - (s.isChild ? 60 : 15)),
    ml: s.isChild ? 100 : 250,
  });

  // Fixed windows may not exceed the target (small children): scale them down proportionally.
  const fixed = windows.reduce((sum, w) => sum + w.ml, 0);
  if (fixed > s.dailyMl) {
    const k = s.dailyMl / fixed;
    for (const w of windows) w.ml = roundTo(w.ml * k, 10);
  }
  // Remainder goes to the post-meal windows ("drink freely 30 to 60 minutes after").
  const post = windows.filter((w) => w.kind === 'post_meal');
  let remainder = s.dailyMl - windows.reduce((sum, w) => sum + w.ml, 0);
  post.forEach((w, i) => {
    const share = i === post.length - 1 ? remainder : roundTo(remainder / (post.length - i), 10);
    w.ml += share;
    remainder -= share;
  });
  if (remainder !== 0 && windows[0]) windows[0].ml += remainder;
  return windows.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

/**
 * Fast-day schedule (FR-HYD-02, 15 §5.4): the target is spread between iftar and suhoor only.
 * Anchors: iftar 250 ml and suhoor 500 ml (children on practice fasts 150 and 300); the rest is
 * split into evening windows at least 45 minutes apart, at most 1,000 ml per hour.
 */
export function fastingHydrationSchedule(s: {
  dailyMl: number;
  isChild: boolean;
  iftar: string;
  suhoorEnd: string;
  sleep: string;
}): { windows: HydrationWindow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (s.dailyMl <= 0) return { windows: [], warnings };
  const iftar = toMinutes(s.iftar);
  const sleep = toMinutes(s.sleep);
  const suhoorEnd = toMinutes(s.suhoorEnd);
  const iftarMl = s.isChild ? 150 : 250;
  const suhoorMl = s.isChild ? 300 : 500;
  const awakeEvening = (sleep - iftar + 1440) % 1440;
  const slots = Math.max(1, Math.floor((awakeEvening - 30) / 45));
  const remainder = Math.max(0, s.dailyMl - iftarMl - suhoorMl);
  const perSlot = roundTo(remainder / slots, 10);
  const windows: HydrationWindow[] = [
    {
      window: 'iftar',
      kind: 'with_meal',
      start: toHhMm(iftar),
      end: toHhMm(iftar + 15),
      ml: iftarMl,
      meal_type: 'iftar',
    },
  ];
  let given = 0;
  for (let i = 0; i < slots; i++) {
    const ml = i === slots - 1 ? remainder - given : perSlot;
    given += ml;
    const start = iftar + 45 * (i + 1);
    windows.push({
      window: `evening_${i + 1}`,
      kind: 'between',
      start: toHhMm(start),
      end: toHhMm(start + 20),
      ml,
    });
  }
  windows.push({
    window: 'suhoor',
    kind: 'with_meal',
    start: toHhMm(suhoorEnd - 45),
    end: toHhMm(suhoorEnd - 10),
    ml: suhoorMl,
    meal_type: 'suhoor',
  });
  if (perSlot / 0.75 > 1000) warnings.push('TARGET_UNREACHABLE_IN_WINDOW');
  return { windows, warnings };
}
