import { describe, expect, it } from 'vitest';

import {
  bmi,
  calculateEnergy,
  climateBand,
  dailyFluidTarget,
  fastingHydrationSchedule,
  hydrationSchedule,
  iomEer,
  KCAL_PER_KG,
  macroTargets,
  MissingAnthropometricsError,
  mifflinStJeorBmr,
  toMinutes,
} from '../src/calculators/index.ts';
import type { PersonInput } from '../src/calculators/index.ts';

/** Usman, the primary persona (01 §3.2): 38 y, 84 kg, 175 cm, moderate, goal 70 kg. */
const usman: PersonInput = {
  ageMonths: 38 * 12 + 4,
  sex: 'male',
  weightKg: 84,
  heightCm: 175,
  activity: 'moderate',
  goals: [{ goalType: 'weight_loss', isPrimary: true, targetWeightKg: 70 }],
};

describe('Mifflin-St Jeor (FR-AI-02)', () => {
  it('Usman fixture: BMR 1,749 (±1) and TDEE 2,711 (±2) at PAL 1.55', () => {
    const e = calculateEnergy({ ...usman, goals: [] });
    expect(Math.abs(e.bmrKcal! - 1749)).toBeLessThanOrEqual(1);
    expect(Math.abs(e.maintenanceKcal - 2711)).toBeLessThanOrEqual(2);
    expect(e.maintenanceKcal).toBe(2711);
    expect(e.pal).toBe(1.55);
    expect(e.displayToUser).toBe(true);
    expect(e.targetKcal).toBe(2710);
  });

  it('female and unspecified constants', () => {
    expect(mifflinStJeorBmr({ weightKg: 60, heightCm: 165, ageYears: 34, sex: 'female' })).toBe(
      1300.25,
    );
    expect(
      mifflinStJeorBmr({ weightKg: 60, heightCm: 165, ageYears: 34, sex: 'unspecified' }),
    ).toBe(1383.25);
  });

  it('Usman weight loss: 15 percent deficit, under 500 kcal and under 1 percent per week', () => {
    const e = calculateEnergy(usman);
    expect(e.goalAdjustmentKcal).toBe(-407);
    expect(e.targetKcal).toBe(2300);
    expect(e.safeTargetWeightKg).toBe(70);
    const weeklyKg = (-e.goalAdjustmentKcal * 7) / KCAL_PER_KG;
    expect(weeklyKg).toBeLessThanOrEqual(0.01 * 84);
  });

  it('never exceeds 1 percent of body weight per week across a sweep of adults', () => {
    for (let weight = 50; weight <= 160; weight += 5) {
      for (const height of [150, 165, 180]) {
        for (const activity of ['sedentary', 'moderate', 'very_active'] as const) {
          for (const sex of ['male', 'female'] as const) {
            if (bmi(weight, height) <= 18.5) continue;
            const e = calculateEnergy({
              ...usman,
              sex,
              weightKg: weight,
              heightCm: height,
              activity,
            });
            expect(-e.goalAdjustmentKcal).toBeLessThanOrEqual(
              (weight * 0.01 * KCAL_PER_KG) / 7 + 0.5,
            );
            expect(-e.goalAdjustmentKcal).toBeLessThanOrEqual(500);
            expect(e.targetKcal).toBeGreaterThanOrEqual(Math.min(e.maintenanceKcal, 1200) - 5);
          }
        }
      }
    }
  });

  it('clamps a target weight below BMI 18.5', () => {
    const e = calculateEnergy({
      ...usman,
      goals: [{ goalType: 'weight_loss', isPrimary: true, targetWeightKg: 50 }],
    });
    expect(e.safeTargetWeightKg).toBe(56.7);
    expect(e.warnings).toContain('target_below_bmi_floor');
  });

  it('no deficit at or below BMI 18.5', () => {
    const e = calculateEnergy({ ...usman, weightKg: 55, heightCm: 175 });
    expect(e.goalAdjustmentKcal).toBe(0);
    expect(e.warnings).toContain('weight_loss_suppressed_bmi_floor');
  });

  it('respects the 1,200 kcal floor for women', () => {
    const e = calculateEnergy({
      ageMonths: 60 * 12,
      sex: 'female',
      weightKg: 50,
      heightCm: 155,
      activity: 'sedentary',
      goals: [{ goalType: 'weight_loss', isPrimary: true }],
    });
    expect(e.targetKcal).toBe(1200);
    expect(e.warnings).toContain('deficit_limited_by_floor');
  });

  it('weight gain is +10 percent capped at 400 kcal', () => {
    const e = calculateEnergy({ ...usman, goals: [{ goalType: 'weight_gain', isPrimary: true }] });
    expect(e.goalAdjustmentKcal).toBe(271);
    expect(e.targetKcal).toBe(2980);
  });

  it('pregnancy and lactation add increments and never take a deficit', () => {
    const base = {
      ageMonths: 34 * 12,
      sex: 'female' as const,
      weightKg: 68,
      heightCm: 160,
      activity: 'light' as const,
      goals: [{ goalType: 'weight_loss' as const, isPrimary: true }],
    };
    const t3 = calculateEnergy({
      ...base,
      pregnancy: { trimester: 3, gestationalDiabetes: false },
    });
    expect(t3.increments).toEqual([{ reason: 'pregnancy_t3', kcal: 452 }]);
    expect(t3.goalAdjustmentKcal).toBe(0);
    expect(t3.warnings).toContain('goal_suppressed_pregnancy_or_lactation');

    const bf = calculateEnergy({ ...base, lactation: { infantAgeMonths: 3 } });
    expect(bf.increments).toEqual([{ reason: 'lactation_0_6', kcal: 330 }]);
    expect(bf.goalAdjustmentKcal).toBe(0);
    expect(bf.targetKcal).toBeGreaterThan(bf.maintenanceKcal);
    const bfOlder = calculateEnergy({ ...base, lactation: { infantAgeMonths: 9 } });
    expect(bfOlder.increments[0]?.kcal).toBe(400);
  });

  it('requires measurements', () => {
    expect(() => calculateEnergy({ ...usman, weightKg: null })).toThrow(
      MissingAnthropometricsError,
    );
  });
});

