import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toAuthAppError } from '@/lib/supabase/error-mapping';

/** Sign in with Apple on iOS (11 §5). Hidden on Android in v1 and wherever the API is unavailable. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** 72 characters of randomness; Apple receives SHA-256(raw), Supabase receives raw and compares. */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = Crypto.randomUUID() + Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

export async function signInWithApple(): Promise<void> {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  const nonce = await createNonce();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: nonce.hashed,
    });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'ERR_REQUEST_CANCELED')
      throw new AppError('AUTH_CANCELLED', 'Apple sign-in cancelled.');
    throw new AppError('AUTH_PROVIDER_ERROR', e instanceof Error ? e.message : 'Apple failed.');
  }
  if (!credential.identityToken)
    throw new AppError('AUTH_PROVIDER_NO_TOKEN', 'Apple returned no identity token.');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: nonce.raw,
  });
  if (error) throw toAuthAppError(error);

  // Apple shares the name only on the first authorisation; store it if the profile has none yet.
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (fullName && data.user) {
    await supabase
      .from('users')
      .update({ display_name: fullName.slice(0, 80) })
      .eq('id', data.user.id)
      .eq('display_name', '');
  }
}
