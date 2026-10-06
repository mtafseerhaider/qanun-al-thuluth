import {
  calculateEnergy,
  CALCULATORS_VERSION,
  climateBand,
  dailyFluidTarget,
  escalationFor,
  evaluateIntakeRedFlags,
  hydrationSchedule,
  macroTargets,
  MissingAnthropometricsError,
  riskFlagStrings,
} from '@thuluth/ai-core';
import type {
  ClimateZone,
  EnergyResult,
  EscalationOut,
  HydrationResult,
  HydrationWindow,
  MacroTargets as MacroResult,
  PersonInput,
  RiskFlag,
  ScreeningAnswers,
} from '@thuluth/ai-core';
import { ageInMonths, CHILD_AGE_YEARS, lifeStageFor, MEAL_TYPES } from '@thuluth/shared';
import type { GoalType, LifeStage, MealType } from '@thuluth/shared';

import type { MemberContext, RecommendationRow } from './store.ts';

/**
 * Deterministic part of the intake assessment (FR-AI-02): every number comes from the calculators
 * in `@thuluth/ai-core`; the model only writes the narrative summary.
 */

export type Locale = 'en' | 'ur';

export interface ComputedMember {
  member: MemberContext;
  ageMonths: number | null;
  lifeStage: LifeStage;
  minor: boolean;
  flags: RiskFlag[];
  riskFlags: string[];
  escalation: EscalationOut | null;
  energy: EnergyResult | null;
  macros: MacroResult | null;
  hydration: HydrationResult;
  schedule: HydrationWindow[];
  childGuidance: string[] | undefined;
  recommendationIds: string[];
  climate: string;
}

/** Today's calendar date in the household time zone, `YYYY-MM-DD`. */
export function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const isMeal = (m: string): m is MealType => (MEAL_TYPES as readonly string[]).includes(m);

export function computeMember(
  m: MemberContext,
  ctx: {
    today: string;
    climateZone: string | null;
    locale: Locale;
    screening: ScreeningAnswers | undefined;
    recommendations: readonly RecommendationRow[];
  },
): ComputedMember {
  const ageMonths = m.date_of_birth ? ageInMonths(m.date_of_birth, ctx.today) : null;
  const lifeStage: LifeStage = m.date_of_birth ? lifeStageFor(m.date_of_birth, ctx.today) : 'adult';
  const minor = ageMonths !== null && ageMonths < CHILD_AGE_YEARS * 12;
  const breastfeeding = m.special_modules.includes('breastfeeding');
  const pregnant = m.special_modules.includes('pregnancy') || m.pregnancy !== null;
  const goals = m.goals.map((g) => g.goal_type as GoalType);

  const flags = evaluateIntakeRedFlags({
    ageMonths: ageMonths ?? 18 * 12,
    weightKg: m.weight_kg,
    pregnant,
    gestationalDiabetes: !!m.pregnancy?.gestational_diabetes,
    breastfeeding,
    conditions: m.conditions.map((c) => ({
      label: c.label,
      conditionCode: c.condition_code,
      onInsulinOrSulfonylurea: c.on_insulin_or_sulfonylurea,
    })),
    medicationFlags: m.medications.flatMap((x) => x.food_interaction_flags),
    allergySeverities: m.allergies.map((a) => a.severity),
    goals,
    fastingPractice: m.lifestyle.fasting_practice ?? [],
    screening: ctx.screening,
  });
  const extraFlags: string[] = [];

  let energy: EnergyResult | null = null;
  let macros: MacroResult | null = null;
  const trimester = m.pregnancy?.trimester;
  const person: PersonInput = {
    ageMonths: ageMonths ?? 0,
    sex: m.sex_at_birth,
    weightKg: m.weight_kg,
    heightCm: m.height_cm,
    activity: m.activity_level,
    pregnancy: pregnant
      ? {
          trimester: trimester === 1 || trimester === 2 || trimester === 3 ? trimester : null,
          gestationalDiabetes: !!m.pregnancy?.gestational_diabetes,
        }
      : undefined,
    lactation: breastfeeding ? { infantAgeMonths: null } : undefined,
    goals: m.goals.map((g) => ({
      goalType: g.goal_type as GoalType,
      isPrimary: g.is_primary,
      targetWeightKg: g.target_unit === 'kg' ? g.target_value : null,
    })),
    redFlagActive: flags.some((f) => f.hard && (f.stops === 'all' || f.stops === 'weight_goals')),
  };
  if (ageMonths === null) {
    extraFlags.push('missing_date_of_birth');
  } else {
    try {
      energy = calculateEnergy(person);
      macros = macroTargets(person, energy);
    } catch (err) {
      if (!(err instanceof MissingAnthropometricsError)) throw err;
      extraFlags.push('missing_measurements');
    }
  }

  const month = Number(ctx.today.slice(5, 7));
  const climate = climateBand(ctx.climateZone as ClimateZone | null, month);
  const hydration = dailyFluidTarget({
    ageMonths: ageMonths ?? 18 * 12,
    sex: m.sex_at_birth,
    weightKg: m.weight_kg,
    climate,
    activity: m.activity_level,
    pregnant,
    breastfeeding,
  });
  const meals = (m.lifestyle.meal_pattern ?? [])
    .filter((p): p is { meal: MealType; time: string } => isMeal(p.meal) && !!p.time)
    .map((p) => ({ mealType: p.meal, time: p.time }));
  const schedule = hydrationSchedule({
    dailyMl: hydration.dailyMl,
    isChild: minor,
    meals,
    wake: m.sleep_schedule.wake ?? null,
    sleep: m.sleep_schedule.bed ?? null,
  });

  return {
    member: m,
    ageMonths,
    lifeStage,
    minor,
    flags,
    riskFlags: [...riskFlagStrings(flags), ...extraFlags],
    escalation: escalationFor(flags, m.id, ctx.locale),
    energy,
    macros,
    hydration,
    schedule,
    childGuidance: minor ? childGuidance(m, ageMonths ?? 0, ctx.locale) : undefined,
    recommendationIds: matchRecommendations(ctx.recommendations, {
      lifeStage,
      ageMonths: ageMonths ?? 18 * 12,
      modules: m.special_modules,
      goals,
      conditions: m.conditions.map((c) => c.label.toLowerCase()),
    }),
    climate,
  };
}