describe('IOM EER for under-18s (internal estimate only)', () => {
  it('boy 8 y, 25 kg, 128 cm, moderate', () => {
    const r = iomEer({
      ageMonths: 96,
      sex: 'male',
      weightKg: 25,
      heightCm: 128,
      activity: 'moderate',
    });
    expect(r.kcal).toBeCloseTo(1910.71, 1);
    expect(r.method).toBe('iom_eer_child');
  });

  it('girl 4 y, 16 kg, 102 cm, light', () => {
    const r = iomEer({
      ageMonths: 48,
      sex: 'female',
      weightKg: 16,
      heightCm: 102,
      activity: 'light',
    });
    expect(r.kcal).toBeCloseTo(1322.81, 1);
  });

  it('toddler and infant equations', () => {
    expect(
      iomEer({ ageMonths: 24, sex: 'male', weightKg: 12, heightCm: 86, activity: 'light' }).kcal,
    ).toBe(988);
    expect(
      iomEer({ ageMonths: 2, sex: 'female', weightKg: 5, heightCm: 57, activity: 'light' }).kcal,
    ).toBe(520);
  });

  it('teen uses the +25 growth term and the teen method', () => {
    const r = iomEer({
      ageMonths: 14 * 12,
      sex: 'female',
      weightKg: 50,
      heightCm: 158,
      activity: 'sedentary',
    });
    expect(r.kcal).toBeCloseTo(135.3 - 30.8 * 14 + (500 + 934 * 1.58) + 25, 5);
    expect(r.method).toBe('iom_eer_teen');
  });

  it('children are never displayed and never get a goal adjustment', () => {
    const e = calculateEnergy({
      ageMonths: 12 * 12,
      sex: 'male',
      weightKg: 55,
      heightCm: 150,
      activity: 'light',
      goals: [{ goalType: 'weight_loss', isPrimary: true }],
    });
    expect(e.displayToUser).toBe(false);
    expect(e.goalAdjustmentKcal).toBe(0);
    expect(e.bmrKcal).toBeNull();
    expect(e.warnings).toContain('child_weight_goal_ignored');
  });
});

describe('macro targets', () => {
  it('Usman weight loss: protein 1.2 g/kg adjusted weight, all within AMDR', () => {
    const e = calculateEnergy(usman);
    const m = macroTargets(usman, e);
    expect(m.proteinG).toBe(89);
    expect(m.fatG).toBe(77);
    expect(m.carbsG).toBe(314);
    expect(m.fiberG).toBe(32);
    expect(m.split.carbsPct).toBeGreaterThanOrEqual(45);
    expect(m.split.carbsPct).toBeLessThanOrEqual(65);
  });

  it('pregnancy uses the 1.1 g/kg protein floor', () => {
    const p: PersonInput = {
      ageMonths: 30 * 12,
      sex: 'female',
      weightKg: 70,
      heightCm: 160,
      activity: 'sedentary',
      pregnancy: { trimester: 2, gestationalDiabetes: false },
      goals: [],
    };
    const m = macroTargets(p, calculateEnergy(p));
    expect(m.amdr.proteinFloorGPerKg).toBe(1.1);
    expect(m.proteinG).toBeGreaterThanOrEqual(77);
  });
});

