import { CHILD_AGE_YEARS } from '@thuluth/shared';
import type { ActivityLevel, GoalType, SexAtBirth } from '@thuluth/shared';

/**
 * Deterministic energy calculators (FR-AI-02, 12 §4.1). The LLM explains these numbers and never
 * computes them. Adults: Mifflin-St Jeor x PAL. Under 18: IOM 2005 EER, an internal estimate only
 * (never shown, 00 §10.3).
 */
export const CALCULATORS_VERSION = 'calculators@1.0.0';

/** kcal per kg of body weight change, used to convert the 1 percent per week cap (01 §7.5). */
export const KCAL_PER_KG = 7700;
/** Adult weight-loss target BMI floor (01 §7.5). */
export const BMI_FLOOR = 18.5;
/** Adult weight loss capped at 1 percent of body weight per week (01 §7.5). */
export const MAX_WEEKLY_LOSS_FRACTION = 0.01;

/** Physical activity level multipliers (12 §4.1). */
export const PAL: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** IOM physical activity coefficients by sex (12 §4.1). */
const IOM_PA: Record<'male' | 'female', Record<ActivityLevel, number>> = {
  male: { sedentary: 1.0, light: 1.13, moderate: 1.26, active: 1.42, very_active: 1.42 },
  female: { sedentary: 1.0, light: 1.16, moderate: 1.31, active: 1.56, very_active: 1.56 },
};

export type EnergyMethod = 'mifflin_st_jeor' | 'iom_eer_infant' | 'iom_eer_child' | 'iom_eer_teen';

export type IncrementReason = 'pregnancy_t2' | 'pregnancy_t3' | 'lactation_0_6' | 'lactation_7_12';

export interface PersonInput {
  ageMonths: number;
  sex: SexAtBirth;
  weightKg: number | null;
  heightCm: number | null;
  activity: ActivityLevel;
  pregnancy?: { trimester: 1 | 2 | 3 | null; gestationalDiabetes: boolean } | undefined;
  /** `infantAgeMonths` null when unknown; the 0-6 month increment is assumed. */
  lactation?: { infantAgeMonths: number | null } | undefined;
  goals: ReadonlyArray<{ goalType: GoalType; isPrimary: boolean; targetWeightKg?: number | null }>;
  /** Any hard red flag suppresses goal adjustments (12 §4.1). */
  redFlagActive?: boolean | undefined;
}

export interface EnergyResult {
  engineVersion: string;
  method: EnergyMethod;
  /** Adults only. Unrounded value kept for audit; `bmrKcal` is rounded to 1 kcal. */
  bmrKcal: number | null;
  pal: number | null;
  /** TDEE (adults) or EER (under 18), rounded to 1 kcal (FR-AI-02 acceptance: 2,711 for the Usman fixture). */
  maintenanceKcal: number;
  increments: Array<{ reason: IncrementReason; kcal: number }>;
  /** After increments and any adult goal adjustment, rounded to the nearest 10 kcal. */
  targetKcal: number;
  /** Negative for a deficit. Always 0 for under-18, pregnancy and lactation. */
  goalAdjustmentKcal: number;
  /** Adult weight goals: the safe target weight after the BMI floor (null otherwise). */
  safeTargetWeightKg: number | null;
  /** False for anyone under 18: the number is an internal estimate (00 §10.3). */
  displayToUser: boolean;
  warnings: string[];
}

export class MissingAnthropometricsError extends Error {
  constructor() {
    super('Weight and height are required for an energy estimate');
    this.name = 'MissingAnthropometricsError';
  }
}

const round = (n: number, step = 1) => Math.round(n / step) * step;

export function mifflinStJeorBmr(p: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: SexAtBirth;
}): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears;
  if (p.sex === 'male') return base + 5;
  if (p.sex === 'female') return base - 161;
  return base - 78; // unspecified: mean of the two constants
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** IOM 2005 EER for under-18s (12 §4.1). Weight in kg, height in cm (converted to m). */
export function iomEer(p: {
  ageMonths: number;
  sex: SexAtBirth;
  weightKg: number;
  heightCm: number;
  activity: ActivityLevel;
}): { kcal: number; method: EnergyMethod } {
  const wt = p.weightKg;
  if (p.ageMonths < 36) {
    const add = p.ageMonths <= 3 ? 175 : p.ageMonths <= 6 ? 56 : p.ageMonths <= 12 ? 22 : 20;
    return { kcal: 89 * wt - 100 + add, method: 'iom_eer_infant' };
  }
  const age = p.ageMonths / 12;
  const ht = p.heightCm / 100;
  const growth = age < 9 ? 20 : 25;
  const boys = 88.5 - 61.9 * age + IOM_PA.male[p.activity] * (26.7 * wt + 903 * ht) + growth;
  const girls = 135.3 - 30.8 * age + IOM_PA.female[p.activity] * (10.0 * wt + 934 * ht) + growth;
  const kcal = p.sex === 'male' ? boys : p.sex === 'female' ? girls : (boys + girls) / 2;
  return { kcal, method: age < 13 ? 'iom_eer_child' : 'iom_eer_teen' };
}

