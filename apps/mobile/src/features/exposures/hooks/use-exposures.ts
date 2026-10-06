import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { acceptanceValue, type ExposureLadderStrategy } from '@shared/domain/family-modules';

import { addDays } from '@/lib/dates/local-date';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import {
  completeStep,
  createLadder,
  deleteLadder,
  fetchChainCatalog,
  fetchCoachingTips,
  fetchExposures,
  fetchLadder,
  fetchLadders,
  fetchPickySummary,
  fetchPlanMeta,
  fetchSafeFoods,
  fetchSensoryProfile,
  fetchServingAcceptance,
  insertExposure,
  markNoLongerSafe,
  replaceSteps,
  searchIngredients,
  updateLadder,
  upsertSafeFood,
  type ExposureWrite,
  type SafeFoodView,
} from '../api/exposures-api';
import {
  parseExposurePairs,
  type ExposureView,
  type LadderStepDraft,
  type LadderView,
} from '../utils/exposure-rules';

export const FOOD_EXPOSURE_KIND = 'food.exposure';

/** Registers the exposure outbox handler (called once from the app layer). */
export function registerExposureOutboxHandlers(qc: QueryClient): void {
  registerOutboxHandler<ExposureWrite>(FOOD_EXPOSURE_KIND, {
    run: async (w) => insertExposure(w),
    onSuccess: (w) => {
      const h = qk.household(w.householdId);
      void qc.invalidateQueries({ queryKey: h.exposures(w.familyMemberId) });
      void qc.invalidateQueries({ queryKey: [...h.all(), 'picky-summary', w.familyMemberId] });
    },
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

export function pendingExposures(
  entries: readonly OutboxEntry[],
  memberId: string,
): ExposureView[] {
  return entries
    .filter((e) => e.kind === FOOD_EXPOSURE_KIND)
    .map((e) => e.payload as ExposureWrite)
    .filter((w) => w.familyMemberId === memberId)
    .map((w) => ({
      id: w.id,
      familyMemberId: w.familyMemberId,
      ingredientId: w.ingredientId,
      foodLabel: w.foodLabel,
      exposedOn: w.exposedOn,
      stage: w.stage,
      acceptance: w.acceptance,
      context: w.context,
      ladderStepId: w.ladderStepId,
      notes: w.notes,
      queued: true,
    }));
}

/** Server rows plus queued ones, newest first; a queued row replaces the same id from the server. */
export function mergeExposures(
  server: readonly ExposureView[],
  pending: readonly ExposureView[],
): ExposureView[] {
  const ids = new Set(pending.map((p) => p.id));
  return [...pending, ...server.filter((s) => !ids.has(s.id))].sort((a, b) =>
    b.exposedOn.localeCompare(a.exposedOn),
  );
}

/** The last 90 days of tries for a member (02 §7.11.3), including tries saved on this device. */
export function useExposures(householdId: string | null, memberId: string | null, today: string) {
  const { i18n } = useTranslation();
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').exposures(memberId ?? 'none'),
    queryFn: () => fetchExposures(memberId as string, addDays(today, -90), i18n.language),
    enabled: Boolean(householdId && memberId) && isSupabaseConfigured,
  });
  const outbox = useOutboxStore(selectEntries);
  const rows = useMemo(
    () => mergeExposures(query.data ?? [], memberId ? pendingExposures(outbox, memberId) : []),
    [query.data, outbox, memberId],
  );
  return { ...query, rows };
}

/** Queues one try (offline-safe, P10). */
export function logExposure(
  input: Omit<ExposureWrite, 'id'>,
  module: 'picky' | 'autism',
): ExposureWrite {
  const w: ExposureWrite = { ...input, id: Crypto.randomUUID() };
  useOutboxStore.getState().enqueue({
    kind: FOOD_EXPOSURE_KIND,
    scope: `household:${w.householdId}`,
    dedupeKey: w.id,
    id: w.id,
    payload: w,
  });
  track('exposure_logged', {
    stage: w.stage,
    score: acceptanceValue(w.acceptance),
    on_ladder: w.ladderStepId !== null,
    module,
  });
  return w;
}

/* --- Ingredient search ------------------------------------------------------------------------ */

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useIngredientSearch(query: string) {
  const { i18n } = useTranslation();
  const q = useDebounced(query.trim());
  return useQuery({
    queryKey: [...qk.catalog.ingredientSearch(q), i18n.language],
    queryFn: () => searchIngredients(q, i18n.language),
    enabled: q.length >= 2 && isSupabaseConfigured,
    staleTime: 10 * 60_000,
  });
}

export function useChainCatalog(enabled: boolean) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: [...qk.catalog.ingredients(['chain-catalog']), i18n.language],
    queryFn: () => fetchChainCatalog(i18n.language),
    enabled: enabled && isSupabaseConfigured,
    staleTime: 24 * 60 * 60_000,
  });
}

/* --- Ladders --------------------------------------------------------------------------------- */

export function useLadders(householdId: string | null, memberId: string | null) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').ladders(memberId ?? 'none'),
    queryFn: () => fetchLadders(memberId as string, i18n.language),
    enabled: Boolean(householdId && memberId) && isSupabaseConfigured,
  });
}

export function useLadder(householdId: string | null, ladderId: string) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').ladder(ladderId),
    queryFn: () => fetchLadder(ladderId, i18n.language),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

function invalidateLadders(qc: QueryClient, householdId: string) {
  void qc.invalidateQueries({ queryKey: [...qk.household(householdId).all(), 'exposure-ladders'] });
}

