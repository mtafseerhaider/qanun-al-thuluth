import { CLIENT_CAPS_HEADER, REAUTH_CLIENT_CAP } from '@thuluth/shared/contracts/errors.ts';

import { HttpError } from './errors.ts';

/** JWT `amr` entries: how and when the session was authenticated (11 §15.2). */
export type AuthMethodRef = { method: string; timestamp: number };

export interface AuthContext {
  userId: string;
  jwt: string;
  email?: string;
  amr?: AuthMethodRef[];
}

/** Verifies a JWT and returns its claims, or null when invalid. Real impl: `supabase.auth.getClaims`. */
export type ClaimsVerifier = (
  jwt: string,
) => Promise<{ sub: string; email?: string; amr?: AuthMethodRef[] } | null>;

export async function requireUser(req: Request, verify: ClaimsVerifier): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!jwt) throw new HttpError('UNAUTHENTICATED', 'Sign in to continue.');
  const claims = await verify(jwt).catch(() => null);
  if (!claims?.sub)
    throw new HttpError('UNAUTHENTICATED', 'Your session has expired. Sign in again.');
  return {
    userId: claims.sub,
    jwt,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.amr ? { amr: claims.amr } : {}),
  };
}

/** True when the request lists `cap` in `x-thuluth-client-caps` (comma separated, case-insensitive). */
export function clientHasCap(req: Request | undefined, cap: string): boolean {
  const raw = req?.headers.get(CLIENT_CAPS_HEADER) ?? '';
  return raw
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .includes(cap);
}

/**
 * Step-up re-auth for sensitive actions (11 §15): the newest `amr` timestamp must be at most
 * `maxAgeSec` old. Token refresh keeps `amr`, a fresh OTP or Apple/Google sign-in renews it.
 * Throws `REAUTH_REQUIRED` (401) for clients that send `x-thuluth-client-caps: reauth_required`
 * (S7), otherwise UNAUTHENTICATED; both carry `details.reauth = true` (06 §4.12), so older app
 * builds keep working. Pass `req` to enable the new code.
 */
export function assertRecentAuth(
  auth: AuthContext,
  maxAgeSec: number,
  now: Date = new Date(),
  req?: Request,
): void {
  const latest = Math.max(0, ...(auth.amr ?? []).map((a) => Number(a.timestamp) || 0));
  if (now.getTime() / 1000 - latest > maxAgeSec) {
    throw new HttpError(
      clientHasCap(req, REAUTH_CLIENT_CAP) ? 'REAUTH_REQUIRED' : 'UNAUTHENTICATED',
      'Please confirm it is you to continue.',
      { reauth: true, max_age_seconds: maxAgeSec },
    );
  }
}

/** Constant-time string comparison (length leaks only). */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Reads the internal secrets (current and, during rotation, next: 19 §8.1). */
export type InternalSecrets = () => string[];

export const internalSecretsFromEnv: InternalSecrets = () =>
  [Deno.env.get('INTERNAL_CRON_SECRET'), Deno.env.get('INTERNAL_CRON_SECRET_NEXT')].filter(
    (s): s is string => !!s && s.length >= 16,
  );

/**
 * Internal routes (workers, cron): the `x-internal-secret` header must match a configured secret.
 * With no secret configured every call is refused.
 */
export function requireInternal(req: Request, secrets: InternalSecrets): void {
  const given = req.headers.get('x-internal-secret') ?? '';
  const ok = given.length > 0 && secrets().some((s) => safeEqual(given, s));
  if (!ok) throw new HttpError('UNAUTHENTICATED', 'Not allowed');
}

/** RevenueCat webhook secrets (current and, during rotation, next). Short values are ignored. */
export const revenueCatSecretsFromEnv: InternalSecrets = () =>
  [
    Deno.env.get('REVENUECAT_WEBHOOK_SECRET'),
    Deno.env.get('REVENUECAT_WEBHOOK_SECRET_NEXT'),
  ].filter((s): s is string => !!s && s.length >= 16);

/**
 * `revenuecat-webhook` (06 §2.2, §4.14): `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`,
 * compared in constant time. With no secret configured every call is refused.
 */
export function requireRevenueCat(req: Request, secrets: InternalSecrets): void {
  const given = req.headers.get('authorization') ?? '';
  const ok = given.length > 0 && secrets().some((s) => safeEqual(given, `Bearer ${s}`));
  if (!ok) throw new HttpError('WEBHOOK_UNAUTHORIZED', 'Not allowed');
}