// ---- child guidance (growth-first rhythm, 12 §9 "Children") ----

const GUIDANCE: Record<Locale, Record<string, string>> = {
  en: {
    dor: 'Offer, never force: you decide what and when, your child decides how much.',
    seconds: 'Seconds are always allowed when your child is hungry.',
    together: 'Eat together at regular times, slowly, with screens away.',
    water: 'Water is the main drink; keep milk for after meals so it does not fill them up first.',
    picky: 'Put one safe food on every plate next to anything new, with no pressure to taste.',
    autism:
      'Change one thing at a time: a familiar food in a new shape, or a new food in a familiar shape.',
    adhd: 'If appetite is low at midday, offer a bigger breakfast and a filling evening snack.',
    under7_fasting:
      'Children under 7 do not fast; they can join suhoor or open with a date at iftar.',
    infant:
      "Breast milk or formula on demand meets your baby's needs; no water or other drinks before 6 months.",
  },
  ur: {
    dor: 'پیش کریں، زبردستی نہ کریں: کیا اور کب آپ طے کریں، کتنا بچہ خود طے کرے۔',
    seconds: 'بھوک ہو تو بچہ دوبارہ لے سکتا ہے، اس کی ہمیشہ اجازت ہے۔',
    together: 'مقررہ وقت پر مل کر، آرام سے اور اسکرین کے بغیر کھائیں۔',
    water: 'پانی ہی اصل مشروب ہے؛ دودھ کھانے کے بعد دیں تاکہ پہلے پیٹ نہ بھر جائے۔',
    picky: 'ہر پلیٹ میں نئی چیز کے ساتھ ایک پسندیدہ محفوظ کھانا رکھیں، چکھنے کا دباؤ نہ ڈالیں۔',
    autism:
      'ایک وقت میں ایک ہی تبدیلی کریں: جانا پہچانا کھانا نئی شکل میں، یا نیا کھانا جانی پہچانی شکل میں۔',
    adhd: 'اگر دوپہر کو بھوک کم ہو تو ناشتہ بڑا اور شام کا ناشتہ پیٹ بھرنے والا دیں۔',
    under7_fasting:
      'سات سال سے کم بچے روزہ نہیں رکھتے؛ وہ سحری میں شامل ہو سکتے ہیں یا افطار کھجور سے کر سکتے ہیں۔',
    infant: 'چھ ماہ سے پہلے ماں کا دودھ یا فارمولا ہی کافی ہے؛ پانی یا کوئی اور مشروب نہ دیں۔',
  },
};

export function childGuidance(m: MemberContext, ageMonths: number, locale: Locale): string[] {
  const g = GUIDANCE[locale];
  if (ageMonths < 6) return [g.infant ?? ''];
  const out = [g.dor, g.seconds, g.together, g.water];
  if (m.special_modules.includes('picky_eater')) out.push(g.picky);
  if (m.special_modules.includes('autism')) out.push(g.autism);
  if (m.special_modules.includes('adhd')) out.push(g.adhd);
  if (ageMonths < 7 * 12 && (m.lifestyle.fasting_practice ?? []).length) out.push(g.under7_fasting);
  return out.filter((x): x is string => !!x);
}

