import type * as GoogleSignInModule from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toAuthAppError } from '@/lib/supabase/error-mapping';

/**
 * Native Google sign-in (11 §4). The SDK is imported lazily so builds and dev clients without the
 * native module (or without client ids) still start; the button is hidden when not configured.
 * Account linking by verified email is Supabase Auth behaviour (11 §6.1): no client code is needed.
 */
type GoogleSdk = typeof GoogleSignInModule;

let sdk: GoogleSdk | null = null;
let configured = false;

/** The web client id is the token audience Supabase verifies; iOS additionally needs its own id. */
export function isGoogleSignInConfigured(
  config: { web?: string | undefined; ios?: string | undefined } = {
    web: env.GOOGLE_WEB_CLIENT_ID,
    ios: env.GOOGLE_IOS_CLIENT_ID,
  },
  os: string = Platform.OS,
): boolean {
  if (!config.web) return false;
  if (os === 'ios') return Boolean(config.ios);
  return os === 'android';
}

async function loadSdk(): Promise<GoogleSdk> {
  if (!sdk) sdk = await import('@react-native-google-signin/google-signin');
  if (!configured) {
    sdk.GoogleSignin.configure({
      ...(env.GOOGLE_WEB_CLIENT_ID ? { webClientId: env.GOOGLE_WEB_CLIENT_ID } : {}),
      ...(env.GOOGLE_IOS_CLIENT_ID ? { iosClientId: env.GOOGLE_IOS_CLIENT_ID } : {}),
      scopes: ['email', 'profile'],
      offlineAccess: false,
    });
    configured = true;
  }
  return sdk;
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  if (!isGoogleSignInConfigured())
    throw new AppError('NOT_CONFIGURED', 'Google sign-in is not configured.');
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = await loadSdk();
  let idToken: string | null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new AppError('AUTH_CANCELLED', 'Google sign-in cancelled.');
    idToken = res.data.idToken;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED)
        throw new AppError('AUTH_CANCELLED', 'Google sign-in cancelled.');
      if (e.code === statusCodes.IN_PROGRESS)
        throw new AppError('AUTH_IN_PROGRESS', 'Google sign-in in progress.');
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE)
        throw new AppError('AUTH_PLAY_SERVICES_UNAVAILABLE', 'Play services unavailable.');
    }
    throw new AppError('AUTH_PROVIDER_ERROR', e instanceof Error ? e.message : 'Google failed.');
  }
  if (!idToken) throw new AppError('AUTH_PROVIDER_NO_TOKEN', 'Google returned no id token.');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw toAuthAppError(error);
}

/** Clears the Google account choice so the chooser appears next time (11 §11.2). Never throws. */
export async function signOutOfGoogle(): Promise<void> {
  if (!sdk) return;
  await sdk.GoogleSignin.signOut().catch(() => undefined);
}
