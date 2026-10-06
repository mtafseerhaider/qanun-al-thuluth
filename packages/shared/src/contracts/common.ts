import { z } from 'zod';

import {
  EVIDENCE_GRADES_HADITH,
  EVIDENCE_GRADES_SCIENCE,
  FAST_KINDS,
  HOUSEHOLD_ROLES,
  MEAL_STATUSES,
  MEAL_TYPES,
  PLAN_KINDS,
  PLAN_STATUSES,
  SOURCE_KINDS,
  SOURCE_TRADITIONS,
  TEXTURES,
} from '../enums.ts';

/** Shared Zod primitives from docs/06-api-specification.md §2.9. */
export const Uuid = z.string().uuid();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const IsoInstant = z.string().datetime({ offset: true });
export const Locale = z.enum(['en', 'ur']);
export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/);
export const Money = z.object({ amount_minor: z.number().int(), currency: CurrencyCode });

export const MealType = z.enum(MEAL_TYPES);
export const MealStatus = z.enum(MEAL_STATUSES);
export const PlanStatus = z.enum(PLAN_STATUSES);
export const PlanKind = z.enum(PLAN_KINDS);
export const HouseholdRole = z.enum(HOUSEHOLD_ROLES);
export const SourceTradition = z.enum(SOURCE_TRADITIONS);
export const SourceKind = z.enum(SOURCE_KINDS);
export const EvidenceGradeHadith = z.enum(EVIDENCE_GRADES_HADITH);
export const EvidenceGradeScience = z.enum(EVIDENCE_GRADES_SCIENCE);
export const FastKind = z.enum(FAST_KINDS);
export const Texture = z.enum(TEXTURES);
export const ExportKind = z.enum([
  'meal_plan',
  'grocery_list',
  'nutrition_report',
  'growth_report',
  'ramadan_pack',
  'family_summary',
]);

export const PlateSplit = z.object({
  veg_fruit: z.number().min(0).max(1),
  protein: z.number().min(0).max(1),
  carb: z.number().min(0).max(1),
});

export const NutritionEstimate = z.object({
  kcal: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative(),
  sugar_g: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative(),
  sat_fat_g: z.number().nonnegative().optional(),
  sodium_mg: z.number().nonnegative().optional(),
  iron_mg: z.number().nonnegative().optional(),
  calcium_mg: z.number().nonnegative().optional(),
});

/** Red-flag escalation payload (00-foundations §10.2). */
export const EscalationReason = z.enum([
  'eating_disorder_signals',
  'rapid_child_weight_loss',
  'faltering_growth',
  'dehydration_signs',
  'pregnancy_complication',
  'severe_allergy_reaction',
  'insulin_or_sulfonylurea_fasting',
  'other_clinical',
]);
export const Escalation = z.object({
  reason: EscalationReason,
  family_member_id: Uuid.nullable(),
  message: z.string(),
  recommend: z.enum(['see_gp', 'see_pediatrician', 'see_dietitian', 'urgent_care', 'emergency']),
});

export const Citation = z.object({
  kind: z.enum(['islamic_source', 'scientific_evidence', 'recommendation']),
  ref_id: Uuid,
  label: z.string(),
  tradition: SourceTradition.optional(),
  hadith_grade: EvidenceGradeHadith.optional(),
  science_grade: EvidenceGradeScience.optional(),
});

export const AsyncAccepted = z.object({
  status: z.literal('accepted'),
  poll_after_ms: z.number().int().positive(),
  realtime: z.object({ schema: z.literal('public'), table: z.string(), filter: z.string() }),
});
