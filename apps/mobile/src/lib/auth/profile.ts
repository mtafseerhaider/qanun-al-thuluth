import { ProfileUpdate } from '@shared';

import { definedOnly } from '@/lib/object/defined-only';
import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import type { TableRow } from '@/lib/supabase/database';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/** The `users` columns the client reads (11 §8). */
export const PROFILE_COLUMNS =
  'id, display_name, email, locale, country_code, timezone, tradition_preference, units, onboarding_completed_at, age_attested_at';

export type Profile = Pick<
  TableRow<'users'>,
  | 'id'
  | 'display_name'
  | 'email'
  | 'locale'
  | 'country_code'
  | 'timezone'
  | 'tradition_preference'
  | 'units'
  | 'onboarding_completed_at'
  | 'age_attested_at'
>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireClient() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

/**
 * Reads the caller's `users` row. The row is created by a trigger on `auth.users`, so right after
 * sign-up it may lag: retry 3 times at 300 ms, then AUTH_PROFILE_MISSING (11 §9 step 1).
 */
export async function fetchProfile(
  userId: string,
  { retries = 3, delayMs = 300 }: { retries?: number; delayMs?: number } = {},
): Promise<Profile> {
  const client = requireClient();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await client
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error) throw toDbAppError(error);
    if (data) return data as Profile;
    if (attempt < retries) await sleep(delayMs);
  }
  throw new AppError('AUTH_PROFILE_MISSING', 'users row not found after sign-in.');
}

/** Updates editable profile columns (06 §3.1). `onboarding_completed_at` and
 * `age_attested_at` are set only by onboarding. */
export async function updateProfile(
  userId: string,
  patch: ProfileUpdate & { onboarding_completed_at?: string; age_attested_at?: string },
): Promise<void> {
  const client = requireClient();
  const { onboarding_completed_at, age_attested_at, ...rest } = patch;
  const parsed = definedOnly(ProfileUpdate.parse(rest));
  const { error } = await client
    .from('users')
    .update({
      ...parsed,
      ...(onboarding_completed_at ? { onboarding_completed_at } : {}),
      ...(age_attested_at ? { age_attested_at } : {}),
    })
    .eq('id', userId);
  if (error) throw toDbAppError(error);
}
