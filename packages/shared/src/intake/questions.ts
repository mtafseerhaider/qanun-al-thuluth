import type { z } from 'zod';

import { CHILD_AGE_YEARS, FASTING_MIN_AGE_YEARS, type RedFlagCode } from '../constants/safety.ts';
import type {
  AllergyInput,
  FoodDislikeInput,
  FoodPreferenceInput,
  MedicalConditionInput,
  MedicationInput,
  MemberLifestyle,
  NutritionGoalInput,
  PregnancyProfileInput,
  SensoryProfileInput,
  SupplementInput,
} from '../domain/intake.ts';
import { goalAllowedForAge, RedFlagScreening, type MedicationFlag } from '../domain/intake.ts';
import type { GoalType, SexAtBirth, SpecialModule } from '../enums.ts';
import { ageInMonths } from '../utils/age.ts';
import { conditionByCode, DIABETES_CONDITION_KEYS } from './catalog.ts';

/**
 * Per-member adaptive intake engine (01 §7, 02 §5.3 and §7.3, 24 S2-04). Pure functions shared by
 * the app (which steps and questions to show, progress, completeness) and tests. Questions appear
 * only when relevant to the member's age, sex and selected special modules; the server re-checks
 * every safety rule (goal guard trigger, `ai-intake-assess` red flags).
 */

export const INTAKE_SCHEMA_VERSION = 1;

/**
 * Per-member steps in wizard order. Deviation from 02 §5.3: goals come after the special modules
 * because goal options depend on them (pregnancy and breastfeeding hide weight loss, 02 §7.3.8).
 */
export const MEMBER_INTAKE_STEPS = [
  'health',
  'allergies',
  'food',
  'lifestyle',
  'modules',
  'pregnancy',
  'sensory',
  'picky',
  'adhd',
  'goals',
] as const;
export type MemberIntakeStep = (typeof MEMBER_INTAKE_STEPS)[number];

// Draft shapes: the domain insert schemas' input types plus a client id per row, so a retried
// save is idempotent (upsert by id) and removed rows can be soft-deleted.
type WithId<T> = T & { id: string };
export type ConditionDraft = WithId<z.input<typeof MedicalConditionInput>>;
export type MedicationDraft = WithId<z.input<typeof MedicationInput>>;
export type SupplementDraft = WithId<z.input<typeof SupplementInput>>;
export type AllergyDraft = WithId<z.input<typeof AllergyInput>>;
export type FoodPreferenceDraft = WithId<z.input<typeof FoodPreferenceInput>>;
export type FoodDislikeDraft = WithId<z.input<typeof FoodDislikeInput>>;
export type GoalDraft = WithId<z.input<typeof NutritionGoalInput>>;
export type PregnancyDraft = WithId<z.input<typeof PregnancyProfileInput>> & {
  nausea?: 'none' | 'mild' | 'severe';
};
export type SensoryDraft = WithId<z.input<typeof SensoryProfileInput>>;

/** "None" must be explicit for conditions and allergies (01 §7.3), so lists carry a `none` flag. */
export interface ListAnswer<T> {
  none: boolean;
  items: T[];
}

export interface MemberIntakeAnswers {
  conditions?: ListAnswer<ConditionDraft>;
  medications?: ListAnswer<MedicationDraft>;
  supplements?: ListAnswer<SupplementDraft>;
  allergies?: ListAnswer<AllergyDraft>;
  likes?: FoodPreferenceDraft[];
  dislikes?: FoodDislikeDraft[];
  /** `food_preferences` rows with `is_safe_food = true` (autism and picky eater modules). */
  safeFoods?: FoodPreferenceDraft[];
  lifestyle?: z.input<typeof MemberLifestyle>;
  /** Undefined until the modules step is answered; `[]` is an explicit "none". */
  modules?: SpecialModule[];
  pregnancy?: PregnancyDraft;
  /** Guidance only: there is no column for these (02 §7.3.10); kept in the draft. */
  breastfeeding?: { feeding?: 'exclusive' | 'partial'; babyAgeMonths?: number };
  autism?: { diagnosis?: 'diagnosed' | 'assessment_pending' | 'suspected' };
  sensory?: SensoryDraft;
  picky?: {
    mealtimes?: 'calm' | 'sometimes_hard' | 'often_stressful';
    doctorGrowthConcern?: boolean;
  };
  adhd?: {
    stimulant?: 'yes' | 'no' | 'not_sure';
    /** Id of the stimulant's row in `medications` (kept in the shared medications list). */
    medicationId?: string;
    doseTime?: string;
    lowLunchAppetite?: boolean;
    scheduledSnacks?: boolean;
  };
  goals?: GoalDraft[];
  /** Red-flag screening (01 §7.6). Sent to `ai-intake-assess`; only resulting flags are stored. */
  screening?: Partial<z.input<typeof RedFlagScreening>>;
}

