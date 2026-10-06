import { z } from 'zod';

import { AsyncAccepted, Escalation, IsoDate, MealType, PlanKind, Uuid } from './common.ts';
import { ErrorCode } from './errors.ts';

/** `POST /functions/v1/ai-generate-plan` (06-api-specification §4.3). */
export const AiGeneratePlanRequest = z.object({
  household_id: Uuid,
  kind: PlanKind.exclude(['ramadan']).default('standard'),
  start_date: IsoDate, // household local date, today..today+14
  week_count: z.number().int().min(1).max(4).default(1),
  family_member_ids: z.array(Uuid).min(1).optional(), // default: all active members
  budget_profile_id: Uuid.optional(),
  assessment_ids: z.array(Uuid).optional(), // default: latest per member
  meal_types: z
    .array(MealType.exclude(['suhoor', 'iftar']))
    .min(1)
    .default(['breakfast', 'lunch', 'snack', 'dinner']),
  preferences: z
    .object({
      cuisines: z.array(z.string()).max(5).optional(),
      max_prep_min_weekday: z.number().int().min(5).max(180).optional(),
      batch_cooking: z.boolean().default(false),
      repeat_tolerance: z.enum(['low', 'medium', 'high']).default('medium'),
      sunnah_foods_emphasis: z.boolean().default(true),
    })
    .default({}),
  replace_active: z.boolean().default(false),
});
export type AiGeneratePlanRequest = z.infer<typeof AiGeneratePlanRequest>;

export const PlanGenerationMode = z.enum(['full', 'template_personalize']);

export const AiGeneratePlanAccepted = AsyncAccepted.extend({
  meal_plan_id: Uuid,
  plan_status: z.literal('generating'),
  version: z.number().int(),
  mode: PlanGenerationMode,
});
export type AiGeneratePlanAccepted = z.infer<typeof AiGeneratePlanAccepted>;

/** Shape of `meal_plans.generation_progress` (Addition beyond 00-foundations). */
export const GenerationProgress = z.object({
  phase: z.enum([
    'queued',
    'safety_check',
    'generating',
    'validating',
    'writing',
    'done',
    'failed',
  ]),
  completed_weeks: z.number().int(),
  total_weeks: z.number().int(),
  attempt: z.number().int(),
  error_code: ErrorCode.optional(),
  escalation: Escalation.optional(),
});
export type GenerationProgress = z.infer<typeof GenerationProgress>;

/** Internal worker (`x-internal-secret`). */
export const PlanWorkerRequest = z.object({ meal_plan_id: Uuid.optional() }); // omitted = next queue message
export const PlanWorkerResponse = z.object({
  processed: z.number().int(),
  rescheduled: z.boolean(),
});