export function useSaveLadder(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['exposure-ladders', 'save'],
    mutationFn: async (v: {
      ladderId: string | null;
      familyMemberId: string;
      targetIngredientId: string;
      strategy: ExposureLadderStrategy;
      steps: readonly LadderStepDraft[];
      links: number;
      suggested: boolean;
    }) => {
      if (!householdId) throw new Error('no household');
      if (v.ladderId) {
        await replaceSteps(v.ladderId, householdId, v.steps);
        return v.ladderId;
      }
      const id = Crypto.randomUUID();
      await createLadder({
        id,
        householdId,
        familyMemberId: v.familyMemberId,
        targetIngredientId: v.targetIngredientId,
        strategy: v.strategy,
        steps: v.steps,
      });
      return id;
    },
    onSuccess: (_id, v) => {
      if (!v.ladderId) {
        track('ladder_started', {
          strategy: v.strategy,
          steps: Math.min(40, Math.max(1, v.steps.length)),
        });
        if (v.strategy === 'food_chaining')
          track('food_chain_created', { links: Math.min(10, v.links), suggested: v.suggested });
      }
      if (householdId) invalidateLadders(qc, householdId);
    },
  });
}

/** Moves a ladder up or down one step after the parent confirms (02 §7.10.4). */
export function useMoveLadder(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['exposure-ladders', 'move'],
    mutationFn: async (v: {
      ladder: LadderView;
      next: { currentStep: number; status: 'active' | 'completed' };
      direction: 'up' | 'down';
      today: string;
    }) => {
      const current = v.ladder.steps.find((s) => s.stepNo === v.ladder.currentStep);
      if (v.direction === 'up' && current) await completeStep(current.id, v.today);
      await updateLadder(v.ladder.id, { currentStep: v.next.currentStep, status: v.next.status });
    },
    onSuccess: (_r, v) => {
      track('ladder_step_changed', { direction: v.direction });
      if (v.next.status === 'completed') track('ladder_completed', {});
      if (householdId) invalidateLadders(qc, householdId);
    },
  });
}

export function useSetLadderStatus(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['exposure-ladders', 'status'],
    mutationFn: (v: { ladderId: string; status: 'active' | 'paused' | 'abandoned' }) =>
      v.status === 'abandoned'
        ? deleteLadder(v.ladderId)
        : updateLadder(v.ladderId, { status: v.status }),
    onSuccess: () => {
      if (householdId) invalidateLadders(qc, householdId);
    },
  });
}

/* --- Safe foods and sensory profile ----------------------------------------------------------- */

export function useSafeFoods(householdId: string | null, memberId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').safeFoods(memberId ?? 'none'),
    queryFn: () => fetchSafeFoods(memberId as string),
    enabled: Boolean(householdId && memberId) && isSupabaseConfigured,
  });
}

export function useSaveSafeFood(householdId: string | null, memberId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['safe-foods', 'save'],
    mutationFn: (v: {
      id?: string;
      label: string;
      ingredientId: string | null;
      strength: number;
      source: 'manual' | 'suggestion';
    }) =>
      upsertSafeFood({
        id: v.id ?? Crypto.randomUUID(),
        householdId: householdId as string,
        familyMemberId: memberId as string,
        label: v.label,
        ingredientId: v.ingredientId,
        strength: v.strength,
      }),
    onSuccess: (_r, v) => {
      if (!v.id) track('safe_food_added', { source: v.source });
      void qc.invalidateQueries({
        queryKey: qk.household(householdId ?? 'none').safeFoods(memberId ?? 'none'),
      });
    },
  });
}

export function useLoseSafeFood(householdId: string | null, memberId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['safe-foods', 'lost'],
    mutationFn: (safeFood: SafeFoodView) =>
      markNoLongerSafe({
        safeFood,
        householdId: householdId as string,
        familyMemberId: memberId as string,
        dislikeId: Crypto.randomUUID(),
      }),
    onSuccess: () => {
      track('safe_food_lost', {});
      void qc.invalidateQueries({
        queryKey: qk.household(householdId ?? 'none').safeFoods(memberId ?? 'none'),
      });
    },
  });
}

export function useSensoryProfile(householdId: string | null, memberId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').sensoryProfile(memberId ?? 'none'),
    queryFn: () => fetchSensoryProfile(memberId as string),
    enabled: Boolean(householdId && memberId) && isSupabaseConfigured,
  });
}

/* --- Coaching tips, summaries and plan pairs ------------------------------------------------- */

export function useCoachingTips(module: 'picky' | 'autism', ageMonths: number | null) {
  const { i18n } = useTranslation();
  const query = useQuery({
    queryKey: [...qk.catalog.coachingTips(module), i18n.language],
    queryFn: () => fetchCoachingTips(module, i18n.language),
    enabled: isSupabaseConfigured,
    staleTime: 24 * 60 * 60_000,
  });
  const tips = useMemo(
    () =>
      (query.data ?? []).filter(
        (tip) => ageMonths === null || (ageMonths >= tip.ageMin && ageMonths <= tip.ageMax),
      ),
    [query.data, ageMonths],
  );
  return { ...query, tips };
}

export function usePickySummary(
  householdId: string | null,
  memberId: string | null,
  days: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').pickySummary(memberId ?? 'none', days),
    queryFn: () => fetchPickySummary(memberId as string, days),
    enabled: enabled && Boolean(householdId && memberId) && isSupabaseConfigured,
  });
}

export function useServingAcceptance(memberId: string | null, since: string, enabled: boolean) {
  return useQuery({
    queryKey: ['serving-acceptance', memberId ?? 'none', since],
    queryFn: () => fetchServingAcceptance(memberId as string, since),
    enabled: enabled && Boolean(memberId) && isSupabaseConfigured,
  });
}

export function useExposurePairs(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').exposurePairs(),
    queryFn: async () => (await fetchPlanMeta(householdId as string)).flatMap(parseExposurePairs),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}
