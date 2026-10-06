import { useEffect, useState } from 'react';

import { track } from '@/lib/analytics/track';
import { isAppleSignInAvailable, signInWithApple } from '@/lib/auth/apple';
import { isGoogleSignInConfigured, signInWithGoogle } from '@/lib/auth/google';
import { isSupabaseConfigured } from '@/lib/env';
import { isAppError } from '@/lib/supabase/app-error';

export type SocialProvider = 'google' | 'apple';

/**
 * Google and Apple buttons (11 §4, §5). Each is shown only when it can work in this build: Google
 * needs client ids from env, Apple needs iOS 13+ with the capability. Cancel is silent (11 §16).
 */
export function useSocialSignIn() {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    if (isSupabaseConfigured)
      void isAppleSignInAvailable().then((ok) => alive && setAppleAvailable(ok));
    return () => {
      alive = false;
    };
  }, []);

  const run = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider);
    setError(null);
    track('auth_social_started', { provider });
    try {
      await (provider === 'google' ? signInWithGoogle() : signInWithApple());
      track('auth_social_completed', { provider });
    } catch (e) {
      if (isAppError(e) && (e.code === 'AUTH_CANCELLED' || e.code === 'AUTH_IN_PROGRESS')) return;
      track('auth_error', { code: isAppError(e) ? e.code : 'UNKNOWN', step: 'social' });
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return {
    googleAvailable: isSupabaseConfigured && isGoogleSignInConfigured(),
    appleAvailable,
    busy,
    error,
    signIn: run,
  };
}
