import { env } from '@/lib/env';
import { AppError } from '@/lib/supabase/app-error';

/**
 * hCaptcha tokens for the Supabase Auth calls that CAPTCHA protects when it is enabled on the
 * project (supabase/config.toml [auth.captcha]): signInWithOtp, signInWithPassword and signUp.
 * Token exchange (verifyOtp, signInWithIdToken, refresh) is not protected.
 *
 * Without EXPO_PUBLIC_HCAPTCHA_SITE_KEY the options are empty and auth behaves exactly as before.
 * With it, the mounted CaptchaHost registers the provider that shows the challenge; each call gets a
 * fresh single-use token.
 */
export type CaptchaTokenProvider = () => Promise<string>;

let provider: CaptchaTokenProvider | null = null;

/** Registers the token provider (CaptchaHost on mount). Returns an unregister function. */
export function setCaptchaTokenProvider(next: CaptchaTokenProvider): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function isCaptchaEnabled(siteKey: string | undefined = env.HCAPTCHA_SITE_KEY): boolean {
  return Boolean(siteKey);
}

/** Spread into a protected auth call's `options`: `{ captchaToken }`, or `{}` when CAPTCHA is off. */
export async function captchaOptions(
  siteKey: string | undefined = env.HCAPTCHA_SITE_KEY,
): Promise<{ captchaToken?: string }> {
  if (!isCaptchaEnabled(siteKey)) return {};
  if (!provider) throw new AppError('AUTH_CAPTCHA_FAILED', 'The security check is not ready.');
  return { captchaToken: await provider() };
}
