import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';

import type { AcceptanceScore, LifeStage, MealStatus, MealType } from '@shared';

import { useFamilyMembers } from '@/features/family';
import { useHousehold } from '@/features/household';
import { track } from '@/lib/analytics/track';
import { localIsoDate, localMinutes } from '@/lib/dates/local-date';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import { requestAiSwap, type AiSwapInput } from '../api/ai-swap-api';
import {
  activateMealPlan,
  fetchDailyMeal,
  fetchDailyMeals,
  fetchHouseholdPremium,
  fetchMealAlternatives,
  fetchRecipeTitles,
  swapDailyMeal,
  updateServingStatus,
  type DailyMealView,
  type ServingStatusWrite,
  type ServingView,
} from '../api/meals-api';
import {
  applyPendingServingWrites,
  pendingServingWrites,
  SERVING_STATUS_KIND,
  servingsForBulkLog,
  type MemberLite,
} from '../utils/meal-rules';

/** Registers the outbox handler for serving writes (called once from the app layer). */
export function registerMealOutboxHandlers(qc: QueryClient): void {
  registerOutboxHandler<ServingStatusWrite>(SERVING_STATUS_KIND, {
    run: (payload) => updateServingStatus(payload),
    onSuccess: (payload) =>
      void qc.invalidateQueries({ queryKey: qk.household(payload.householdId).dailyMeals() }),
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

export function usePendingServingWrites() {
  const entries = useOutboxStore(selectEntries);
  return useMemo(() => pendingServingWrites(entries), [entries]);
}

/** Planned meals of the plan between two dates, with queued (not yet synced) logs overlaid. */
export function useDailyMeals(
  householdId: string | null,
  mealPlanId: string | null | undefined,
  from: string,
  to: string,
) {
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').dailyMealsRange(mealPlanId ?? 'none', from, to),
    queryFn: () => fetchDailyMeals(householdId as string, mealPlanId as string, from, to),
    enabled: Boolean(householdId && mealPlanId) && isSupabaseConfigured,
  });
  const pending = usePendingServingWrites();
  const data = useMemo(
    () => (query.data ? applyPendingServingWrites(query.data, pending) : undefined),
    [query.data, pending],
  );
  return { ...query, data, pending };
}

/** Finds a planned meal in any cached range, so Meal Detail opens instantly and offline. */
function cachedDailyMeal(qc: QueryClient, householdId: string, id: string) {
  for (const [, meals] of qc.getQueriesData<DailyMealView[]>({
    queryKey: qk.household(householdId).dailyMeals(),
  })) {
    const hit = Array.isArray(meals) ? meals.find((m) => m.id === id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

export function useDailyMeal(householdId: string | null, dailyMealId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').dailyMeal(dailyMealId),
    queryFn: () => fetchDailyMeal(dailyMealId),
    enabled: Boolean(householdId) && isSupabaseConfigured,
    placeholderData: () =>
      householdId ? cachedDailyMeal(qc, householdId, dailyMealId) : undefined,
  });
  const pending = usePendingServingWrites();
  const data = useMemo(
    () => (query.data ? (applyPendingServingWrites([query.data], pending)[0] ?? null) : query.data),
    [query.data, pending],
  );
  return { ...query, data, pending };
}

/** Family members with the fields meal views need. */
export function useMemberLookup(householdId: string | null) {
  const members = useFamilyMembers(householdId);
  return useMemo(() => {
    const map = new Map<string, MemberLite>();
    for (const m of members.data ?? [])
      map.set(m.id, {
        id: m.id,
        name: m.name,
        lifeStage: m.life_stage,
        specialModules: m.special_modules ?? [],
      });
    return map;
  }, [members.data]);
}

export function useHouseholdPremium(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').premium(),
    queryFn: () => fetchHouseholdPremium(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
    staleTime: 5 * 60_000,
  });
}

export interface LogServingInput {
  householdId: string;
  serving: Pick<ServingView, 'id'>;
  status: MealStatus;
  acceptance?: AcceptanceScore | null;
  mealType: MealType;
  lifeStage: LifeStage;
}

/**
 * Logs one serving through the outbox (24 S3-12, S3-15): the change shows at once and is sent now or
 * on reconnect. Returns the write so callers can offer undo.
 */
export function logServing(input: LogServingInput, now: Date = new Date()): ServingStatusWrite {
  const write: ServingStatusWrite = {
    servingId: input.serving.id,
    householdId: input.householdId,
    status: input.status,
    acceptance: input.acceptance ?? null,
    at: now.toISOString(),
  };
  useOutboxStore.getState().enqueue({
    kind: SERVING_STATUS_KIND,
    scope: `household:${input.householdId}`,
    dedupeKey: input.serving.id,
    payload: write,
  });
  track('meal_serving_logged', {
    status: input.status,
    has_acceptance: Boolean(input.acceptance),
    meal_type: input.mealType,
    life_stage: input.lifeStage,
  });
  return write;
}

/**
 * "Everyone ate" (02 §5.5): marks every serving not yet logged as eaten. Returns an undo function
 * that puts exactly those servings back to planned.
 */
export function logEveryoneAte(
  householdId: string,
  meal: Pick<DailyMealView, 'servings'>,
  source: 'dashboard' | 'meal_detail',
  now: Date = new Date(),
): () => void {
  const targets = servingsForBulkLog(meal);
  const enqueue = (status: MealStatus, at: Date) =>
    targets.forEach((s) =>
      useOutboxStore.getState().enqueue({
        kind: SERVING_STATUS_KIND,
        scope: `household:${householdId}`,
        dedupeKey: s.id,
        payload: {
          servingId: s.id,
          householdId,
          status,
          acceptance: null,
          at: at.toISOString(),
        } satisfies ServingStatusWrite,
      }),
    );
  enqueue('eaten', now);
  track('meal_bulk_logged', { daily_meal_id_count: targets.length > 0 ? 1 : 0, source });
  return () => enqueue('planned', new Date(Math.max(Date.now(), now.getTime() + 1)));
}

export function useMealAlternatives(mealId: string | undefined) {
  return useQuery({
    queryKey: qk.catalog.mealAlternatives(mealId ?? 'none'),
    queryFn: () => fetchMealAlternatives(mealId as string),
    enabled: Boolean(mealId) && isSupabaseConfigured,
    staleTime: 10 * 60_000,
  });
}

/** Catalog swap (free): online only, then every planned-meal read refreshes. */
export function useSwapMeal(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['meal', 'swap'],
    networkMode: 'online',
    mutationFn: (v: {
      dailyMealId: string;
      alternativeMealId: string;
      reason: 'allergy' | 'budget' | 'autism' | 'picky' | 'season' | 'preference';
    }) => swapDailyMeal(v.dailyMealId, v.alternativeMealId),
    onSuccess: (_d, v) => {
      track('meal_swapped', { reason: v.reason, source: 'catalog' });
      if (householdId)
        void qc.invalidateQueries({ queryKey: qk.household(householdId).dailyMeals() });
    },
  });
}