export interface IntakeMemberProfile {
  date_of_birth: string;
  sex_at_birth: SexAtBirth;
}

export interface IntakeContext {
  ageMonths: number;
  ageYears: number;
  minor: boolean;
  sex: SexAtBirth;
  /** Selected modules the member is eligible for (stale picks after an age or sex edit drop out). */
  modules: SpecialModule[];
  /** Eating-disorder history or concern answered "yes" (02 §7.3.5 `eating_concern`). */
  eatingConcern: boolean;
  /** Fasts or intends to fast (lifestyle fasting practice or the screening question). */
  fasting: boolean;
}

// Module eligibility (01 §7.6, 02 §7.3.9) --------------------------------------------------------

/**
 * Who can be offered each module. Pregnancy: female 12 to 55 (01 §7.6, FR-ONB-05). Breastfeeding:
 * female adult (01 §7.6), capped at 55 like pregnancy. Autism 18 months+, ADHD 3 years+, picky
 * eater 12 months+ (02 §7.3.9).
 */
export function moduleEligible(
  module: SpecialModule,
  p: { ageMonths: number; sex: SexAtBirth },
): boolean {
  const years = Math.floor(p.ageMonths / 12);
  switch (module) {
    case 'pregnancy':
      return p.sex === 'female' && years >= 12 && years <= 55;
    case 'breastfeeding':
      return p.sex === 'female' && years >= CHILD_AGE_YEARS && years <= 55;
    case 'autism':
      return p.ageMonths >= 18;
    case 'adhd':
      return p.ageMonths >= 36;
    case 'picky_eater':
      return p.ageMonths >= 12;
  }
}

const MODULE_ORDER: readonly SpecialModule[] = [
  'pregnancy',
  'breastfeeding',
  'autism',
  'picky_eater',
  'adhd',
];

export function moduleOptionsFor(p: { ageMonths: number; sex: SexAtBirth }): SpecialModule[] {
  return MODULE_ORDER.filter((m) => moduleEligible(m, p));
}

/** Toggles a module; pregnancy and breastfeeding are mutually exclusive in one entry (02 §7.3.9). */
export function toggleModule(
  selected: readonly SpecialModule[],
  m: SpecialModule,
): SpecialModule[] {
  if (selected.includes(m)) return selected.filter((x) => x !== m);
  const exclusive: Partial<Record<SpecialModule, SpecialModule>> = {
    pregnancy: 'breastfeeding',
    breastfeeding: 'pregnancy',
  };
  const drop = exclusive[m];
  return [...selected.filter((x) => x !== drop), m];
}

// Context ----------------------------------------------------------------------------------------

export function intakeContext(
  member: IntakeMemberProfile,
  answers: MemberIntakeAnswers = {},
  today: string | Date = new Date(),
): IntakeContext {
  const months = ageInMonths(member.date_of_birth, today);
  const years = Math.floor(months / 12);
  const base = { ageMonths: months, sex: member.sex_at_birth };
  const modules = (answers.modules ?? []).filter((m) => moduleEligible(m, base));
  const s = answers.screening ?? {};
  return {
    ageMonths: months,
    ageYears: years,
    minor: years < CHILD_AGE_YEARS,
    sex: member.sex_at_birth,
    modules,
    eatingConcern: s.eating_disorder_history === 'yes',
    fasting:
      years >= FASTING_MIN_AGE_YEARS &&
      ((answers.lifestyle?.fasting_practice?.length ?? 0) > 0 || s.intends_to_fast === true),
  };
}

