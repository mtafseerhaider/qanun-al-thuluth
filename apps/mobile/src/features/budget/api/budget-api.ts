import { BudgetInput } from '@shared';
import { BudgetEntryInput } from '@shared/domain/tracking';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type {
  BudgetCategoryView,
  BudgetEntryDeleteWrite,
  BudgetEntryView,
  BudgetEntryWrite,
  BudgetProfileView,
  Strictness,
} from '../utils/budget-rules';

/** Budget profile, categories and spend entries through PostgREST + RLS (05 §11.1, §11.7). */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

function toSplit(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

export async function fetchBudgetProfile(householdId: string): Promise<BudgetProfileView | null> {
  const { data, error } = await client()
    .from('budget_profiles')
    .select('id, monthly_amount_minor, currency, strictness, category_split')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  if (!data) return null;
  return {
    id: data.id,
    monthlyAmountMinor: Number(data.monthly_amount_minor),
    currency: data.currency,
    strictness: data.strictness as Strictness,
    categorySplit: toSplit(data.category_split),
  };
}

export async function fetchBudgetCategories(): Promise<BudgetCategoryView[]> {
  const { data, error } = await client()
    .from('budget_categories')
    .select('id, code, name_i18n, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw toDbAppError(error);
  return (data ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    nameI18n: c.name_i18n,
    sortOrder: Number(c.sort_order),
  }));
}

export async function fetchBudgetEntries(
  householdId: string,
  from: string,
  to: string,
): Promise<BudgetEntryView[]> {
  const { data, error } = await client()
    .from('budget_entries')
    .select('id, amount_minor, currency, category_id, spent_on, grocery_list_id, note')
    .eq('household_id', householdId)
    .gte('spent_on', from)
    .lte('spent_on', to)
    .order('spent_on', { ascending: false })
    .limit(500);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    categoryId: r.category_id,
    spentOn: r.spent_on,
    groceryListId: r.grocery_list_id,
    note: r.note,
  }));
}

/** Idempotent on the client id: a replay after a lost response inserts nothing twice. */
export async function insertBudgetEntry(w: BudgetEntryWrite): Promise<void> {
  const parsed = BudgetEntryInput.parse({
    id: w.id,
    budget_profile_id: w.budgetProfileId,
    amount_minor: w.amountMinor,
    currency: w.currency,
    category_id: w.categoryId,
    spent_on: w.spentOn,
    grocery_list_id: w.groceryListId,
    note: w.note,
  });
  const { error } = await client()
    .from('budget_entries')
    .upsert(
      {
        id: parsed.id,
        household_id: w.householdId,
        budget_profile_id: parsed.budget_profile_id,
        amount_minor: parsed.amount_minor,
        currency: parsed.currency,
        category_id: parsed.category_id,
        spent_on: parsed.spent_on,
        grocery_list_id: parsed.grocery_list_id ?? null,
        note: parsed.note ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw toDbAppError(error);
}

export async function deleteBudgetEntry(w: BudgetEntryDeleteWrite): Promise<void> {
  const { error } = await client().from('budget_entries').delete().eq('id', w.id);
  if (error) throw toDbAppError(error);
}

/** Saves the active budget and its category split (one active budget per household). */
export async function saveBudgetSettings(
  householdId: string,
  input: BudgetInput & { categorySplit: Record<string, number> },
): Promise<void> {
  const parsed = BudgetInput.parse(input);
  const existing = await fetchBudgetProfile(householdId);
  const db = client();
  const row = { ...parsed, category_split: input.categorySplit };
  const { error } = existing
    ? await db.from('budget_profiles').update(row).eq('id', existing.id)
    : await db.from('budget_profiles').insert({ household_id: householdId, ...row });
  if (error) throw toDbAppError(error);
}
