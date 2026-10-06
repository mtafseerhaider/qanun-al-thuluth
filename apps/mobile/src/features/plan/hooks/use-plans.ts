import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';

import { activateMealPlan } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';
import { subscribeToRowChanges } from '@/lib/supabase/realtime';

import {
  fetchActivePlan,
  fetchMealPlan,
  fetchMealPlans,
  fetchPlanRecommendationIds,
  requestPlanGeneration,
  toPlanView,
  type MealPlanView,
  type RawPlan,
} from '../api/plan-api';
import {
  GENERATION_TIMEOUT_MS,
  outcomeFor,
  pollIntervalFor,
  stageFor,
} from '../utils/generation-rules';

export function useMealPlans(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').mealPlans(),
    queryFn: () => fetchMealPlans(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

export function useActivePlan(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').activePlan(),
    queryFn: () => fetchActivePlan(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

export function usePlanRecommendationIds(householdId: string | null, mealPlanId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').planRecommendations(mealPlanId ?? 'none'),
    queryFn: () => fetchPlanRecommendationIds(mealPlanId as string),
    enabled: Boolean(householdId && mealPlanId) && isSupabaseConfigured,
  });
}

export function useMealPlan(householdId: string | null, mealPlanId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').mealPlan(mealPlanId ?? 'none'),
    queryFn: () => fetchMealPlan(mealPlanId as string),
    enabled: Boolean(householdId && mealPlanId) && isSupabaseConfigured,
  });
}

export type GenerateSource = 'onboarding' | 'plans' | 'retry' | 'template';

/**
 * Starts `ai-generate-plan` (06 §4.3). Online only (09 §4.5). Each user action gets a new
 * Idempotency-Key; a retry or the template fallback is a new request (the server picks the template
 * path after a failed first plan).
 */
export function useGeneratePlan(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['plan', 'generate'],
    networkMode: 'online',
    mutationFn: async (v: {
      startDate: string;
      source: GenerateSource;
      replaceActive?: boolean;
    }) => {
      if (!householdId) throw new Error('No household');
      track('plan_generate_requested', { kind: 'standard', weeks: 1, source: v.source });
      return requestPlanGeneration(
        {
          household_id: householdId,
          start_date: v.startDate,
          week_count: 1,
          ...(v.replaceActive ? { replace_active: true } : {}),
        },
        Crypto.randomUUID(),
      );
    },
    onSuccess: () => {
      if (householdId)
        void qc.invalidateQueries({ queryKey: qk.household(householdId).mealPlans() });
    },
  });
}

export function useActivatePlan(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['plan', 'activate'],
    networkMode: 'online',
    mutationFn: (mealPlanId: string) => activateMealPlan(mealPlanId),
    onSuccess: () => {
      if (!householdId) return;
      void qc.invalidateQueries({ queryKey: qk.household(householdId).mealPlans() });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).dailyMeals() });
    },
  });
}

type RealtimeState = 'connecting' | 'subscribed' | 'error' | 'closed';

/**
 * Watches one generating plan (02 §7.4.2): Realtime row changes on `meal_plans` (channel
 * `plan:{id}`) write straight into the query cache, and the status query polls at `poll_after_ms`
 * whenever Realtime is not connected (fallback), slowly otherwise. Reports the UI stage, the
 * outcome and the 120 s timeout.
 */
export function usePlanGenerationWatch(opts: {
  householdId: string | null;
  mealPlanId: string | null;
  pollAfterMs?: number | null;
  startedAt?: number | null;
  now?: () => number;
}) {
  const { householdId, mealPlanId, pollAfterMs, startedAt, now = Date.now } = opts;
  const qc = useQueryClient();
  const [realtime, setRealtime] = useState<RealtimeState>('connecting');
  const key = qk.household(householdId ?? 'none').mealPlan(mealPlanId ?? 'none');

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchMealPlan(mealPlanId as string),
    enabled: Boolean(householdId && mealPlanId) && isSupabaseConfigured,
    refetchInterval: (q) =>
      pollIntervalFor({
        status: (q.state.data as MealPlanView | null | undefined)?.status,
        realtime,
        pollAfterMs: pollAfterMs ?? null,
      }),
    meta: { persist: false },
  });

  useEffect(() => {
    if (!mealPlanId || !householdId || !isSupabaseConfigured) return;
    setRealtime('connecting');
    return subscribeToRowChanges<RawPlan>({
      channel: `plan:${mealPlanId}`,
      table: 'meal_plans',
      filter: `id=eq.${mealPlanId}`,
      onChange: (row) => {
        const prev = qc.getQueryData<MealPlanView | null>(key);
        // Realtime sends the full row; merge in case a column was omitted.
        const merged = { ...(prev ? planToRaw(prev) : {}), ...row } as RawPlan;
        qc.setQueryData(key, toPlanView(merged));
      },
      onStatus: setRealtime,
    });
    // `key` is derived from the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealPlanId, householdId, qc]);

  const [timedOut, setTimedOut] = useState(false);
  const outcome = outcomeFor(query.data?.status);
  useEffect(() => {
    if (!startedAt || outcome !== 'generating') {
      setTimedOut(false);
      return;
    }
    const left = startedAt + GENERATION_TIMEOUT_MS - now();
    if (left <= 0) {
      setTimedOut(true);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), left);
    return () => clearTimeout(id);
  }, [startedAt, outcome, now]);

  return {
    plan: query.data ?? null,
    query,
    outcome,
    stage: stageFor(query.data?.progress),
    timedOut,
    realtime,
  };
}

function planToRaw(p: MealPlanView): RawPlan {
  return {
    id: p.id,
    household_id: p.householdId,
    kind: p.kind,
    status: p.status,
    title: p.title,
    start_date: p.startDate,
    end_date: p.endDate,
    week_count: p.weekCount,
    rationale: p.rationale,
    version: p.version,
    parent_plan_id: p.parentPlanId,
    failure_reason: p.failureReason,
    generation_progress: p.progress ?? {},
    weekly_themes: p.weeklyThemes.map((t) => ({
      week: t.week,
      key: t.key,
      title_i18n: t.titleI18n,
      body_i18n: t.bodyI18n,
    })),
    created_at: p.createdAt,
  };
}