// Questions --------------------------------------------------------------------------------------

export const QUESTION_IDS = [
  'health.conditions',
  'health.medications',
  'health.supplements',
  'screen.weight_change',
  'screen.eating_concern',
  'screen.food_groups',
  'screen.gagging',
  'screen.intends_to_fast',
  'screen.fasting_symptoms',
  'allergies.list',
  'food.likes',
  'food.dislikes',
  'lifestyle.meal_pattern',
  'lifestyle.eats_out',
  'lifestyle.screens',
  'lifestyle.water',
  'lifestyle.caffeine',
  'lifestyle.sugary_drinks',
  'lifestyle.exercise',
  'lifestyle.fasting_practice',
  'modules.select',
  'pregnancy.due_date',
  'pregnancy.gestational_diabetes',
  'pregnancy.nausea',
  'screen.pregnancy_vomiting',
  'breastfeeding.feeding',
  'breastfeeding.baby_age',
  'autism.diagnosis',
  'sensory.textures',
  'sensory.colours',
  'sensory.presentation',
  'sensory.temperature',
  'sensory.brand',
  'picky.safe_foods',
  'picky.mealtimes',
  'picky.growth_concern',
  'adhd.stimulant',
  'adhd.dose_time',
  'adhd.appetite',
  'goals.select',
] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

export interface QuestionDef {
  id: QuestionId;
  step: MemberIntakeStep;
  /** Required questions block "complete" for the member (01 §7: "Required"); others add quality. */
  required: (ctx: IntakeContext) => boolean;
  when: (ctx: IntakeContext, a: MemberIntakeAnswers) => boolean;
  answered: (a: MemberIntakeAnswers) => boolean;
}

const always = () => true;
const never = () => false;
const has = <T extends object>(o: T | undefined, k: keyof T) => o !== undefined && k in o;
const hasModule =
  (...m: SpecialModule[]) =>
  (ctx: IntakeContext) =>
    m.some((x) => ctx.modules.includes(x));
const listAnswered = (l: ListAnswer<unknown> | undefined) =>
  l !== undefined && (l.none || l.items.length > 0);
const lifestyleHas = (k: keyof z.input<typeof MemberLifestyle>) => (a: MemberIntakeAnswers) =>
  a.lifestyle?.[k] !== undefined;

