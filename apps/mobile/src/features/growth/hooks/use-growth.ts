import { useQuery, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';

import type { GrowthReference } from '@shared/contracts';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { isAppError } from '@/lib/supabase/app-error';

import {
  computeGrowth,
  fetchGrowthDashboard,
  fetchLmsRows,
  saveMeasurement,
  type GrowthWrite,
} from '../api/growth-api';
import { LMS_INDICATOR, type GrowthRow, type Indicator } from '../utils/growth-rules';

export const GROWTH_MEASUREMENT_KIND = 'growth.measurement';

/**
 * A computation the server will never accept (no birth date, sex unspecified, out of the reference
 * range) must not hold the outbox lane: the row is saved and the screen shows "not computed".
 */
export function isPermanentComputeError(error: unknown): boolean {
  if (!isAppError(error) || error.status === null) return false;
  return error.status >= 400 && error.status < 500 && ![401, 408, 409, 429].includes(error.status);
}

/** Registers the growth outbox handler (called once from the app layer). */
export function registerGrowthOutboxHandlers(qc: QueryClient): void {
  registerOutboxHandler<GrowthWrite>(GROWTH_MEASUREMENT_KIND, {
    run: async (w, ctx) => {
      const id = await saveMeasurement(w);
      try {
        await computeGrowth(id, ctx.idempotencyKey);
      } catch (error) {
        if (!isPermanentComputeError(error)) throw error;
      }
    },
    onSuccess: (w) =>
      void qc.invalidateQueries({ queryKey: qk.household(w.householdId).growth(w.familyMemberId) }),
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

/** Queued measurements shown as "saved on this device" rows until the outbox sends them. */
export function pendingGrowthRows(entries: readonly OutboxEntry[], memberId: string): GrowthRow[] {
  return entries
    .filter((e) => e.kind === GROWTH_MEASUREMENT_KIND)
    .map((e) => e.payload as GrowthWrite)
    .filter((w) => w.familyMemberId === memberId)
    .map((w) => ({
      id: w.id,
      measuredOn: w.measuredOn,
      ageMonths: null,
      heightCm: w.heightCm,
      weightKg: w.weightKg,
      headCm: w.headCm,
      bmi:
        w.heightCm && w.weightKg
          ? Math.round((w.weightKg / (w.heightCm / 100) ** 2) * 10) / 10
          : null,
      reference: 'who_2006' as const,
      percentile: { wfa: null, hfa: null, bmi: null, hc: null },
      flags: [],
      computed: false,
      queued: true,
    }));
}

export function mergeRows(
  server: readonly GrowthRow[],
  pending: readonly GrowthRow[],
): GrowthRow[] {
  const byDate = new Map(server.map((r) => [r.measuredOn, r]));
  for (const p of pending) byDate.set(p.measuredOn, p);
  return [...byDate.values()].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
}

export function useGrowthDashboard(householdId: string | null, memberId: string | null) {
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').growth(memberId ?? 'none'),
    queryFn: () => fetchGrowthDashboard(memberId as string),
    enabled: Boolean(householdId && memberId) && isSupabaseConfigured,
  });
  const outbox = useOutboxStore(selectEntries);
  const rows = useMemo(
    () => mergeRows(query.data?.rows ?? [], memberId ? pendingGrowthRows(outbox, memberId) : []),
    [query.data, outbox, memberId],
  );
  return { ...query, rows };
}

/** Reference curves for the chart; LMS tables change only with a seed release. */
export function useLmsRows(
  reference: GrowthReference | null,
  indicator: Indicator,
  sex: string | null,
  enabled: boolean,
) {
  const ok = enabled && reference !== null && (sex === 'female' || sex === 'male');
  return useQuery({
    queryKey: qk.catalog.growthLms(reference ?? 'none', LMS_INDICATOR[indicator], sex ?? 'none'),
    queryFn: () =>
      fetchLmsRows(
        reference as GrowthReference,
        LMS_INDICATOR[indicator],
        sex as 'female' | 'male',
      ),
    enabled: ok && isSupabaseConfigured,
    staleTime: 7 * 24 * 60 * 60_000,
  });
}

/** Queues a measurement (offline-safe, P10); one per member and day. */
export function logMeasurement(
  input: Omit<GrowthWrite, 'id'> & { existingId?: string },
  lifeStage: 'infant' | 'toddler' | 'child' | 'teen' | 'adult' | 'older_adult',
): GrowthWrite {
  const { existingId, ...rest } = input;
  const w: GrowthWrite = { ...rest, id: existingId ?? Crypto.randomUUID() };
  useOutboxStore.getState().enqueue({
    kind: GROWTH_MEASUREMENT_KIND,
    scope: `household:${w.householdId}`,
    dedupeKey: `${w.familyMemberId}:${w.measuredOn}`,
    id: w.id,
    payload: w,
  });
  track('growth_measurement_added', {
    indicator_count: [w.heightCm, w.weightKg, w.headCm].filter((v) => v !== null).length,
    life_stage: lifeStage,
  });
  return w;
}
