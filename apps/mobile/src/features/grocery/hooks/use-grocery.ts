import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import {
  deleteItem,
  fetchGroceryList,
  fetchGroceryLists,
  insertManualItem,
  insertPriceReport,
  requestGroceryList,
  setListStatus,
  updateItem,
} from '../api/grocery-api';
import {
  applyPendingItems,
  GROCERY_ITEM_ADD_KIND,
  GROCERY_ITEM_DELETE_KIND,
  GROCERY_ITEM_UPDATE_KIND,
  GROCERY_LIST_STATUS_KIND,
  itemChangeEntry,
  pendingListStatus,
  PRICE_REPORT_KIND,
  type ItemAddWrite,
  type ItemChange,
  type ItemDeleteWrite,
  type ItemUpdateWrite,
  type ListStatus,
  type ListStatusWrite,
  type PriceReportWrite,
} from '../utils/grocery-rules';

/** Registers the grocery outbox handlers (called once from the app layer, 24 S4-05). */
export function registerGroceryOutboxHandlers(qc: QueryClient): void {
  const refresh = (w: { householdId: string; listId?: string }) => {
    const h = qk.household(w.householdId);
    void qc.invalidateQueries({ queryKey: w.listId ? h.groceryList(w.listId) : h.groceryLists() });
  };
  registerOutboxHandler<ItemAddWrite>(GROCERY_ITEM_ADD_KIND, {
    run: async (w) => {
      await insertManualItem(w);
    },
    onSuccess: refresh,
  });
  registerOutboxHandler<ItemUpdateWrite>(GROCERY_ITEM_UPDATE_KIND, {
    run: (w) => updateItem(w),
    onSuccess: refresh,
  });
  registerOutboxHandler<ItemDeleteWrite>(GROCERY_ITEM_DELETE_KIND, {
    run: (w) => deleteItem(w),
    onSuccess: refresh,
  });
  registerOutboxHandler<ListStatusWrite>(GROCERY_LIST_STATUS_KIND, {
    run: (w) => setListStatus(w),
    onSuccess: (w) => {
      refresh(w);
      void qc.invalidateQueries({ queryKey: qk.household(w.householdId).groceryLists() });
    },
  });
  registerOutboxHandler<PriceReportWrite>(PRICE_REPORT_KIND, {
    run: (w) => insertPriceReport(w),
  });
}

export function useGroceryLists(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').groceryLists(),
    queryFn: () => fetchGroceryLists(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

/** One list with its items, queued changes overlaid (works fully offline once cached). */
export function useGroceryList(householdId: string | null, listId: string) {
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').groceryList(listId),
    queryFn: () => fetchGroceryList(listId),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
  const entries = useOutboxStore(selectEntries);
  const data = useMemo(() => {
    if (!query.data) return query.data;
    return {
      list: { ...query.data.list, status: pendingListStatus(query.data.list, entries) },
      items: applyPendingItems(query.data.items, entries, listId),
    };
  }, [query.data, entries, listId]);
  const pending = useMemo(
    () => entries.some((e) => (e.payload as { listId?: string }).listId === listId),
    [entries, listId],
  );
  return { ...query, data, pending };
}

/**
 * `grocery-generate` from the active plan (FR-GRO-01). Online only; one Idempotency-Key per tap.
 * Free accounts send `optimize: false` (the server forces it anyway, 06 §4.7).
 */
export function useGenerateGroceryList(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['grocery', 'generate'],
    networkMode: 'online',
    mutationFn: (v: {
      mealPlanId: string;
      startsOn: string;
      endsOn: string;
      premium: boolean;
      source: 'lists' | 'plan' | 'dashboard';
      replaceListId?: string;
    }) => {
      if (!householdId) throw new Error('No household');
      track('grocery_generate_requested', { source: v.source, optimize: v.premium });
      return requestGroceryList(
        {
          household_id: householdId,
          meal_plan_id: v.mealPlanId,
          period: 'weekly',
          starts_on: v.startsOn,
          ends_on: v.endsOn,
          optimize: v.premium,
          pantry_exclusions: [],
          ...(v.replaceListId ? { replace_list_id: v.replaceListId } : {}),
        },
        Crypto.randomUUID(),
      );
    },
    onSuccess: () => {
      if (householdId)
        void qc.invalidateQueries({ queryKey: qk.household(householdId).groceryLists() });
    },
  });
}

/** Queues a change to one item (check-off, quantity, actual price); see `itemChangeEntry`. */
export function changeItem(
  item: { id: string; listId: string; householdId: string },
  change: ItemChange,
  at: Date = new Date(),
): void {
  const store = useOutboxStore.getState();
  const e = itemChangeEntry(store.entries, item, change, at.toISOString());
  store.enqueue({
    kind: e.kind,
    scope: `household:${item.householdId}`,
    dedupeKey: e.dedupeKey,
    payload: e.payload,
  });
}

export function addManualItem(input: Omit<ItemAddWrite, 'id'>): string {
  const id = Crypto.randomUUID();
  useOutboxStore.getState().enqueue({
    kind: GROCERY_ITEM_ADD_KIND,
    scope: `household:${input.householdId}`,
    dedupeKey: id,
    payload: { ...input, id } satisfies ItemAddWrite,
  });
  track('grocery_item_added', {});
  return id;
}

/** Deletes an item; a manual item that never reached the server just leaves the queue. */
export function removeItem(item: { id: string; listId: string; householdId: string }): void {
  const store = useOutboxStore.getState();
  const queuedAdd = store.entries.find(
    (e) => e.kind === GROCERY_ITEM_ADD_KIND && (e.payload as ItemAddWrite).id === item.id,
  );
  for (const e of store.entries)
    if (
      (e.kind === GROCERY_ITEM_UPDATE_KIND && (e.payload as ItemUpdateWrite).itemId === item.id) ||
      e === queuedAdd
    )
      store.remove(e.id);
  if (queuedAdd) return;
  store.enqueue({
    kind: GROCERY_ITEM_DELETE_KIND,
    scope: `household:${item.householdId}`,
    dedupeKey: item.id,
    payload: { itemId: item.id, listId: item.listId, householdId: item.householdId },
  });
}

export function changeListStatus(w: ListStatusWrite): void {
  useOutboxStore.getState().enqueue({
    kind: GROCERY_LIST_STATUS_KIND,
    scope: `household:${w.householdId}`,
    dedupeKey: w.listId,
    payload: w,
  });
  if (w.status === 'shopping') track('shopping_started', {});
}

export function reportPrice(w: PriceReportWrite): void {
  useOutboxStore.getState().enqueue({
    kind: PRICE_REPORT_KIND,
    scope: `household:${w.householdId}`,
    id: w.id,
    payload: w,
  });
}

export type { ListStatus };