export const QUESTIONS: readonly QuestionDef[] = [
  // Health (01 §7.3)
  {
    id: 'health.conditions',
    step: 'health',
    required: always,
    when: always,
    answered: (a) => listAnswered(a.conditions),
  },
  {
    id: 'health.medications',
    step: 'health',
    required: never,
    when: always,
    answered: (a) => listAnswered(a.medications),
  },
  {
    id: 'health.supplements',
    step: 'health',
    required: never,
    when: always,
    answered: (a) => listAnswered(a.supplements),
  },
  {
    id: 'screen.weight_change',
    step: 'health',
    required: always, // "Yes for adults and children" (01 §7.3)
    when: always,
    answered: (a) => has(a.screening, 'unintended_weight_change'),
  },
  {
    id: 'screen.eating_concern',
    step: 'health',
    required: always,
    when: (ctx) => ctx.ageYears >= 12, // asked sensitively, 12+ only (01 §7.3)
    answered: (a) => a.screening?.eating_disorder_history !== undefined,
  },
  {
    id: 'screen.food_groups',
    step: 'health',
    required: never,
    when: (ctx) => ctx.minor && ctx.ageMonths >= 12,
    answered: (a) => has(a.screening, 'refuses_food_groups_with_weight_loss'),
  },
  {
    id: 'screen.gagging',
    step: 'health',
    required: never,
    when: (ctx) => ctx.minor && ctx.ageMonths >= 6,
    answered: (a) => has(a.screening, 'gags_on_most_textures'),
  },
  {
    id: 'screen.intends_to_fast',
    step: 'health',
    required: never,
    when: (ctx) => ctx.ageYears >= FASTING_MIN_AGE_YEARS,
    answered: (a) => has(a.screening, 'intends_to_fast'),
  },
  {
    id: 'screen.fasting_symptoms',
    step: 'health',
    required: never,
    when: (ctx) => ctx.fasting,
    answered: (a) => has(a.screening, 'faint_or_dark_urine_when_fasting'),
  },
  // Allergies
  {
    id: 'allergies.list',
    step: 'allergies',
    required: always,
    when: always,
    answered: (a) => listAnswered(a.allergies),
  },
  // Food likes and dislikes
  {
    id: 'food.likes',
    step: 'food',
    required: never,
    when: always,
    answered: (a) => (a.likes?.length ?? 0) > 0,
  },
  {
    id: 'food.dislikes',
    step: 'food',
    required: never,
    when: always,
    answered: (a) => (a.dislikes?.length ?? 0) > 0,
  },
  // Lifestyle (01 §7.4)
  {
    id: 'lifestyle.meal_pattern',
    step: 'lifestyle',
    required: never,
    when: always,
    answered: lifestyleHas('meal_pattern'),
  },
  {
    id: 'lifestyle.eats_out',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageYears >= 4,
    answered: lifestyleHas('eats_out'),
  },
  {
    id: 'lifestyle.screens',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageMonths >= 12,
    answered: lifestyleHas('screens_at_meals'),
  },
  {
    id: 'lifestyle.water',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageMonths >= 12,
    answered: lifestyleHas('water_glasses_per_day'),
  },
  {
    id: 'lifestyle.caffeine',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageYears >= 12,
    answered: lifestyleHas('caffeine'),
  },
  {
    id: 'lifestyle.sugary_drinks',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageYears >= 2,
    answered: lifestyleHas('sugary_drinks_per_week'),
  },
  {
    id: 'lifestyle.exercise',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageYears >= 5,
    answered: lifestyleHas('exercise_minutes_per_week'),
  },
  {
    id: 'lifestyle.fasting_practice',
    step: 'lifestyle',
    required: never,
    when: (ctx) => ctx.ageYears >= FASTING_MIN_AGE_YEARS,
    answered: (a) => a.lifestyle?.fasting_practice !== undefined,
  },
  // Special modules
  {
    id: 'modules.select',
    step: 'modules',
    required: never,
    when: (ctx) => moduleOptionsFor(ctx).length > 0,
    answered: (a) => a.modules !== undefined,
  },
  {
    id: 'pregnancy.due_date',
    step: 'pregnancy',
    required: never,
    when: hasModule('pregnancy'),
    answered: (a) => Boolean(a.pregnancy?.due_date) || Boolean(a.pregnancy?.trimester),
  },
  {
    id: 'pregnancy.gestational_diabetes',
    step: 'pregnancy',
    required: never,
    when: hasModule('pregnancy'),
    answered: (a) => a.pregnancy?.gestational_diabetes !== undefined,
  },
  {
    id: 'pregnancy.nausea',
    step: 'pregnancy',
    required: never,
    when: hasModule('pregnancy'),
    answered: (a) => a.pregnancy?.nausea !== undefined,
  },
  {
    id: 'screen.pregnancy_vomiting',
    step: 'pregnancy',
    required: never,
    when: hasModule('pregnancy'),
    answered: (a) => has(a.screening, 'pregnancy_vomiting_cannot_keep_fluids'),
  },
  {
    id: 'breastfeeding.feeding',
    step: 'pregnancy',
    required: never,
    when: hasModule('breastfeeding'),
    answered: (a) => a.breastfeeding?.feeding !== undefined,
  },
  {
    id: 'breastfeeding.baby_age',
    step: 'pregnancy',
    required: never,
    when: hasModule('breastfeeding'),
    answered: (a) => a.breastfeeding?.babyAgeMonths !== undefined,
  },
  {
    id: 'autism.diagnosis',
    step: 'sensory',
    required: never,
    when: hasModule('autism'),
    answered: (a) => a.autism?.diagnosis !== undefined,
  },
  {
    id: 'sensory.textures',
    step: 'sensory',
    required: never,
    when: hasModule('autism'),
    answered: (a) =>
      (a.sensory?.texture_likes?.length ?? 0) + (a.sensory?.texture_avoids?.length ?? 0) > 0,
  },
  {
    id: 'sensory.colours',
    step: 'sensory',
    required: never,
    when: hasModule('autism'),
    answered: (a) => (a.sensory?.color_sensitivities?.length ?? 0) > 0,
  },
  {
    id: 'sensory.presentation',
    step: 'sensory',
    required: never,
    when: hasModule('autism'),
    answered: (a) => Object.keys(a.sensory?.presentation_prefs ?? {}).length > 0,
  },
  {
    id: 'sensory.temperature',
    step: 'sensory',
    required: never,
    when: hasModule('autism'),
    answered: (a) => (a.sensory?.temperature_prefs?.length ?? 0) > 0,
  },
  {
    id: 'sensory.brand',
    step: 'sensory',
    required: never,
    when: hasModule('autism'),
    answered: (a) => a.sensory?.brand_rigidity !== undefined,
  },
  {
    id: 'picky.safe_foods',
    step: 'picky',
    required: never,
    when: hasModule('autism', 'picky_eater'),
    answered: (a) => (a.safeFoods?.length ?? 0) > 0,
  },
  {
    id: 'picky.mealtimes',
    step: 'picky',
    required: never,
    when: hasModule('autism', 'picky_eater'),
    answered: (a) => a.picky?.mealtimes !== undefined,
  },
  {
    id: 'picky.growth_concern',
    step: 'picky',
    required: never,
    when: hasModule('picky_eater'),
    answered: (a) => a.picky?.doctorGrowthConcern !== undefined,
  },
  {
    id: 'adhd.stimulant',
    step: 'adhd',
    required: never,
    when: hasModule('adhd'),
    answered: (a) => a.adhd?.stimulant !== undefined,
  },
  {
    id: 'adhd.dose_time',
    step: 'adhd',
    required: never,
    when: (ctx, a) => ctx.modules.includes('adhd') && a.adhd?.stimulant === 'yes',
    answered: (a) => Boolean(a.adhd?.doseTime),
  },
  {
    id: 'adhd.appetite',
    step: 'adhd',
    required: never,
    when: hasModule('adhd'),
    answered: (a) =>
      a.adhd?.lowLunchAppetite !== undefined || a.lifestyle?.appetite_pattern !== undefined,
  },
  // Goals (01 §7.5)
  {
    id: 'goals.select',
    step: 'goals',
    required: always,
    when: always,
    answered: (a) => (a.goals?.length ?? 0) > 0,
  },
];

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export function questionById(id: QuestionId): QuestionDef {
  const q = BY_ID.get(id);
  if (!q) throw new Error(`Unknown intake question ${id}`);
  return q;
}

