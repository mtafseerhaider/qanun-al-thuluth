import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Long-term memory management (FR-CHAT-08, FR-SET-04, 12 §7.2). Owners and caregivers can read a
 * household's live memories; forgetting one soft-deletes it (`soft_delete` RPC) and removes it from
 * recall immediately. `users.ai_memory_enabled` is the per-user on/off switch the memory writer and
 * recall respect.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface MemoryView {
  id: string;
  fact: string;
  familyMemberId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export async function fetchMemories(householdId: string): Promise<MemoryView[]> {
  const { data, error } = await client()
    .from('ai_memories')
    .select('id, fact, family_member_id, created_at, expires_at')
    .eq('household_id', householdId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((m) => ({
    id: m.id,
    fact: m.fact,
    familyMemberId: m.family_member_id,
    createdAt: m.created_at,
    expiresAt: m.expires_at,
  }));
}

export async function deleteMemory(id: string): Promise<void> {
  const { error } = await client().rpc('soft_delete', { p_table: 'ai_memories', p_id: id });
  if (error) throw toDbAppError(error);
}

export async function clearMemories(householdId: string): Promise<number> {
  const { data, error } = await client().rpc('clear_ai_memories', {
    p_household_id: householdId,
  });
  if (error) throw toDbAppError(error);
  return typeof data === 'number' ? data : 0;
}

export async function fetchMemoryEnabled(userId: string): Promise<boolean> {
  const { data, error } = await client()
    .from('users')
    .select('ai_memory_enabled')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data?.ai_memory_enabled ?? true;
}

export async function setMemoryEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await client()
    .from('users')
    .update({ ai_memory_enabled: enabled })
    .eq('id', userId);
  if (error) throw toDbAppError(error);
}
