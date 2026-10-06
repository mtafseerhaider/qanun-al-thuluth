import type { EnergyResult, PersonInput } from './energy.ts';
import { bmi } from './energy.ts';

/** AMDR ranges in percent of energy and the RDA protein floor in g/kg/day (12 §4.1). */
export interface Amdr {
  carbsPct: [number, number];
  fatPct: [number, number];
  proteinPct: [number, number];
  proteinFloorGPerKg: number;
}

export function amdrFor(ageMonths: number, pregnantOrLactating: boolean): Amdr {
  const years = ageMonths / 12;
  if (pregnantOrLactating && years >= 18) {
    return { carbsPct: [45, 65], fatPct: [20, 35], proteinPct: [10, 35], proteinFloorGPerKg: 1.1 };
  }
  if (years < 4) {
    return { carbsPct: [45, 65], fatPct: [30, 40], proteinPct: [5, 20], proteinFloorGPerKg: 1.05 };
  }
  if (years < 14) {
    return { carbsPct: [45, 65], fatPct: [25, 35], proteinPct: [10, 30], proteinFloorGPerKg: 0.95 };
  }
  if (years < 18) {
    return { carbsPct: [45, 65], fatPct: [25, 35], proteinPct: [10, 30], proteinFloorGPerKg: 0.85 };
  }
  return { carbsPct: [45, 65], fatPct: [20, 35], proteinPct: [10, 35], proteinFloorGPerKg: 0.8 };
}

export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  /** Upper limits (WHO free sugars, saturated fat for ages 2+), grams per day. */
  freeSugarMaxG: number;
  satFatMaxG: number | null;
  amdr: Amdr;
  /** Percent of energy actually allocated, for audit. */
  split: { proteinPct: number; carbsPct: number; fatPct: number };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Adjusted body weight for protein when BMI is above 25: ideal weight (BMI 22) plus 40 percent of
 * the excess. Used for the adult weight-loss protein target of 1.2 g/kg (12 §4.1).
 */
export function adjustedBodyWeightKg(weightKg: number, heightCm: number): number {
  const ideal = 22 * (heightCm / 100) ** 2;
  return weightKg > ideal ? ideal + 0.4 * (weightKg - ideal) : weightKg;
}

/**
 * Macro targets inside the AMDR: protein from the g/kg floor (1.2 g/kg adjusted weight for adult
 * weight loss) clamped to the protein AMDR, fat at 30 percent of energy clamped to the fat AMDR,
 * carbohydrate the remainder, fibre 14 g per 1000 kcal.
 */
export function macroTargets(p: PersonInput, energy: EnergyResult): MacroTargets {
  const kcal = energy.targetKcal;
  const pregnantOrLactating = !!p.pregnancy || !!p.lactation;
  const amdr = amdrFor(p.ageMonths, pregnantOrLactating);
  const weight = p.weightKg ?? 0;
  const losing = energy.displayToUser && energy.goalAdjustmentKcal < 0;

  let proteinG = amdr.proteinFloorGPerKg * weight;
  if (losing && p.heightCm != null && weight > 0) {
    proteinG = 1.2 * adjustedBodyWeightKg(weight, p.heightCm);
  } else if (energy.displayToUser) {
    // Adults: at least 15 percent of energy keeps meals satisfying (still inside the AMDR).
    proteinG = Math.max(proteinG, (0.15 * kcal) / 4);
  }
  const proteinPct = clamp(((proteinG * 4) / kcal) * 100, amdr.proteinPct[0], amdr.proteinPct[1]);
  const fatPct = clamp(30, amdr.fatPct[0], amdr.fatPct[1]);
  const carbsPct = clamp(100 - proteinPct - fatPct, amdr.carbsPct[0], amdr.carbsPct[1]);

  return {
    proteinG: Math.round((kcal * proteinPct) / 100 / 4),
    fatG: Math.round((kcal * fatPct) / 100 / 9),
    carbsG: Math.round((kcal * carbsPct) / 100 / 4),
    fiberG: Math.round((14 * kcal) / 1000),
    freeSugarMaxG: Math.round((0.1 * kcal) / 4),
    satFatMaxG: p.ageMonths >= 24 ? Math.round((0.1 * kcal) / 9) : null,
    amdr,
    split: {
      proteinPct: Math.round(proteinPct * 10) / 10,
      carbsPct: Math.round(carbsPct * 10) / 10,
      fatPct,
    },
  };
}

/** Exposed for warnings: BMI of an adult, or null when unknown. */
export function bmiOrNull(weightKg: number | null, heightCm: number | null): number | null {
  return weightKg && heightCm ? Math.round(bmi(weightKg, heightCm) * 10) / 10 : null;
}
