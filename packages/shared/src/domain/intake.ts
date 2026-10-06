import { z } from 'zod';

import { CHILD_AGE_YEARS } from '../constants/safety.ts';
import { FAST_KINDS, GOAL_TYPES, SEVERITIES, TEXTURES } from '../enums.ts';
import type { GoalType } from '../enums.ts';

/**
 * Intake schemas for onboarding step 5 (01-product-requirements §7). Each schema is the insert
 * shape for its table in 05-database-schema.md; `household_id` and `family_member_id` are added
 * by the caller. Columns marked "Addition" in §7 live in `households.preferences` and
 * `family_members.lifestyle` jsonb.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Label = z.string().trim().min(1).max(120);
const Notes = z.string().trim().max(2000);

// 7.1 Household preferences (`households.preferences`)

export const CUISINES = [
  'pakistani',
  'north_indian',
  'afghan',
  'arab',
  'persian',
  'turkish',
  'british',
  'continental',
] as const;
export const KITCHEN_EQUIPMENT = [
  'pressure_cooker',
  'oven',
  'air_fryer',
  'blender',
  'microwave',
  'tandoor_access',
] as const;
export const SHOPPING_CADENCES = ['weekly_fresh_monthly_staples', 'weekly_only', 'ad_hoc'] as const;
export const BATCH_COOKING = ['none', 'some', 'weekly_batch_day'] as const;
export const HALAL_STRICTNESS = ['certified_only', 'ingredient_checked', 'standard'] as const;
export const SHARED_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export const HouseholdPreferences = z.object({
  cuisines: z.array(z.enum(CUISINES)).default(['pakistani']),
  cooking_minutes: z
    .object({
      weekday: z.number().int().min(0).max(300),
      weekend: z.number().int().min(0).max(480),
    })
    .optional(),
  equipment: z.array(z.enum(KITCHEN_EQUIPMENT)).default([]),
  batch_cooking: z.enum(BATCH_COOKING).default('none'),
  shopping_cadence: z.enum(SHOPPING_CADENCES).optional(),
  shared_meals: z.array(z.enum(SHARED_MEALS)).default([]),
  halal_strictness: z.enum(HALAL_STRICTNESS).default('ingredient_checked'),
});
export type HouseholdPreferences = z.infer<typeof HouseholdPreferences>;

// 7.4 Lifestyle (`family_members.lifestyle`)

export const FREQUENCY_3 = ['never', 'sometimes', 'usually'] as const;
export const APPETITE_PATTERNS = [
  'steady',
  'low_morning',
  'low_midday',
  'low_evening',
  'variable',
] as const;

export const MemberLifestyle = z.object({
  meal_pattern: z
    .array(
      z.object({
        meal: z.enum(['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar']),
        time: HhMm.optional(),
      }),
    )
    .max(8)
    .optional(),
  eats_out: z
    .object({
      school_lunch: z.boolean().default(false),
      office_canteen: z.boolean().default(false),
      packed_lunch: z.boolean().default(false),
      takeaway_per_week: z.number().int().min(0).max(21).default(0),
    })
    .optional(),
  screens_at_meals: z.enum(FREQUENCY_3).optional(),
  water_glasses_per_day: z.number().int().min(0).max(30).optional(),
  caffeine: z
    .object({
      cups_per_day: z.number().int().min(0).max(20),
      with_meals: z.boolean().default(false),
    })
    .optional(),
  sugary_drinks_per_week: z.number().int().min(0).max(70).optional(),
  exercise_minutes_per_week: z.number().int().min(0).max(3000).optional(),
  fasting_practice: z.array(z.enum(FAST_KINDS)).default([]),
  appetite_pattern: z.enum(APPETITE_PATTERNS).optional(),
});
export type MemberLifestyle = z.infer<typeof MemberLifestyle>;

// 7.3 Health

export const MedicalConditionInput = z.object({
  condition_code: z.string().trim().max(20).nullable().optional(),
  label: Label,
  diagnosed_on: IsoDate.nullable().optional(),
  notes: Notes.nullable().optional(),
  on_insulin_or_sulfonylurea: z.boolean().default(false),
});
export type MedicalConditionInput = z.infer<typeof MedicalConditionInput>;

export const AllergyInput = z.object({
  allergen_id: z.string().uuid(),
  kind: z.enum(['allergy', 'intolerance']).default('allergy'),
  severity: z.enum(SEVERITIES),
  reaction_notes: Notes.nullable().optional(),
});
export type AllergyInput = z.infer<typeof AllergyInput>;

/** Curated food-interaction flags set by the app from the medication name (§7.3). */
export const MEDICATION_FLAGS = [
  'insulin',
  'sulfonylurea',
  'metformin',
  'warfarin_vitamin_k',
  'maoi_tyramine',
  'levothyroxine_timing',
  'stimulant_appetite_suppression',
  'iron_calcium_spacing',
] as const;
export type MedicationFlag = (typeof MEDICATION_FLAGS)[number];

