import { captchaOptions } from '@/lib/auth/captcha';

import { AppError } from './app-error';
import { supabase } from './client';

/** Seeded by supabase/seed/local/900_dev_fixtures.sql: premium owner of the "Lahore Family" household. */
const DEV_EMAIL = 'owner@thuluth.test';
const DEV_PASSWORD = 'thuluth-local-dev';

/** The seeded household, attached to debug analytics events. */
export const DEV_SEED_HOUSEHOLD_ID = '00000000-0000-4000-b000-000000000001';

/**
 * Development-only Supabase session for the Sprint 0 demo, before real sign-in lands in Sprint 1.
 * Signs in as the seeded local fixture user so RLS insert policies apply. Anonymous sign-in stays
 * off, as in the hosted projects (10 §5): every row must belong to a real account.
 */
export async function signInAsDevSeedUser(): Promise<string> {
  if (!__DEV__) throw new AppError('FORBIDDEN', 'Dev sign-in is disabled in release builds.');
  if (!supabase)
    throw new AppError('NOT_CONFIGURED', 'Supabase URL or anon key is not configured.');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
    options: await captchaOptions(),
  });
  if (error || !data.user)
    throw new AppError('UNAUTHENTICATED', error?.message ?? 'Dev sign-in failed.');
  return data.user.id;
}
