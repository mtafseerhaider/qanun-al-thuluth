import { FamilyMemberInput } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import type { TableRow } from '@/lib/supabase/database';
import { definedOnly } from '@/lib/object/defined-only';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/** `family_members` CRUD (06 §3.1). Life stage is derived by trigger; never sent by the client. */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export type FamilyMember = Pick<
  TableRow<'family_members'>,
  | 'id'
  | 'household_id'
  | 'linked_user_id'
  | 'name'
  | 'date_of_birth'
  | 'sex_at_birth'
  | 'height_cm'
  | 'weight_kg'
  | 'activity_level'
  | 'life_stage'
  | 'sort_order'
>;

const COLUMNS =
  'id, household_id, linked_user_id, name, date_of_birth, sex_at_birth, height_cm, weight_kg, activity_level, life_stage, sort_order';

export async function listFamilyMembers(householdId: string): Promise<FamilyMember[]> {
  const { data, error } = await client()
    .from('family_members')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw toDbAppError(error);
  return (data ?? []) as unknown as FamilyMember[];
}

/**
 * Explicit insert vs update (not upsert): BEFORE INSERT triggers, including the tier count, fire
 * even when an upsert resolves to an update. Inserts use a client id so a retried insert that
 * already landed (23505) counts as success.
 */
export async function insertFamilyMember(
  id: string,
  householdId: string,
  input: FamilyMemberInput,
): Promise<void> {
  const parsed = FamilyMemberInput.parse(input);
  const { error } = await client()
    .from('family_members')
    .insert({ id, household_id: householdId, ...definedOnly(parsed) });
  if (!error) return;
  const mapped = toDbAppError(error);
  if (mapped.code !== 'CONFLICT') throw mapped;
}

export async function updateFamilyMember(id: string, input: FamilyMemberInput): Promise<void> {
  // The member form does not edit modules or blood group; the schema defaults ([] / 'unknown')
  // must not overwrite what intake saved (S2-06).
  const {
    special_modules: _modules,
    blood_group: _blood,
    ...patch
  } = FamilyMemberInput.parse(input);
  const { error } = await client().from('family_members').update(definedOnly(patch)).eq('id', id);
  if (error) throw toDbAppError(error);
}

/** Soft delete through the RPC (05 §14.3); owners and caregivers only. */
export async function removeFamilyMember(id: string): Promise<void> {
  const { error } = await client().rpc('soft_delete', { p_table: 'family_members', p_id: id });
  if (error) throw toDbAppError(error);
}
