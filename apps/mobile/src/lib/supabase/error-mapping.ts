import { AppError, isAppError, type AppErrorCode } from './app-error';

/**
 * Normalises supabase-js auth errors, PostgREST errors and fetch failures to AppError codes
 * (11 §16, 06 §2.3). Duck-typed so it never imports the SDK and is easy to test.
 */
interface ErrorLike {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
  details?: unknown;
}

const asLike = (e: unknown): ErrorLike => (typeof e === 'object' && e !== null ? e : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function isNetworkFailure(e: ErrorLike): boolean {
  const msg = str(e.message).toLowerCase();
  return (
    str(e.name) === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error')
  );
}

/** Maps `signInWithOtp`, `verifyOtp`, `signInWithIdToken` and `signInWithPassword` failures. */
export function toAuthAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const e = asLike(error);
  const code = str(e.code);
  const status = typeof e.status === 'number' ? e.status : null;
  const message = str(e.message) || 'Authentication failed.';
  const make = (c: AppErrorCode) => new AppError(c, message, { status });

  if (isNetworkFailure(e)) return make('AUTH_NETWORK');
  if (code === 'otp_expired') return make('AUTH_OTP_EXPIRED');
  if (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    code === 'too_many_requests'
  )
    return make('AUTH_RATE_LIMITED');
  if (code === 'invalid_credentials') return make('AUTH_INVALID_CREDENTIALS');
  if (code === 'email_address_invalid' || code === 'validation_failed')
    return make('AUTH_INVALID_EMAIL');
  if (code === 'otp_disabled' || code === 'invalid_otp' || status === 400 || status === 403)
    return make('AUTH_OTP_INVALID');
  return make('AUTH_PROVIDER_ERROR');
}

/** The tier trigger's DETAIL is JSON `{resource, limit, current}`; keep the numeric fields. */
function limitDetails(details: unknown): { limit?: number; current?: number } {
  if (typeof details !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { limit, current } = parsed as { limit?: unknown; current?: unknown };
    return {
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(typeof current === 'number' ? { current } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Maps PostgREST / Postgres errors. Tier triggers raise `LIMIT_REACHED:<resource>` (P0001) and the
 * child consent trigger raises `CHILD_DATA_CONSENT_REQUIRED` (05 §15, 11 §13.2).
 */
export function toDbAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const e = asLike(error);
  const code = str(e.code);
  const message = str(e.message) || 'Database request failed.';

  const limit = /^LIMIT_REACHED(?::([a-z_]+))?/.exec(message);
  if (limit)
    return new AppError('LIMIT_REACHED', message, {
      status: 409,
      details: { ...limitDetails(e.details), resource: limit[1] ?? 'unknown' },
    });
  if (message.startsWith('CHILD_DATA_CONSENT_REQUIRED'))
    return new AppError('CHILD_DATA_CONSENT_REQUIRED', message, { status: 403 });
  if (isNetworkFailure(e)) return new AppError('NETWORK_ERROR', message);
  // Plan RPCs (05 §22.12 activate_meal_plan, swap_daily_meal) raise these as P0001.
  if (message.startsWith('SWAP_NOT_ALLOWED'))
    return new AppError('VALIDATION_FAILED', message, { status: 400, details: { reason: 'swap' } });
  if (message.startsWith('CONFLICT')) return new AppError('CONFLICT', message, { status: 409 });
  if (code === '42501' || message.startsWith('FORBIDDEN'))
    return new AppError('FORBIDDEN', message, { status: 403 });
  if (code === '23505') return new AppError('CONFLICT', message, { status: 409 });
  if (code === 'P0002' || code === 'PGRST116')
    return new AppError('NOT_FOUND', message, { status: 404 });
  if (code === '23514' || code === '22P02' || code === '22007')
    return new AppError('VALIDATION_FAILED', message, { status: 400 });
  return new AppError('INTERNAL', message);
}

/** Codes that have their own copy in `errors:codes.*`; everything else falls back to UNKNOWN. */
const CODES_WITH_COPY = new Set<string>([
  'AUTH_INVALID_EMAIL',
  'AUTH_OTP_INVALID',
  'AUTH_OTP_EXPIRED',
  'AUTH_RATE_LIMITED',
  'AUTH_PLAY_SERVICES_UNAVAILABLE',
  'AUTH_PROVIDER_NO_TOKEN',
  'AUTH_PROVIDER_ERROR',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_NETWORK',
  'AUTH_SESSION_EXPIRED',
  'AUTH_PROFILE_MISSING',
  'NETWORK_ERROR',
  'NOT_CONFIGURED',
  'FORBIDDEN',
  'CONFLICT',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'LIMIT_REACHED',
  'CHILD_DATA_CONSENT_REQUIRED',
  'RATE_LIMITED',
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'INVITE_EMAIL_MISMATCH',
  'ALREADY_MEMBER',
  'UNAUTHENTICATED',
  'PREMIUM_REQUIRED',
  'QUOTA_EXCEEDED',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_OUTPUT_INVALID',
  'SAFETY_ESCALATION',
  'FEATURE_DISABLED',
  'PLAN_ALREADY_ACTIVE',
  'PLAN_NOT_ADJUSTABLE',
  // Sprint 6
  'ACCOUNT_DELETION_PENDING',
  'OWNERSHIP_TRANSFER_REQUIRED',
  'EXPORT_KIND_UNSUPPORTED',
  'GROWTH_REFERENCE_OUT_OF_RANGE',
  'CONSENT_REQUIRED',
  'UPSTREAM_UNAVAILABLE',
  'IDEMPOTENCY_IN_PROGRESS',
]);

/** i18n key (in the `errors` namespace) for any thrown value. */
export function errorKeyFor(error: unknown): `codes.${string}` {
  const code = isAppError(error) ? error.code : 'UNKNOWN';
  return `codes.${CODES_WITH_COPY.has(code) ? code : 'UNKNOWN'}`;
}

export function isLimitReached(error: unknown): boolean {
  return isAppError(error) && error.code === 'LIMIT_REACHED';
}
