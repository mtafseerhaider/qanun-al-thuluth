import { z } from 'zod';

import { IsoInstant, MealType, NutritionEstimate, PlateSplit, Uuid } from './common.ts';

/** `POST /functions/v1/ai-analyze-meal` (06-api-specification §4.5). Premium only. */
export const AiAnalyzeMealRequest = z.object({
  household_id: Uuid,
  family_member_id: Uuid,
  photo_path: z.string().min(1), // meal-photos/{household_id}/{member_id}/{uuid}.jpg
  text: z.string().max(500).optional(), // "home-made, about one plate"
  meal_type: MealType.optional(),
  eaten_at: IsoInstant.optional(),
  save: z.boolean().default(false),
});
export type AiAnalyzeMealRequest = z.infer<typeof AiAnalyzeMealRequest>;

export const AnalyzedItem = z.object({
  label: z.string(),
  ingredient_id: Uuid.nullable(),
  recipe_id: Uuid.nullable(),
  estimated_grams: z.number().positive(),
  household_measure: z.string().optional(), // "1 roti", "1/2 katori"
  confidence: z.number().min(0).max(1),
  halal_note: z.string().optional(),
});
export type AnalyzedItem = z.infer<typeof AnalyzedItem>;

export const AiAnalyzeMealResponse = z.object({
  analysis_id: Uuid, // correlates with ai_usage
  items: z.array(AnalyzedItem),
  nutrition: NutritionEstimate.nullable(), // null if nothing recognised
  show_numbers: z.boolean(), // false for members under 18: never render kcal or macros
  plate_split: PlateSplit,
  thuluth_feedback: z.object({
    headline: z.string(),
    points: z.array(z.string()).max(4),
    tone: z.enum(['celebrate', 'gentle_suggestion', 'neutral']),
  }),
  overall_confidence: z.number().min(0).max(1),
  meal_log_id: Uuid.nullable(),
});
export type AiAnalyzeMealResponse = z.infer<typeof AiAnalyzeMealResponse>;
