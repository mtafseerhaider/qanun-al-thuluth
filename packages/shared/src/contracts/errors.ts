import { z } from 'zod';

/** Error codes from docs/06-api-specification.md §2.3. */
export const ErrorCode = z.enum([
  'UNAUTHENTICATED',
  /**
   * S7 addition: the session is valid but too old for a sensitive action (11 §15 step-up). Sent only
   * to clients that advertise `x-thuluth-client-caps: reauth_required`; older clients still receive
   * UNAUTHENTICATED with `details.reauth = true` (see REAUTH_CLIENT_CAP).
   */
  'REAUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'PREMIUM_REQUIRED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'LIMIT_REACHED',
  'CONSENT_REQUIRED',
  'UPGRADE_REQUIRED',
  'FEATURE_DISABLED',
  'SAFETY_ESCALATION',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_OUTPUT_INVALID',
  'UPSTREAM_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'PLAN_NOT_ADJUSTABLE',
  'PLAN_ALREADY_ACTIVE',
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'INVITE_EMAIL_MISMATCH',
  'ALREADY_MEMBER',
  'OWNERSHIP_TRANSFER_REQUIRED',
  'ACCOUNT_DELETION_PENDING',
  'PRAYER_TIMES_UNAVAILABLE',
  'GROWTH_REFERENCE_OUT_OF_RANGE',
  'EXPORT_KIND_UNSUPPORTED',
  'PROMO_INVALID',
  'PROMO_ALREADY_REDEEMED',
  'ACTIVE_STORE_SUBSCRIPTION',
  'WEBHOOK_UNAUTHORIZED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).default({}),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** HTTP status for each error code (06 §2.3 table). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PREMIUM_REQUIRED: 402,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  LIMIT_REACHED: 409,
  CONSENT_REQUIRED: 403,
  UPGRADE_REQUIRED: 426,
  FEATURE_DISABLED: 503,
  SAFETY_ESCALATION: 422,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_OUTPUT_INVALID: 502,
  UPSTREAM_UNAVAILABLE: 503,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PLAN_NOT_ADJUSTABLE: 409,
  PLAN_ALREADY_ACTIVE: 409,
  INVITE_INVALID: 400,
  INVITE_EXPIRED: 410,
  INVITE_EMAIL_MISMATCH: 403,
  ALREADY_MEMBER: 409,
  OWNERSHIP_TRANSFER_REQUIRED: 409,
  ACCOUNT_DELETION_PENDING: 409,
  PRAYER_TIMES_UNAVAILABLE: 503,
  GROWTH_REFERENCE_OUT_OF_RANGE: 422,
  EXPORT_KIND_UNSUPPORTED: 400,
  PROMO_INVALID: 400,
  PROMO_ALREADY_REDEEMED: 409,
  ACTIVE_STORE_SUBSCRIPTION: 409,
  WEBHOOK_UNAUTHORIZED: 401,
  INTERNAL: 500,
};

/** Request header a client sends to list optional protocol features it understands (comma separated). */
export const CLIENT_CAPS_HEADER = 'x-thuluth-client-caps';
/** Capability: the client handles `REAUTH_REQUIRED` (otherwise it gets UNAUTHENTICATED + details.reauth). */
export const REAUTH_CLIENT_CAP = 'reauth_required';