export function isQuestionVisible(
  id: QuestionId,
  ctx: IntakeContext,
  a: MemberIntakeAnswers = {},
): boolean {
  return questionById(id).when(ctx, a);
}

export function visibleQuestions(
  ctx: IntakeContext,
  a: MemberIntakeAnswers = {},
  step?: MemberIntakeStep,
): QuestionDef[] {
  return QUESTIONS.filter((q) => (step === undefined || q.step === step) && q.when(ctx, a));
}

/** The member's steps, in order, that have at least one visible question. */
export function visibleSteps(ctx: IntakeContext, a: MemberIntakeAnswers = {}): MemberIntakeStep[] {
  return MEMBER_INTAKE_STEPS.filter((s) => visibleQuestions(ctx, a, s).length > 0);
}

export function nextIntakeStep(
  ctx: IntakeContext,
  a: MemberIntakeAnswers,
  current: MemberIntakeStep,
): MemberIntakeStep | null {
  const order = MEMBER_INTAKE_STEPS.indexOf(current);
  return visibleSteps(ctx, a).find((s) => MEMBER_INTAKE_STEPS.indexOf(s) > order) ?? null;
}

export function previousIntakeStep(
  ctx: IntakeContext,
  a: MemberIntakeAnswers,
  current: MemberIntakeStep,
): MemberIntakeStep | null {
  const order = MEMBER_INTAKE_STEPS.indexOf(current);
  const before = visibleSteps(ctx, a).filter((s) => MEMBER_INTAKE_STEPS.indexOf(s) < order);
  return before[before.length - 1] ?? null;
}

