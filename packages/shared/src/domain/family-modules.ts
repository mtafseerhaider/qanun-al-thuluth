import { z } from 'zod';

import { ACCEPTANCE_SCORES, EXPOSURE_STAGES } from '../enums.ts';

/**
 * Sprint 6 picky-eater, autism and coaching domain values (00-foundations §5-6,
 * 05-database-schema §9.10, §12.10-12.12, 15-family-health-modules §3-4).
 * The database check constraints in 05 are the source for every value list here.
 * The sensory profile write shape already lives in `domain/intake.ts` (`SensoryProfileInput`).
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** `food_exposures.context` (05 §12.10 check constraint). */
export const EXPOSURE_CONTEXTS = [
  'family_meal',
  'snack',
  'cooking_together',
  'grocery_trip',
  'play',
  'school',
  'other',
] as const;
export type ExposureContext = (typeof EXPOSURE_CONTEXTS)[number];

/** `acceptance_score` as a number (15 §4.7): `0_refused` = 0 ... `5_ate_well` = 5. */
export function acceptanceValue(score: (typeof ACCEPTANCE_SCORES)[number]): number {
  return ACCEPTANCE_SCORES.indexOf(score);
}

/** Client write shape for `food_exposures` (PostgREST, offline outbox; `id` is the idempotency key). */
export const FoodExposureInput = z.object({
  id: z.string().uuid(),
  ingredient_id: z.string().uuid(),
  exposed_on: IsoDate,
  stage: z.enum(EXPOSURE_STAGES),
  acceptance: z.enum(ACCEPTANCE_SCORES),
  context: z.enum(EXPOSURE_CONTEXTS).nullable().optional(),
  ladder_step_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type FoodExposureInput = z.infer<typeof FoodExposureInput>;

/** `exposure_ladders.strategy` and `status` (05 §12.11). */
export const EXPOSURE_LADDER_STRATEGIES = ['exposure_ladder', 'food_chaining'] as const;
export type ExposureLadderStrategy = (typeof EXPOSURE_LADDER_STRATEGIES)[number];
export const EXPOSURE_LADDER_STATUSES = ['active', 'paused', 'completed', 'abandoned'] as const;
export type ExposureLadderStatus = (typeof EXPOSURE_LADDER_STATUSES)[number];

/** `coaching_tips.module` (05 §9.10). */
export const COACHING_TIP_MODULES = ['picky', 'autism', 'ramadan', 'general'] as const;
export type CoachingTipModule = (typeof COACHING_TIP_MODULES)[number];

/** Age band in months; 1200 is the open upper bound used by the table default. */
export const CoachingTipAgeBand = z
  .object({
    age_min_months: z.number().int().min(0).max(1200).default(0),
    age_max_months: z.number().int().min(0).max(1200).default(1200),
  })
  .refine((b) => b.age_max_months >= b.age_min_months, {
    message: 'age_max_months must be at least age_min_months',
    path: ['age_max_months'],
  });
export type CoachingTipAgeBand = z.infer<typeof CoachingTipAgeBand>;

export function tipMatchesAge(
  band: { age_min_months: number; age_max_months: number },
  ageMonths: number,
): boolean {
  return ageMonths >= band.age_min_months && ageMonths <= band.age_max_months;
}