/** Lower-case name fragments that map to a flag. Clinician-reviewed list to come; deliberately small. */
const MEDICATION_PATTERNS: ReadonlyArray<[RegExp, MedicationFlag]> = [
  [/insulin|glargine|lantus|novorapid|humalog|mixtard|detemir|degludec/, 'insulin'],
  [/glibenclamide|glyburide|gliclazide|glimepiride|glipizide|diamicron|amaryl/, 'sulfonylurea'],
  [/metformin|glucophage/, 'metformin'],
  [/warfarin|coumadin|acenocoumarol/, 'warfarin_vitamin_k'],
  [/phenelzine|tranylcypromine|isocarboxazid|selegiline|moclobemide/, 'maoi_tyramine'],
  [/levothyroxine|thyroxine|euthyrox|eltroxin/, 'levothyroxine_timing'],
  [
    /methylphenidate|ritalin|concerta|amphetamine|lisdexamfetamine|vyvanse|adderall/,
    'stimulant_appetite_suppression',
  ],
  [/ferrous|iron|calcium/, 'iron_calcium_spacing'],
];

export function medicationFlagsFor(name: string): MedicationFlag[] {
  const n = name.toLowerCase();
  const flags = new Set<MedicationFlag>();
  for (const [pattern, flag] of MEDICATION_PATTERNS) if (pattern.test(n)) flags.add(flag);
  return [...flags];
}

export const MedicationInput = z.object({
  name: Label,
  dose: z.string().trim().max(40).nullable().optional(),
  frequency: z.string().trim().max(40).nullable().optional(),
  food_interaction_flags: z.array(z.enum(MEDICATION_FLAGS)).default([]),
});
export type MedicationInput = z.infer<typeof MedicationInput>;

export const SupplementInput = z.object({
  name: Label,
  dose: z.string().trim().max(40).nullable().optional(),
  frequency: z.string().trim().max(40).nullable().optional(),
});
export type SupplementInput = z.infer<typeof SupplementInput>;

export const PregnancyProfileInput = z.object({
  trimester: z.number().int().min(1).max(3).nullable().optional(),
  due_date: IsoDate.nullable().optional(),
  gestational_diabetes: z.boolean().default(false),
});
export type PregnancyProfileInput = z.infer<typeof PregnancyProfileInput>;

// 7.4 Preferences and dislikes

export const FoodPreferenceInput = z
  .object({
    ingredient_id: z.string().uuid().nullable().optional(),
    recipe_id: z.string().uuid().nullable().optional(),
    label: Label,
    strength: z.number().int().min(1).max(3).default(2),
    is_safe_food: z.boolean().default(false),
  })
  .strict();
export type FoodPreferenceInput = z.infer<typeof FoodPreferenceInput>;