// Completeness (01 §6.3 step 5 "plan quality indicator") --------------------------------------

export interface Completeness {
  answered: number;
  total: number;
  /** 0 to 100: share of visible questions answered, with required questions weighted double. */
  score: number;
  requiredMissing: QuestionId[];
  /** Every required question is answered, so the member can be assessed without defaults. */
  complete: boolean;
}

export function completeness(ctx: IntakeContext, a: MemberIntakeAnswers = {}): Completeness {
  const qs = visibleQuestions(ctx, a);
  let weight = 0;
  let got = 0;
  let answered = 0;
  const requiredMissing: QuestionId[] = [];
  for (const q of qs) {
    const req = q.required(ctx);
    const w = req ? 2 : 1;
    weight += w;
    if (q.answered(a)) {
      got += w;
      answered += 1;
    } else if (req) requiredMissing.push(q.id);
  }
  return {
    answered,
    total: qs.length,
    score: weight === 0 ? 100 : Math.round((got / weight) * 100),
    requiredMissing,
    complete: requiredMissing.length === 0,
  };
}

/** Household score: the mean of member scores (0 when there are no members). */
export function householdCompleteness(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
}

// Goals (01 §7.5, 02 §7.3.8) ---------------------------------------------------------------------

const MINOR_SHOWN_GOALS: readonly GoalType[] = ['child_growth', 'energy', 'digestive_health'];
const ADULT_GOALS: readonly GoalType[] = [
  'maintain',
  'weight_loss',
  'weight_gain',
  'energy',
  'digestive_health',
  'blood_sugar',
  'heart_health',
  'pregnancy_support',
  'breastfeeding_support',
];

/**
 * Goal options for the member. Under 18: growth, energy and digestive health only; weight goals are
 * never offered (P3, 02 §1.1 rule 2). Adults: weight loss is hidden when pregnant, breastfeeding or
 * with an eating concern; weight gain is also hidden with an eating concern. Every option passes
 * `goalAllowedForAge`, the mirror of the server guard.
 */
export function goalOptionsFor(ctx: IntakeContext): GoalType[] {
  const base = ctx.minor ? MINOR_SHOWN_GOALS : ADULT_GOALS;
  return base.filter((g) => {
    if (!goalAllowedForAge(g, ctx.ageYears)) return false;
    if (g === 'pregnancy_support') return ctx.modules.includes('pregnancy');
    if (g === 'breastfeeding_support') return ctx.modules.includes('breastfeeding');
    if (g === 'weight_loss')
      return (
        !ctx.eatingConcern &&
        !ctx.modules.includes('pregnancy') &&
        !ctx.modules.includes('breastfeeding')
      );
    if (g === 'weight_gain') return !ctx.eatingConcern;
    return true;
  });
}

export function defaultGoalFor(ctx: IntakeContext): GoalType {
  if (ctx.minor) return 'child_growth';
  if (ctx.modules.includes('pregnancy')) return 'pregnancy_support';
  if (ctx.modules.includes('breastfeeding')) return 'breastfeeding_support';
  return 'maintain';
}

export const MAX_GOALS = 3;

/** Drops goals no longer offered (age, modules, eating concern) and keeps exactly one primary. */
export function sanitizeGoals(goals: readonly GoalDraft[], ctx: IntakeContext): GoalDraft[] {
  const allowed = new Set(goalOptionsFor(ctx));
  const kept = goals.filter((g) => allowed.has(g.goal_type)).slice(0, MAX_GOALS);
  if (kept.length === 0) return [];
  const primary = kept.findIndex((g) => g.is_primary);
  return kept.map((g, i) => ({ ...g, is_primary: i === (primary === -1 ? 0 : primary) }));
}

export interface WeightTargetCheck {
  /** Target BMI under 18.5 is blocked (01 §7.5). */
  belowBmiFloor: boolean;
  /** Planned loss above 1 percent of body weight a week (warning, 01 §7.5). */
  tooFast: boolean;
  weeklyChangeKg: number | null;
}

