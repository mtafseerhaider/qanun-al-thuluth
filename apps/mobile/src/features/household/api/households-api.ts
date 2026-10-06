import { BudgetInput, HouseholdInput } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import type { TableRow } from '@/lib/supabase/database';
import { toDbAppError } from '@/lib/supabase/error-mapping';
import { definedOnly } from '@/lib/object/defined-only';
import type { HouseholdRole } from '@/stores/use-active-household-store';

/** Households, memberships and budgets through PostgREST + RLS (06 §3.1, 05 §16). */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export type HouseholdSummary = Pick<
  TableRow<'households'>,
  | 'id'
  | 'name'
  | 'country_code'
  | 'city'
  | 'timezone'
  | 'currency'
  | 'family_size'
  | 'owner_user_id'
>;

export interface Membership {
  household_id: string;
  role: HouseholdRole;
  household: HouseholdSummary;
}

const HOUSEHOLD_COLUMNS =
  'id, name, country_code, city, timezone, currency, family_size, owner_user_id';

/** Households the user belongs to with their role (live rows only; RLS hides deleted ones). */
export async function fetchMyHouseholds(userId: string): Promise<Membership[]> {
  const { data, error } = await client()
    .from('household_members')
    .select(`household_id, role, household:households(${HOUSEHOLD_COLUMNS})`)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw toDbAppError(error);
  const rows = (data ?? []) as unknown as Array<{
    household_id: string;
    role: HouseholdRole;
    household: HouseholdSummary | null;
  }>;
  return rows.filter((r): r is Membership => r.household !== null);
}

export async function fetchHousehold(householdId: string): Promise<HouseholdSummary | null> {
  const { data, error } = await client()
    .from('households')
    .select(HOUSEHOLD_COLUMNS)
    .eq('id', householdId)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return (data as HouseholdSummary | null) ?? null;
}

/**
 * Creates a household with a client-generated id so a retry after a crash is idempotent (09 §4.2).
 * The owner `household_members` row is inserted by trigger (05 §15.5); the tier trigger raises
 * `LIMIT_REACHED:households` for a second household on free.
 */
export async function createHousehold(
  id: string,
  ownerUserId: string,
  input: HouseholdInput,
): Promise<void> {
  const parsed = HouseholdInput.parse(input);
  const { error } = await client()
    .from('households')
    .insert({ id, owner_user_id: ownerUserId, ...definedOnly(parsed) });
  if (!error) return;
  const mapped = toDbAppError(error);
  if (mapped.code === 'CONFLICT') return; // already created by an earlier attempt
  throw mapped;
}

export async function updateHousehold(id: string, input: HouseholdInput): Promise<void> {
  const parsed = HouseholdInput.parse(input);
  const { error } = await client().from('households').update(definedOnly(parsed)).eq('id', id);
  if (error) throw toDbAppError(error);
}

export type BudgetProfile = Pick<
  TableRow<'budget_profiles'>,
  'id' | 'monthly_amount_minor' | 'currency' | 'strictness'
>;

export async function fetchActiveBudget(householdId: string): Promise<BudgetProfile | null> {
  const { data, error } = await client()
    .from('budget_profiles')
    .select('id, monthly_amount_minor, currency, strictness')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return (data as BudgetProfile | null) ?? null;
}

/** One active budget per household (05 §11.1): update it if present, otherwise insert. */
export async function saveBudget(householdId: string, input: BudgetInput): Promise<void> {
  const parsed = BudgetInput.parse(input);
  const existing = await fetchActiveBudget(householdId);
  const db = client();
  const { error } = existing
    ? await db.from('budget_profiles').update(parsed).eq('id', existing.id)
    : await db.from('budget_profiles').insert({ household_id: householdId, ...parsed });
  if (error) throw toDbAppError(error);
}

export interface HouseholdPerson {
  id: string;
  user_id: string;
  role: HouseholdRole;
  display_name: string;
  email: string | null;
}

/** App users with access to the household (owner, caregivers, viewers). */
export async function fetchHouseholdPeople(householdId: string): Promise<HouseholdPerson[]> {
  const { data, error } = await client()
    .from('household_members')
    .select('id, user_id, role, user:users!household_members_user_id_fkey(display_name, email)')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw toDbAppError(error);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    role: HouseholdRole;
    user: { display_name: string; email: string | null } | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role: r.role,
    display_name: r.user?.display_name ?? '',
    email: r.user?.email ?? null,
  }));
}

/** Owner removes someone, or a non-owner leaves (soft_delete RPC rules, 05 §14.3). */
export async function removeHouseholdPerson(householdMemberId: string): Promise<void> {
  const { error } = await client().rpc('soft_delete', {
    p_table: 'household_members',
    p_id: householdMemberId,
  });
  if (error) throw toDbAppError(error);
}

export async function changeHouseholdRole(
  householdMemberId: string,
  role: Extract<HouseholdRole, 'caregiver' | 'viewer'>,
): Promise<void> {
  const { error } = await client()
    .from('household_members')
    .update({ role })
    .eq('id', householdMemberId);
  if (error) throw toDbAppError(error);
}

export type PendingInvitation = Pick<
  TableRow<'household_invitations'>,
  'id' | 'email' | 'role' | 'expires_at' | 'created_at'
>;

/** Pending invitations (owner only by RLS; other roles get an empty list). */
export async function fetchPendingInvitations(householdId: string): Promise<PendingInvitation[]> {
  const { data, error } = await client()
    .from('household_invitations')
    .select('id, email, role, expires_at, created_at')
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw toDbAppError(error);
  return (data ?? []) as PendingInvitation[];
}