function primaryGoal(p: PersonInput) {
  return p.goals.find((g) => g.isPrimary) ?? p.goals[0];
}

/**
 * Energy for one member. Throws `MissingAnthropometricsError` when weight or height is missing
 * (the caller asks for measurements rather than guessing; deviation from 12 §4.1's WHO median
 * fallback, which needs `growth_reference_lms` and lands with `growth-compute`).
 */
export function calculateEnergy(p: PersonInput): EnergyResult {
  if (p.weightKg == null || p.heightCm == null || p.weightKg <= 0 || p.heightCm <= 0) {
    throw new MissingAnthropometricsError();
  }
  const ageYears = Math.floor(p.ageMonths / 12);
  const warnings: string[] = [];

  if (ageYears < CHILD_AGE_YEARS) {
    const eer = iomEer({
      ageMonths: p.ageMonths,
      sex: p.sex,
      weightKg: p.weightKg,
      heightCm: p.heightCm,
      activity: p.activity,
    });
    if (p.goals.some((g) => g.goalType === 'weight_loss' || g.goalType === 'weight_gain')) {
      warnings.push('child_weight_goal_ignored');
    }
    const maintenance = Math.round(eer.kcal);
    return {
      engineVersion: CALCULATORS_VERSION,
      method: eer.method,
      bmrKcal: null,
      pal: null,
      maintenanceKcal: maintenance,
      increments: [],
      targetKcal: round(eer.kcal, 10),
      goalAdjustmentKcal: 0,
      safeTargetWeightKg: null,
      displayToUser: false,
      warnings,
    };
  }

  const bmrRaw = mifflinStJeorBmr({
    weightKg: p.weightKg,
    heightCm: p.heightCm,
    ageYears,
    sex: p.sex,
  });
  const pal = PAL[p.activity];
  const tdeeRaw = bmrRaw * pal;

  const increments: EnergyResult['increments'] = [];
  if (p.pregnancy) {
    if (p.pregnancy.trimester === 2) increments.push({ reason: 'pregnancy_t2', kcal: 340 });
    if (p.pregnancy.trimester === 3) increments.push({ reason: 'pregnancy_t3', kcal: 452 });
    if (p.pregnancy.trimester == null) warnings.push('pregnancy_trimester_unknown');
  }
  if (p.lactation) {
    const infant = p.lactation.infantAgeMonths;
    if (infant == null) warnings.push('lactation_infant_age_unknown_assumed_0_6');
    if (infant != null && infant > 6) increments.push({ reason: 'lactation_7_12', kcal: 400 });
    else increments.push({ reason: 'lactation_0_6', kcal: 330 });
  }
  const withIncrements = tdeeRaw + increments.reduce((s, i) => s + i.kcal, 0);

  const goal = primaryGoal(p);
  let adjustment = 0;
  let safeTargetWeightKg: number | null = null;
  const pregnantOrLactating = !!p.pregnancy || !!p.lactation;
  const currentBmi = bmi(p.weightKg, p.heightCm);
  const floorWeight = BMI_FLOOR * (p.heightCm / 100) ** 2;

  if (goal?.goalType === 'weight_loss' || goal?.goalType === 'weight_gain') {
    if (pregnantOrLactating) {
      warnings.push('goal_suppressed_pregnancy_or_lactation');
    } else if (p.redFlagActive) {
      warnings.push('goal_suppressed_red_flag');
    } else if (goal.goalType === 'weight_loss') {
      if (currentBmi <= BMI_FLOOR) {
        warnings.push('weight_loss_suppressed_bmi_floor');
      } else {
        // Three caps, the smallest wins: 15 percent of maintenance, 500 kcal (12 §4.1) and
        // 1 percent of body weight per week (01 §7.5).
        const weeklyCapKcal = (p.weightKg * MAX_WEEKLY_LOSS_FRACTION * KCAL_PER_KG) / 7;
        let deficit = Math.min(0.15 * tdeeRaw, 500, weeklyCapKcal);
        // Floors: 1500 male/unspecified, 1200 female; never below BMR.
        const floor = Math.max(p.sex === 'female' ? 1200 : 1500, bmrRaw);
        if (tdeeRaw - deficit < floor) {
          deficit = Math.max(0, tdeeRaw - floor);
          warnings.push('deficit_limited_by_floor');
        }
        adjustment = -deficit;
        const requested = goal.targetWeightKg ?? null;
        if (requested != null) {
          if (requested < floorWeight) warnings.push('target_below_bmi_floor');
          safeTargetWeightKg = Math.round(Math.max(requested, floorWeight) * 10) / 10;
        }
      }
    } else {
      adjustment = Math.min(0.1 * tdeeRaw, 400);
      if (goal.targetWeightKg != null) safeTargetWeightKg = goal.targetWeightKg;
    }
  }

  return {
    engineVersion: CALCULATORS_VERSION,
    method: 'mifflin_st_jeor',
    bmrKcal: Math.round(bmrRaw),
    pal,
    maintenanceKcal: Math.round(tdeeRaw),
    increments,
    targetKcal: round(withIncrements + adjustment, 10),
    goalAdjustmentKcal: Math.round(adjustment),
    safeTargetWeightKg,
    displayToUser: true,
    warnings,
  };
}
