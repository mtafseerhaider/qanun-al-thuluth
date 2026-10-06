import { GroceryGenerateRequest, GroceryGenerateResponse } from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { getCurrentUserId, supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type {
  GroceryListView,
  ItemAddWrite,
  ItemDeleteWrite,
  ItemUpdateWrite,
  ListStatusWrite,
  PriceReportWrite,
  ShoppingItemView,
} from '../utils/grocery-rules';

/**
 * Grocery lists and items (05 §11.5 to §11.6, 06 §4.7). Lists are created by `grocery-generate`
 * (online); item writes go through the outbox and use `updated_at` as the last-write-wins guard:
 * an older replay never overwrites a newer change from another device (FR-GRO-02).
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export async function requestGroceryList(
  req: GroceryGenerateRequest,
  idempotencyKey: string,
): Promise<GroceryGenerateResponse> {
  return invokeEdge(
    'grocery-generate',
    GroceryGenerateRequest.parse(req),
    GroceryGenerateResponse,
    {
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

const LIST_COLUMNS =
  'id, household_id, meal_plan_id, period, starts_on, ends_on, estimated_total_minor, currency, status, price_profile_id';

interface RawList {
  id: string;
  household_id: string;
  meal_plan_id: string | null;
  period: GroceryListView['period'];
  starts_on: string;
  ends_on: string;
  estimated_total_minor: number;
  currency: string;
  status: GroceryListView['status'];
  price_profile_id: string | null;
}

function toList(r: RawList): GroceryListView {
  return {
    id: r.id,
    householdId: r.household_id,
    mealPlanId: r.meal_plan_id,
    period: r.period,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    estimatedTotalMinor: Number(r.estimated_total_minor),
    currency: r.currency,
    status: r.status,
    priceProfileId: r.price_profile_id,
  };
}

export async function fetchGroceryLists(householdId: string): Promise<GroceryListView[]> {
  const { data, error } = await client()
    .from('grocery_lists')
    .select(LIST_COLUMNS)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('starts_on', { ascending: false })
    .limit(50);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as RawList[]).map(toList);
}

export interface GroceryListDetail {
  list: GroceryListView;
  items: ShoppingItemView[];
}

export async function fetchGroceryList(listId: string): Promise<GroceryListDetail | null> {
  const db = client();
  const [list, items] = await Promise.all([
    db.from('grocery_lists').select(LIST_COLUMNS).eq('id', listId).maybeSingle(),
    db
      .from('shopping_items')
      .select(
        'id, grocery_list_id, ingredient_id, label, quantity, unit, estimated_minor, actual_minor, is_checked, substitution_for_item_id, aisle, is_fresh, sort_order, updated_at',
      )
      .eq('grocery_list_id', listId)
      .order('sort_order', { ascending: true }),
  ]);
  if (list.error) throw toDbAppError(list.error);
  if (items.error) throw toDbAppError(items.error);
  if (!list.data) return null;
  return {
    list: toList(list.data as unknown as RawList),
    items: (
      (items.data ?? []) as unknown as Array<{
        id: string;
        grocery_list_id: string;
        ingredient_id: string | null;
        label: string;
        quantity: number;
        unit: string;
        estimated_minor: number | null;
        actual_minor: number | null;
        is_checked: boolean;
        substitution_for_item_id: string | null;
        aisle: string | null;
        is_fresh: boolean;
        sort_order: number;
        updated_at: string;
      }>
    ).map((r) => ({
      id: r.id,
      groceryListId: r.grocery_list_id,
      ingredientId: r.ingredient_id,
      label: r.label,
      quantity: Number(r.quantity),
      unit: r.unit,
      estimatedMinor: r.estimated_minor === null ? null : Number(r.estimated_minor),
      actualMinor: r.actual_minor === null ? null : Number(r.actual_minor),
      isChecked: r.is_checked,
      substitutionForItemId: r.substitution_for_item_id,
      aisle: r.aisle,
      isFresh: r.is_fresh,
      sortOrder: Number(r.sort_order),
      updatedAt: r.updated_at,
    })),
  };
}

/** Last write wins per item: applied only when the row was not changed after the client action. */
export async function updateItem(w: ItemUpdateWrite): Promise<void> {
  const patch: { is_checked?: boolean; quantity?: number; actual_minor?: number | null } = {};
  if (w.checked !== undefined) patch.is_checked = w.checked;
  if (w.quantity !== undefined) patch.quantity = w.quantity;
  if (w.actualMinor !== undefined) patch.actual_minor = w.actualMinor;
  if (Object.keys(patch).length === 0) return;
  const { error } = await client()
    .from('shopping_items')
    .update(patch)
    .eq('id', w.itemId)
    .lte('updated_at', w.at);
  if (error) throw toDbAppError(error);
}

export async function insertManualItem(w: ItemAddWrite): Promise<void> {
  const { error } = await client()
    .from('shopping_items')
    .upsert(
      {
        id: w.id,
        grocery_list_id: w.listId,
        household_id: w.householdId,
        label: w.label,
        quantity: w.quantity,
        unit: w.unit,
        aisle: w.aisle,
        is_fresh: w.isFresh,
        is_checked: w.checked ?? false,
        actual_minor: w.actualMinor ?? null,
        sort_order: 9999,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw toDbAppError(error);
}

export async function deleteItem(w: ItemDeleteWrite): Promise<void> {
  const { error } = await client().from('shopping_items').delete().eq('id', w.itemId);
  if (error) throw toDbAppError(error);
}

export async function setListStatus(w: ListStatusWrite): Promise<void> {
  const { error } = await client()
    .from('grocery_lists')
    .update({ status: w.status })
    .eq('id', w.listId);
  if (error) throw toDbAppError(error);
}

/** User price report (FR-GRO-06); moderation and outlier rejection happen server-side. */
export async function insertPriceReport(w: PriceReportWrite): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new AppError('UNAUTHENTICATED', 'Not signed in.');
  const { error } = await client().from('price_observations').upsert(
    {
      id: w.id,
      price_profile_id: w.priceProfileId,
      ingredient_id: w.ingredientId,
      unit: w.unit,
      amount_minor: w.amountMinor,
      observed_on: w.observedOn,
      source: 'user_report',
      reporter_user_id: userId,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw toDbAppError(error);
}
