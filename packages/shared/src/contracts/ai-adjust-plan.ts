import { z } from 'zod';

import { AsyncAccepted, CurrencyCode, IsoDate, MealType, Uuid } from './common.ts';

/** `POST /functions/v1/ai-adjust-plan` (06-api-specification §4.4). Premium only. */
export const AiAdjustPlanRequest = z.object({
  meal_plan_id: Uuid,
  change_request: z.string().trim().min(3).max(1000),
  scope: z
    .object({
      from_date: IsoDate,
      to_date: IsoDate,
      family_member_ids: z.array(Uuid).optional(),
      meal_types: z.array(MealType).optional(),
    })
    .refine((s) => s.from_date <= s.to_date, {
      message: 'from_date must be on or before to_date',
      path: ['to_date'],
    }),
  dry_run: z.boolean().default(false), // true = return a diff preview, write nothing
  source: z.enum(['user', 'chat_proposal']).default('user'),
});
export type AiAdjustPlanRequest = z.infer<typeof AiAdjustPlanRequest>;

export const PlanDiffItem = z.object({
  plan_date: IsoDate,
  meal_type: MealType,
  family_member_id: Uuid.nullable(), // null = whole-family slot
  before: z.object({ meal_id: Uuid, title: z.string() }).nullable(),
  after: z.object({ meal_id: Uuid, title: z.string() }).nullable(),
  reason: z.string(),
});
export type PlanDiffItem = z.infer<typeof PlanDiffItem>;

export const AiAdjustPlanCompleted = z.object({
  status: z.literal('completed'),
  meal_plan_id: Uuid.nullable(), // null when dry_run
  parent_plan_id: Uuid,
  version: z.number().int(),
  diff: z.array(PlanDiffItem),
  rationale: z.string(),
  budget_delta_minor: z.number().int(),
  currency: CurrencyCode,
});

export const AiAdjustPlanResponse = z.union([
  AiAdjustPlanCompleted,
  AsyncAccepted.extend({ meal_plan_id: Uuid, plan_status: z.literal('generating') }),
]);
export type AiAdjustPlanResponse = z.infer<typeof AiAdjustPlanResponse>;
