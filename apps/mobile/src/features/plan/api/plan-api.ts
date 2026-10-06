import {
  AiGeneratePlanAccepted,
  AiGeneratePlanRequest,
  GenerationProgress,
} from '@shared/contracts';
import type { PlanKind, PlanStatus } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Meal plans (05 §11.2, §22.12; 06 §3.3, §4.3). Plans are created only by `ai-generate-plan`; the
 * client reads them, watches generation over Realtime with polling as the fallback, and activates
 * a draft with `activate_meal_plan`.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface WeeklyTheme {
  week: number;
  key: string;
  titleI18n: unknown;
  bodyI18n: unknown;
}

export interface MealPlanView {
  id: string;
  householdId: string;
  kind: PlanKind;
  status: PlanStatus;
  title: string | null;
  startDate: string;
  endDate: string;
  weekCount: number;
  rationale: string | null;
  version: number;
  parentPlanId: string | null;
  failureReason: string | null;
  progress: GenerationProgress | null;
  weeklyThemes: WeeklyTheme[];
  createdAt: string;
}

export const PLAN_COLUMNS =
  'id, household_id, kind, status, title, start_date, end_date, week_count, rationale, version, parent_plan_id, failure_reason, generation_progress, weekly_themes, created_at';

export type RawPlan = {
  id: string;
  household_id: string;
  kind: PlanKind;
  status: PlanStatus;
  title: string | null;
  start_date: string;
  end_date: string;
  week_count: number;
  rationale: string | null;
  version: number;
  parent_plan_id: string | null;
  failure_reason: string | null;
  generation_progress: unknown;
  weekly_themes?: unknown;
  created_at: string;
};

function parseThemes(json: unknown): WeeklyTheme[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((t): WeeklyTheme[] => {
    if (!t || typeof t !== 'object') return [];
    const o = t as Record<string, unknown>;
    if (typeof o.week !== 'number') return [];
    return [
      {
        week: o.week,
        key: typeof o.key === 'string' ? o.key : '',
        titleI18n: o.title_i18n ?? null,
        bodyI18n: o.body_i18n ?? null,
      },
    ];
  });
}

/** Parses a row from PostgREST or a Realtime payload (both use column names). */
export function toPlanView(r: RawPlan): MealPlanView {
  const progress = GenerationProgress.safeParse(r.generation_progress);
  return {
    id: r.id,
    householdId: r.household_id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    startDate: r.start_date,
    endDate: r.end_date,
    weekCount: r.week_count,
    rationale: r.rationale,
    version: r.version,
    parentPlanId: r.parent_plan_id,
    failureReason: r.failure_reason,
    progress: progress.success ? progress.data : null,
    weeklyThemes: parseThemes(r.weekly_themes),
    createdAt: r.created_at,
  };
}

export async function requestPlanGeneration(
  input: Pick<AiGeneratePlanRequest, 'household_id' | 'start_date'> &
    Partial<Pick<AiGeneratePlanRequest, 'week_count' | 'replace_active'>>,
  idempotencyKey: string,
): Promise<AiGeneratePlanAccepted> {
  const body = AiGeneratePlanRequest.parse({ kind: 'standard', ...input });
  return invokeEdge('ai-generate-plan', body, AiGeneratePlanAccepted, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** The polling query from 06 §4.3, with the rest of the plan header. */
export async function fetchMealPlan(id: string): Promise<MealPlanView | null> {
  const { data, error } = await client()
    .from('meal_plans')
    .select(PLAN_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data ? toPlanView(data as unknown as RawPlan) : null;
}

export async function fetchMealPlans(householdId: string): Promise<MealPlanView[]> {
  const { data, error } = await client()
    .from('meal_plans')
    .select(PLAN_COLUMNS)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
    .order('version', { ascending: false })
    .limit(30);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as RawPlan[]).map(toPlanView);
}

/** The household's active standard plan (Today and the Plan tab read from it). */
export async function fetchActivePlan(householdId: string): Promise<MealPlanView | null> {
  const { data, error } = await client()
    .from('meal_plans')
    .select(PLAN_COLUMNS)
    .eq('household_id', householdId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data ? toPlanView(data as unknown as RawPlan) : null;
}

/** Recommendation ids attached to a plan; only verified ones render (RecommendationList). */
export async function fetchPlanRecommendationIds(mealPlanId: string): Promise<string[]> {
  const { data, error } = await client()
    .from('plan_recommendations')
    .select('recommendation_id')
    .eq('meal_plan_id', mealPlanId);
  if (error) throw toDbAppError(error);
  return [
    ...new Set(
      ((data ?? []) as Array<{ recommendation_id: string }>).map((r) => r.recommendation_id),
    ),
  ];
}
