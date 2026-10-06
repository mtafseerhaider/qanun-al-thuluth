import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toAuthAppError } from '@/lib/supabase/error-mapping';

import { normalizeEmail } from '../utils/email';

/** Email OTP through Supabase Auth (11 §3.3). One call serves sign-up and sign-in. */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export async function requestEmailOtp(email: string, locale: 'en' | 'ur'): Promise<void> {
  const { error } = await client().auth.signInWithOtp({
    email: normalizeEmail(email),
    options: { shouldCreateUser: true, data: { locale } },
  });
  if (error) throw toAuthAppError(error);
}

export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({
    email: normalizeEmail(email),
    token,
    type: 'email',
  });
  if (error) throw toAuthAppError(error);
}

/** Store reviewer only (00 §11, 11 §3.1.1); the server hook rejects any other password sign-up. */
export async function signInReviewer(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });
  if (error) throw toAuthAppError(error);
}