// ---- recommendation matching on `applies_to` / `contraindications` (13 §3.9) ----

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function matchRecommendations(
  recs: readonly RecommendationRow[],
  m: {
    lifeStage: LifeStage;
    ageMonths: number;
    modules: string[];
    goals: string[];
    conditions: string[];
  },
  limit = 5,
): string[] {
  return recs
    .filter((r) => {
      const a = r.applies_to ?? {};
      const c = r.contraindications ?? {};
      const stages = arr(a.life_stages);
      if (stages.length && !stages.includes(m.lifeStage)) return false;
      const minAge = typeof a.min_age_months === 'number' ? a.min_age_months : 0;
      if (m.ageMonths < minAge) return false;
      const modules = arr(a.modules);
      if (modules.length && !modules.some((x) => m.modules.includes(x))) return false;
      const goals = arr(a.goals);
      if (goals.length && !goals.some((x) => m.goals.includes(x))) return false;
      if (arr(c.life_stages).includes(m.lifeStage)) return false;
      const maxAge = c.max_age_months_exclusive;
      if (typeof maxAge === 'number' && m.ageMonths < maxAge) return false;
      const contra = arr(c.conditions).map((x) => x.toLowerCase());
      if (contra.some((x) => m.conditions.some((label) => label.includes(x)))) return false;
      return true;
    })
    .slice(0, limit)
    .map((r) => r.id);
}

// ---- deterministic fallback summaries (used when the model's text fails a guardrail) ----

const ACTIVITY: Record<Locale, Record<string, string>> = {
  en: {
    sedentary: 'Mostly seated day',
    light: 'Lightly active',
    moderate: 'Moderately active',
    active: 'Active',
    very_active: 'Very active',
  },
  ur: {
    sedentary: 'زیادہ تر بیٹھ کر گزرنے والا دن',
    light: 'ہلکی سرگرمی',
    moderate: 'درمیانی سرگرمی',
    active: 'فعال',
    very_active: 'بہت فعال',
  },
};

export function templateSummary(c: ComputedMember, locale: Locale): string {
  const act = ACTIVITY[locale][c.member.activity_level] ?? '';
  const ml = c.hydration.dailyMl;
  if (c.minor) {
    if (locale === 'ur') {
      return `بڑھوتری کو ترجیح: باقاعدہ گھریلو کھانے، بھوک اور پیٹ بھرنے کے احساس پر توجہ۔${ml ? ` روزانہ تقریباً ${ml} ملی لیٹر پانی اور مشروبات۔` : ''}`;
    }
    return `Growth comes first: regular family meals and listening to hunger and fullness.${ml ? ` About ${ml} ml of water and drinks a day.` : ''}`;
  }
  if (!c.energy) {
    return locale === 'ur'
      ? `${act}۔ توانائی کا ہدف بنانے کے لیے قد اور وزن درج کریں۔ روزانہ تقریباً ${ml} ملی لیٹر پانی اور مشروبات۔`
      : `${act}. Add height and weight so we can set an energy target. About ${ml} ml of water and drinks a day.`;
  }
  return locale === 'ur'
    ? `${act}۔ روزانہ توانائی کا ہدف ${c.energy.targetKcal} کیلوری، اور تقریباً ${ml} ملی لیٹر پانی اور مشروبات۔`
    : `${act}. Daily energy target ${c.energy.targetKcal} kcal, with about ${ml} ml of water and drinks.`;
}

/** Numbers the model may restate for this member (numeric grounding, 12 §13.5). */
export function allowedNumbers(c: ComputedMember) {
  const e = c.energy;
  const adult = e?.displayToUser ? e : null;
  return {
    kcal: adult
      ? [
          adult.targetKcal,
          adult.maintenanceKcal,
          adult.bmrKcal ?? 0,
          Math.abs(adult.goalAdjustmentKcal),
        ]
      : [],
    g:
      c.macros && adult ? [c.macros.proteinG, c.macros.carbsG, c.macros.fatG, c.macros.fiberG] : [],
    ml: [c.hydration.dailyMl, ...c.schedule.map((w) => w.ml)],
    kg: !c.minor
      ? [
          c.member.weight_kg ?? 0,
          adult?.safeTargetWeightKg ?? 0,
          ...c.member.goals.map((g) => g.target_value ?? 0),
        ]
      : [],
    cm: !c.minor ? [c.member.height_cm ?? 0] : [],
  };
}

/** Snapshot of the inputs used, without names, dates of birth or free text (05 §10.1). */
export function inputSnapshot(c: ComputedMember, reason: string): Record<string, unknown> {
  return {
    reason,
    engine_version: CALCULATORS_VERSION,
    age_months: c.ageMonths,
    life_stage: c.lifeStage,
    sex_at_birth: c.member.sex_at_birth,
    height_cm: c.member.height_cm,
    weight_kg: c.member.weight_kg,
    activity_level: c.member.activity_level,
    goals: c.member.goals.map((g) => g.goal_type),
    special_modules: c.member.special_modules,
    medication_flags: [...new Set(c.member.medications.flatMap((m) => m.food_interaction_flags))],
    allergy_severities: c.member.allergies.map((a) => a.severity),
    climate: c.climate,
    flags: c.flags.map((f) => f.code),
  };
}
