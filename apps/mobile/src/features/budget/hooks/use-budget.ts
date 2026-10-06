import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';

import type { BudgetInput } from '@shared';

import { useFamilyMembers } from '@/features/family';
import { useHouseholdClock } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import {
  deleteBudgetEntry,
  fetchBudgetCategories,
  fetchBudgetEntries,
  fetchBudgetProfile,
  insertBudgetEntry,
  saveBudgetSettings,
} from '../api/budget-api';
import {
  applyPendingEntries,
  BUDGET_ENTRY_DELETE_KIND,
  BUDGET_ENTRY_KIND,
  monthBounds,
  monthOf,
  summarizeBudget,
  type BudgetEntryDeleteWrite,
  type BudgetEntryView,
  type BudgetEntryWrite,
} from '../utils/budget-rules';

const entriesKey = (householdId: string) => [...qk.household(householdId).all(), 'budget-entries'];

/** Registers the budget outbox handlers (called once from the app layer, 24 S4-07). */
export function registerBudgetOutboxHandlers(qc: QueryClient): void {
  const refresh = (w: { householdId: string }) =>
    void qc.invalidateQueries({ queryKey: entriesKey(w.householdId) });
  registerOutboxHandler<BudgetEntryWrite>(BUDGET_ENTRY_KIND, {
    run: (w) => insertBudgetEntry(w),
    onSuccess: refresh,
  });
  registerOutboxHandler<BudgetEntryDeleteWrite>(BUDGET_ENTRY_DELETE_KIND, {
    run: (w) => deleteBudgetEntry(w),
    onSuccess: refresh,
  });
}

export function useBudgetProfile(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').budgetProfile(),
    queryFn: () => fetchBudgetProfile(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

export function useBudgetCategories() {
  return useQuery({
    queryKey: qk.catalog.budgetCategories(),
    queryFn: fetchBudgetCategories,
    enabled: isSupabaseConfigured,
    staleTime: 24 * 60 * 60_000,
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

export function useBudgetEntries(householdId: string | null, month: string) {
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').budgetEntries(month),
    queryFn: () => {
      const { from, to } = monthBounds(month);
      return fetchBudgetEntries(householdId as string, from, to);
    },
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
  const outbox = useOutboxStore(selectEntries);
  const data = useMemo<BudgetEntryView[]>(
    () =>
      applyPendingEntries(
        query.data ?? [],
        outbox.filter((e) => (e.payload as { householdId?: string }).householdId === householdId),
      ).filter((e) => monthOf(e.spentOn) === month),
    [query.data, outbox, householdId, month],
  );
  return { ...query, data };
}

/** Everything the budget dashboard and the Today budget line need for one month. */
export function useBudgetSummary(householdId: string | null, month?: string) {
  const clock = useHouseholdClock(householdId);
  const m = month ?? monthOf(clock.today);
  const profile = useBudgetProfile(householdId);
  const categories = useBudgetCategories();
  const entries = useBudgetEntries(householdId, m);
  const members = useFamilyMembers(householdId);
  const summary = useMemo(
    () =>
      summarizeBudget({
        month: m,
        today: clock.today,
        budgetMinor: profile.data?.monthlyAmountMinor ?? 0,
        categorySplit: profile.data?.categorySplit ?? {},
        categories: categories.data ?? [],
        entries: entries.data,
        members: (members.data ?? []).length,
      }),
    [m, clock.today, profile.data, categories.data, entries.data, members.data],
  );
  return {
    month: m,
    today: clock.today,
    profile: profile.data ?? null,
    categories: categories.data ?? [],
    entries: entries.data,
    summary,
    isLoading: profile.isLoading || entries.isLoading,
    isError: profile.isError || entries.isError,
    refetch: () => {
      void profile.refetch();
      void entries.refetch();
    },
  };
}

export function addBudgetEntry(
  input: Omit<BudgetEntryWrite, 'id'>,
  source: 'manual' | 'grocery' = 'manual',
  categoryCode = 'other',
): string {
  const id = Crypto.randomUUID();
  useOutboxStore.getState().enqueue({
    kind: BUDGET_ENTRY_KIND,
    scope: `household:${input.householdId}`,
    dedupeKey: id,
    payload: { ...input, id } satisfies BudgetEntryWrite,
  });
  track('budget_entry_added', { category: categoryCode, source });
  return id;
}

export function removeBudgetEntry(householdId: string, entry: BudgetEntryView): void {
  const store = useOutboxStore.getState();
  const queued = store.entries.find(
    (e) => e.kind === BUDGET_ENTRY_KIND && (e.payload as BudgetEntryWrite).id === entry.id,
  );
  if (queued) {
    store.remove(queued.id);
    return;
  }
  store.enqueue({
    kind: BUDGET_ENTRY_DELETE_KIND,
    scope: `household:${householdId}`,
    dedupeKey: entry.id,
    payload: { id: entry.id, householdId } satisfies BudgetEntryDeleteWrite,
  });
}

/** Settings are saved online (they change rarely and are validated server-side). */
export function useSaveBudgetSettings(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['budget', 'settings'],
    networkMode: 'online',
    mutationFn: (v: BudgetInput & { categorySplit: Record<string, number> }) => {
      if (!householdId) throw new Error('No household');
      return saveBudgetSettings(householdId, v);
    },
    onSuccess: () => {
      if (!householdId) return;
      track('setting_changed', { key: 'budget' });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).budgetProfile() });
    },
  });
}