export function checkWeightTarget(p: {
  heightCm: number | null | undefined;
  weightKg: number | null | undefined;
  targetKg: number;
  targetDate?: string | null | undefined;
  today?: string | Date;
}): WeightTargetCheck {
  const bmi = p.heightCm ? p.targetKg / (p.heightCm / 100) ** 2 : null;
  let weekly: number | null = null;
  if (p.targetDate && p.weightKg) {
    const start = new Date(typeof p.today === 'string' ? p.today : (p.today ?? new Date()));
    const end = new Date(p.targetDate);
    const weeks = (end.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000);
    if (weeks > 0) weekly = (p.weightKg - p.targetKg) / weeks;
  }
  return {
    belowBmiFloor: bmi !== null && bmi < 18.5,
    tooFast:
      weekly !== null && p.weightKg !== null && p.weightKg !== undefined
        ? weekly > p.weightKg * 0.01
        : false,
    weeklyChangeKg: weekly,
  };
}

// Red flags (00 §10.2, 01 §7.6) ----------------------------------------------------------------

const FASTING_RISK_FLAGS: readonly MedicationFlag[] = ['insulin', 'sulfonylurea'];

export function isDiabetesCondition(c: { condition_code?: string | null | undefined }): boolean {
  const key = conditionByCode(c.condition_code)?.key;
  return key !== undefined && (DIABETES_CONDITION_KEYS as readonly string[]).includes(key);
}

/**
 * `medical_conditions.on_insulin_or_sulfonylurea` for a condition row: true for type 1 diabetes,
 * and for type 2 diabetes when any medication is flagged insulin or sulfonylurea.
 */
export function onInsulinOrSulfonylurea(
  condition: { condition_code?: string | null | undefined },
  medications: readonly { food_interaction_flags?: readonly MedicationFlag[] | undefined }[],
): boolean {
  if (!isDiabetesCondition(condition)) return false;
  if (conditionByCode(condition.condition_code)?.key === 'type_1_diabetes') return true;
  return medications.some((m) =>
    (m.food_interaction_flags ?? []).some((f) => FASTING_RISK_FLAGS.includes(f)),
  );
}

/** True when the member's answers put them at fasting hypoglycaemia risk (shown before fasting is asked). */
export function hasFastingMedicationRisk(a: MemberIntakeAnswers): boolean {
  const meds = a.medications?.none ? [] : (a.medications?.items ?? []);
  return (a.conditions?.items ?? []).some((c) => onInsulinOrSulfonylurea(c, meds));
}

export type IntakeRedFlag = RedFlagCode | 'feeding_gagging';

/**
 * Client preview of the red flags in a member's answers, so the app can show clinician guidance
 * immediately (02 §7.3.5, §7.3.15). `ai-intake-assess` re-derives the authoritative flags.
 */
export function intakeRedFlags(ctx: IntakeContext, a: MemberIntakeAnswers): IntakeRedFlag[] {
  const s = a.screening ?? {};
  const flags = new Set<IntakeRedFlag>();
  if (hasFastingMedicationRisk(a) && ctx.fasting) flags.add('insulin_or_sulfonylurea_fasting');
  if (s.eating_disorder_history === 'yes' || s.refuses_food_groups_with_weight_loss === true)
    flags.add('eating_disorder_signals');
  const change = s.unintended_weight_change;
  if (ctx.minor && change && change.kg < 0) flags.add('rapid_child_weight_loss');
  if (s.faint_or_dark_urine_when_fasting === true) flags.add('dehydration_signs');
  if (s.pregnancy_vomiting_cannot_keep_fluids === true) flags.add('pregnancy_complication');
  if (!a.allergies?.none && (a.allergies?.items ?? []).some((x) => x.severity === 'anaphylactic'))
    flags.add('severe_allergy_reaction');
  if (s.gags_on_most_textures === true) flags.add('feeding_gagging');
  return [...flags];
}

/** The member's screening answers in the `ai-intake-assess` request shape. */
export function screeningFor(a: MemberIntakeAnswers): RedFlagScreening {
  return RedFlagScreening.parse(a.screening ?? {});
}