/** Premium AI suggestion for one slot: preview (dry run), then apply and activate the new version. */
export function useAiSwap(householdId: string | null) {
  const qc = useQueryClient();
  const preview = useMutation({
    mutationKey: ['meal', 'ai-swap', 'preview'],
    networkMode: 'online',
    mutationFn: (v: Omit<AiSwapInput, 'dryRun' | 'idempotencyKey'>) =>
      requestAiSwap({ ...v, dryRun: true, idempotencyKey: Crypto.randomUUID() }),
  });
  const apply = useMutation({
    mutationKey: ['meal', 'ai-swap', 'apply'],
    networkMode: 'online',
    mutationFn: async (v: Omit<AiSwapInput, 'dryRun'>) => {
      const res = await requestAiSwap({ ...v, dryRun: false });
      if (res.kind === 'completed' && res.mealPlanId) await activateMealPlan(res.mealPlanId);
      return res;
    },
    onSuccess: () => {
      track('meal_swapped', { reason: 'ai', source: 'ai' });
      if (!householdId) return;
      void qc.invalidateQueries({ queryKey: qk.household(householdId).mealPlans() });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).dailyMeals() });
    },
  });
  return { preview, apply };
}

export function useMealRecipeTitles(mealId: string | undefined, recipeIds: readonly string[]) {
  return useQuery({
    queryKey: qk.catalog.mealRecipes(mealId ?? 'none'),
    queryFn: () => fetchRecipeTitles(recipeIds),
    enabled: Boolean(mealId) && recipeIds.length > 0 && isSupabaseConfigured,
    staleTime: 10 * 60_000,
  });
}

/** Household-local "today" and the minute of the day (02 §3.3: dates in the household time zone). */
export function useHouseholdClock(householdId: string | null, now: Date = new Date()) {
  const household = useHousehold(householdId);
  const timezone = household.data?.timezone ?? null;
  return {
    timezone,
    today: localIsoDate(timezone, now),
    nowMinutes: localMinutes(timezone, now),
  };
}
