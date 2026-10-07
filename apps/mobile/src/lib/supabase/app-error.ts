import type { ErrorCode } from '@shared/contracts';

/**
 * Client-side codes for failures that never reached an Edge Function, plus the auth codes from
 * 11 §16 and the database trigger codes surfaced through PostgREST (05 §15).
 */
export type ClientErrorCode =
  | 'NETWORK_ERROR'
  | 'NOT_CONFIGURED'
  | 'INVALID_RESPONSE'
  | 'AUTH_INVALID_EMAIL'
  | 'AUTH_OTP_INVALID'
  | 'AUTH_OTP_EXPIRED'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_CANCELLED'
  | 'AUTH_IN_PROGRESS'
  | 'AUTH_PLAY_SERVICES_UNAVAILABLE'
  | 'AUTH_PROVIDER_NO_TOKEN'
  | 'AUTH_PROVIDER_ERROR'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_NETWORK'
  | 'AUTH_SESSION_EXPIRED'
  | 'AUTH_PROFILE_MISSING'
  | 'AUTH_CAPTCHA_FAILED'
  | 'CHILD_DATA_CONSENT_REQUIRED'
  | 'UNKNOWN';
export type AppErrorCode = ErrorCode | ClientErrorCode;

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number | null;
  readonly details: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    opts: { status?: number | null; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? null;
    this.details = opts.details ?? {};
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