describe('hydration targets (FR-HYD-01)', () => {
  it('Lahore climate bands by month', () => {
    expect(climateBand('hot_semi_arid', 11)).toBe('temperate');
    expect(climateBand('hot_semi_arid', 3)).toBe('warm');
    expect(climateBand('hot_semi_arid', 4)).toBe('hot');
    expect(climateBand('hot_semi_arid', 6)).toBe('very_hot');
    expect(climateBand('temperate_oceanic', 1)).toBe('temperate');
    expect(climateBand(null, 6)).toBe('temperate');
  });

  it('table values for base groups in a temperate climate (AC-H9)', () => {
    const t = (ageMonths: number, sex: 'male' | 'female') =>
      dailyFluidTarget({ ageMonths, sex, climate: 'temperate', activity: 'sedentary' }).dailyMl;
    expect(t(3, 'male')).toBe(0);
    expect(t(8, 'male')).toBe(180);
    expect(t(18, 'male')).toBe(900);
    expect(t(30, 'female')).toBe(1050);
    expect(t(72, 'male')).toBe(1300);
    expect(t(120, 'male')).toBe(1700);
    expect(t(120, 'female')).toBe(1500);
    expect(t(16 * 12, 'female')).toBe(1600);
    expect(t(30 * 12, 'male')).toBe(2000);
  });

  it('Usman: weight scaling, activity, and the hot-climate uplift', () => {
    const base = {
      ageMonths: usman.ageMonths,
      sex: 'male' as const,
      weightKg: 84,
      activity: 'moderate' as const,
    };
    expect(dailyFluidTarget({ ...base, climate: 'temperate' }).dailyMl).toBe(2650);
    const summer = dailyFluidTarget({ ...base, climate: 'very_hot' });
    expect(summer.dailyMl).toBe(3350);
    expect(summer.basis.adjustments).toContain('climate_very_hot');
  });

  it('breastfeeding adds at least 700 ml; pregnancy adds 250 ml', () => {
    const hina = {
      ageMonths: 34 * 12,
      sex: 'female' as const,
      weightKg: 62,
      activity: 'light' as const,
      climate: 'warm' as const,
    };
    const baseline = dailyFluidTarget(hina).dailyMl;
    const bf = dailyFluidTarget({ ...hina, breastfeeding: true });
    expect(bf.dailyMl - baseline).toBeGreaterThanOrEqual(700);
    expect(bf.basis.breastfeeding).toBe(true);
    expect(dailyFluidTarget({ ...hina, pregnant: true }).dailyMl - baseline).toBe(250);
  });

  it('children get 90 percent of the climate uplift and no pregnancy uplift', () => {
    const child = dailyFluidTarget({
      ageMonths: 96,
      sex: 'male',
      climate: 'very_hot',
      activity: 'sedentary',
    });
    expect(child.dailyMl).toBe(1650);
  });
});

describe('Thuluth fluid schedule (FR-HYD-02)', () => {
  it('places a pre-meal window 20 to 30 minutes before each main meal and sums to the target', () => {
    const windows = hydrationSchedule({
      dailyMl: 2650,
      isChild: false,
      meals: [
        { mealType: 'breakfast', time: '07:30' },
        { mealType: 'lunch', time: '13:30' },
        { mealType: 'snack', time: '17:00' },
        { mealType: 'dinner', time: '20:30' },
      ],
      wake: '05:30',
      sleep: '23:00',
    });
    const pre = windows.filter((w) => w.kind === 'pre_meal');
    expect(pre.map((w) => [w.window, w.start, w.end])).toEqual([
      ['pre_breakfast', '07:00', '07:10'],
      ['pre_lunch', '13:00', '13:10'],
      ['pre_dinner', '20:00', '20:10'],
    ]);
    expect(windows.reduce((s, w) => s + w.ml, 0)).toBe(2650);
    expect(windows.every((w) => w.ml >= 0)).toBe(true);
  });

  it('shifts when meal times change', () => {
    const a = hydrationSchedule({
      dailyMl: 1300,
      isChild: true,
      meals: [{ mealType: 'lunch', time: '13:00' }],
    });
    const b = hydrationSchedule({
      dailyMl: 1300,
      isChild: true,
      meals: [{ mealType: 'lunch', time: '14:00' }],
    });
    const preA = a.find((w) => w.window === 'pre_lunch')!;
    const preB = b.find((w) => w.window === 'pre_lunch')!;
    expect(toMinutes(preB.start) - toMinutes(preA.start)).toBe(60);
    expect(b.reduce((s, w) => s + w.ml, 0)).toBe(1300);
  });

  it('a fast day drinks only between iftar and suhoor', () => {
    const { windows } = fastingHydrationSchedule({
      dailyMl: 2400,
      isChild: false,
      iftar: '18:00',
      suhoorEnd: '04:45',
      sleep: '23:00',
    });
    expect(windows.reduce((s, w) => s + w.ml, 0)).toBe(2400);
    for (const w of windows) {
      const m = toMinutes(w.start);
      const inWindow = m >= toMinutes('18:00') || m <= toMinutes('04:45');
      expect(inWindow).toBe(true);
    }
  });
});
