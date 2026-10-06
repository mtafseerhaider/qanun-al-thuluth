import { AiAdjustPlanRequest, AiAdjustPlanResponse, type PlanDiffItem } from '@shared/contracts';
import type { MealType } from '@shared';

import { invokeEdge } from '@/lib/supabase/edge';

/**
 * Premium "Ask AI for another idea" (24 S3-13, 06 §4.4): `ai-adjust-plan` scoped to one meal slot.
 * A dry run returns the suggested change; applying it writes a new draft plan version, which the
 * caller activates. Free households get `PREMIUM_REQUIRED` (402) from the server, which the sheet
 * shows as the upsell state.
 */
export interface AiSwapInput {
  mealPlanId: string;
  planDate: string;
  mealType: MealType;
  changeRequest: string;
  dryRun: boolean;
  idempotencyKey: string;
}

export type AiSwapResult =
  | { kind: 'completed'; mealPlanId: string | null; diff: PlanDiffItem[]; rationale: string }
  | { kind: 'accepted'; mealPlanId: string };

export async function requestAiSwap(input: AiSwapInput): Promise<AiSwapResult> {
  const body = AiAdjustPlanRequest.parse({
    meal_plan_id: input.mealPlanId,
    change_request: input.changeRequest,
    scope: { from_date: input.planDate, to_date: input.planDate, meal_types: [input.mealType] },
    dry_run: input.dryRun,
    source: 'user',
  });
  const res = await invokeEdge('ai-adjust-plan', body, AiAdjustPlanResponse, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  if (res.status === 'completed')
    return {
      kind: 'completed',
      mealPlanId: res.meal_plan_id,
      diff: res.diff,
      rationale: res.rationale,
    };
  return { kind: 'accepted', mealPlanId: res.meal_plan_id };
}
