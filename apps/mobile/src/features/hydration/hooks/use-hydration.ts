import { useQuery, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';

import type { LifeStage } from '@shared';

import { useFamilyMembers } from '@/features/family';
import { useDailyMeals, useHouseholdClock } from '@/features/meals';
import { useActivePlan } from '@/features/plan';
import { track } from '@/lib/analytics/track';
import { addDays, timeToMinutes } from '@/lib/dates/local-date';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import {
  deleteHydrationLog,
  fetchHydrationLogs,
  fetchHydrationTargets,
  insertHydrationLog,
} from '../api/hydration-api';
import {
  applyPendingHydration,
  classifyTiming,
  familyScore,
  HYDRATION_DELETE_KIND,
  HYDRATION_LOG_KIND,
  isUnderSixMonths,
  nextPreMealWindow,
  totalsByMember,
  volumeBucket,
  windowsFromMeals,
  type Beverage,
  type DrinkTiming,
  type HydrationDeleteWrite,
  type HydrationLogView,
  type HydrationLogWrite,
  type HydrationWindowView,
} from '../utils/hydration-rules';

/** Registers the hydration outbox handlers (called once from the app layer, 24 S4-08). */
export function registerHydrationOutboxHandlers(qc: QueryClient): void {
  const refresh = (householdId: string) =>
    void qc.invalidateQueries({
      queryKey: [...qk.household(householdId).all(), 'hydration-logs'],
    });
  registerOutboxHandler<HydrationLogWrite>(HYDRATION_LOG_KIND, {
    run: (w) => insertHydrationLog(w),
    onSuccess: (w) => refresh(w.householdId),
  });
  registerOutboxHandler<HydrationDeleteWrite>(HYDRATION_DELETE_KIND, {
    run: (w) => deleteHydrationLog(w),
    onSuccess: (w) => refresh(w.householdId),
  });
}

export function useHydrationTargets(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').hydrationTargets(),
    queryFn: () => fetchHydrationTargets(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
    staleTime: 10 * 60_000,
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

/** Logs of the last 8 household days with queued writes overlaid (works offline). */
export function useHydrationLogs(householdId: string | null, today: string) {
  const from = addDays(today, -8);
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').hydrationLogs(from),
    queryFn: () => fetchHydrationLogs(householdId as string, `${from}T00:00:00Z`),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
  const entries = useOutboxStore(selectEntries);
  const data = useMemo(
    () =>
      applyPendingHydration(
        query.data ?? [],
        entries.filter((e) => e.scope === `household:${householdId}`),
      ),
    [query.data, entries, householdId],
  );
  return { ...query, data };
}

export interface MemberHydration {
  id: string;
  name: string;
  lifeStage: LifeStage;
  /** 0 when the member has no target row yet. */
  targetMl: number;
  consumedMl: number;
  windows: HydrationWindowView[];
  /** Babies under 6 months: no drinks target and no logging (15 §6.2). */
  noDrinks: boolean;
  basis: Record<string, unknown>;
}

/**
 * Today's hydration for every member (02 §7.5.1 `useHydrationToday`): targets, today's ml, the
 * schedule (stored windows, or pre-meal windows from today's planned meals) and the family score.
 */
export function useHydrationToday(householdId: string | null) {
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const targets = useHydrationTargets(householdId);
  const logs = useHydrationLogs(householdId, clock.today);
  const active = useActivePlan(householdId);
  const meals = useDailyMeals(householdId, active.data?.id, clock.today, clock.today);

  return useMemo(() => {
    const totals = totalsByMember(logs.data, clock.today, clock.timezone);
    const mealWindows = windowsFromMeals(meals.data ?? []);
    const mealMinutes = (meals.data ?? [])
      .map((m) => timeToMinutes(m.scheduledTime))
      .filter((m): m is number => m !== null);
    const byMember = new Map((targets.data ?? []).map((t) => [t.familyMemberId, t]));
    const rows: MemberHydration[] = (members.data ?? []).map((m) => {
      const t = byMember.get(m.id);
      const noDrinks = isUnderSixMonths(m.date_of_birth, clock.today);
      return {
        id: m.id,
        name: m.name,
        lifeStage: m.life_stage,
        targetMl: noDrinks ? 0 : (t?.dailyMl ?? 0),
        consumedMl: totals.get(m.id) ?? 0,
        windows: t && t.windows.length > 0 ? t.windows : mealWindows,
        noDrinks,
        basis: t?.basis ?? {},
      };
    });
    const score = familyScore(rows.filter((r) => !r.noDrinks));
    const familyWindows = rows.find((r) => r.windows.length > 0)?.windows ?? mealWindows;
    return {
      ...clock,
      members: rows,
      score,
      logs: logs.data,
      mealMinutes,
      nextWindow: nextPreMealWindow(familyWindows, clock.nowMinutes),
      isLoading: members.isLoading || targets.isLoading,
      dataUpdatedAt: logs.dataUpdatedAt,
    };
  }, [clock, members.data, members.isLoading, targets.data, targets.isLoading, logs, meals.data]);
}

export interface LogHydrationInput {
  householdId: string;
  memberIds: readonly string[];
  volumeMl: number;
  beverage: Beverage;
  /** Explicit timing; otherwise classified from the schedule and meal times. */
  timing?: DrinkTiming;
  windows?: readonly HydrationWindowView[];
  mealMinutes?: readonly number[];
  nowMinutes: number;
  at?: Date;
}

/**
 * One-tap logging (FR-HYD-03): one outbox entry per member, each with its own client id. The ring
 * updates from the overlay at once (optimistic) and the rows sync now or on reconnect.
 */
export function logHydration(input: LogHydrationInput): HydrationLogWrite[] {
  const at = (input.at ?? new Date()).toISOString();
  const timing =
    input.timing ?? classifyTiming(input.nowMinutes, input.windows ?? [], input.mealMinutes ?? []);
  const writes = input.memberIds.map((familyMemberId) => {
    const w: HydrationLogWrite = {
      id: Crypto.randomUUID(),
      householdId: input.householdId,
      familyMemberId,
      loggedAt: at,
      volumeMl: Math.round(input.volumeMl),
      beverage: input.beverage,
      timing,
    };
    useOutboxStore.getState().enqueue({
      kind: HYDRATION_LOG_KIND,
      scope: `household:${input.householdId}`,
      dedupeKey: w.id,
      id: w.id,
      payload: w,
    });
    return w;
  });
  if (writes.length > 0)
    track('hydration_logged', {
      volume_ml_bucket: volumeBucket(input.volumeMl),
      beverage: input.beverage,
      timing,
      members_count: Math.min(20, writes.length),
    });
  return writes;
}

/** Deletes a log; a log still waiting in the outbox is simply dropped from the queue. */
export function removeHydrationLog(householdId: string, log: Pick<HydrationLogView, 'id'>): void {
  const store = useOutboxStore.getState();
  const queued = store.entries.find((e) => e.kind === HYDRATION_LOG_KIND && e.dedupeKey === log.id);
  if (queued) {
    store.remove(queued.id);
    return;
  }
  store.enqueue({
    kind: HYDRATION_DELETE_KIND,
    scope: `household:${householdId}`,
    dedupeKey: log.id,
    payload: { id: log.id, householdId } satisfies HydrationDeleteWrite,
  });
}
