import { ConsentGrant } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type { LiveConsent } from '../utils/consent-rules';

/** `consents` is append-only history; each grant is its own row with a version (11 §13.3). */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export async function fetchLiveConsents(userId: string): Promise<LiveConsent[]> {
  const { data, error } = await client()
    .from('consents')
    .select('kind, version, household_id, granted_at')
    .eq('user_id', userId)
    .is('withdrawn_at', null);
  if (error) throw toDbAppError(error);
  return (data ?? []) as LiveConsent[];
}

/**
 * Inserts one row per grant. A duplicate live grant of the same version hits the unique index
 * `consents_one_live` (23505) and counts as already granted, so retries are safe.
 */
export async function grantConsents(userId: string, grants: ConsentGrant[]): Promise<void> {
  const db = client();
  for (const grant of grants) {
    const g = ConsentGrant.parse(grant);
    const { error } = await db.from('consents').insert({
      user_id: userId,
      kind: g.kind,
      version: g.version,
      household_id: g.household_id ?? null,
    });
    if (error) {
      const mapped = toDbAppError(error);
      if (mapped.code !== 'CONFLICT') throw mapped;
    }
  }
}