export const DISLIKE_REASONS = [
  'taste',
  'texture',
  'smell',
  'color',
  'religious',
  'other',
] as const;
export const FoodDislikeInput = z.object({
  ingredient_id: z.string().uuid().nullable().optional(),
  label: Label,
  reason: z.enum(DISLIKE_REASONS).default('taste'),
});
export type FoodDislikeInput = z.infer<typeof FoodDislikeInput>;

// 7.6 Autism sensory profile

export const TEMPERATURES = ['hot', 'warm', 'room', 'cold'] as const;
export const CUT_SHAPES = ['strips', 'circles', 'squares', 'triangles', 'whole'] as const;

export const SensoryProfileInput = z
  .object({
    texture_likes: z.array(z.enum(TEXTURES)).default([]),
    texture_avoids: z.array(z.enum(TEXTURES)).default([]),
    color_sensitivities: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
    presentation_prefs: z
      .object({
        separate_foods: z.boolean().optional(),
        same_plate: z.boolean().optional(),
        divided_plate: z.boolean().optional(),
        cut_shapes: z.array(z.enum(CUT_SHAPES)).optional(),
        sauce_on_side: z.boolean().optional(),
        specific_utensils: z.boolean().optional(),
      })
      .default({}),
    temperature_prefs: z.array(z.enum(TEMPERATURES)).default([]),
    brand_rigidity: z.boolean().default(false),
  })
  .refine((p) => !p.texture_likes.some((t) => p.texture_avoids.includes(t)), {
    message: 'A texture cannot be both liked and avoided',
    path: ['texture_avoids'],
  });
export type SensoryProfileInput = z.infer<typeof SensoryProfileInput>;

// 7.5 Goals

/** Goals a member under 18 may hold (§7.5). Mirrors the DB guard trigger (S2-03). */
export const MINOR_ALLOWED_GOALS = [
  'child_growth',
  'energy',
  'digestive_health',
  'maintain',
] as const satisfies readonly GoalType[];

export function goalAllowedForAge(goal: GoalType, ageYears: number): boolean {
  if (ageYears >= CHILD_AGE_YEARS) return true;
  return (MINOR_ALLOWED_GOALS as readonly GoalType[]).includes(goal);
}

export const TARGET_UNITS = [
  'kg',
  'kg_per_week',
  'cm',
  'mmol_l',
  'mg_dl',
  'ml_per_day',
  'servings_per_day',
  'percent',
  'kcal_per_day',
] as const;

export const NutritionGoalInput = z
  .object({
    goal_type: z.enum(GOAL_TYPES),
    target_value: z.number().nullable().optional(),
    target_unit: z.enum(TARGET_UNITS).nullable().optional(),
    target_date: IsoDate.nullable().optional(),
    is_primary: z.boolean().default(false),
  })
  .refine((g) => (g.target_value == null) === (g.target_unit == null), {
    message: 'Target value and unit go together',
    path: ['target_unit'],
  });
export type NutritionGoalInput = z.infer<typeof NutritionGoalInput>;

/** Validates a member's goals against their age; returns the goals that are not allowed. */
export function disallowedGoalsForAge(goals: readonly GoalType[], ageYears: number): GoalType[] {
  return goals.filter((g) => !goalAllowedForAge(g, ageYears));
}

// Red-flag screening (§7.6 end). Answers feed `ai-intake-assess`; only flags are stored.

export const RedFlagScreening = z.object({
  unintended_weight_change: z
    .object({ kg: z.number().min(-100).max(100), months: z.number().int().min(1).max(24) })
    .nullable()
    .default(null),
  eating_disorder_history: z.enum(['prefer_not_to_say', 'no', 'yes']).optional(),
  refuses_food_groups_with_weight_loss: z.boolean().default(false),
  gags_on_most_textures: z.boolean().default(false),
  faint_or_dark_urine_when_fasting: z.boolean().default(false),
  intends_to_fast: z.boolean().default(false),
  pregnancy_vomiting_cannot_keep_fluids: z.boolean().default(false),
});
export type RedFlagScreening = z.infer<typeof RedFlagScreening>;
