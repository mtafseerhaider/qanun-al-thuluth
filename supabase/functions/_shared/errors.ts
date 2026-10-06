import { ERROR_HTTP_STATUS } from '@thuluth/shared/contracts/errors.ts';
import type { ErrorCode } from '@thuluth/shared/contracts/errors.ts';

import { corsHeaders } from './cors.ts';

/** An error that becomes the 00 §4.2 envelope `{ error: { code, message, details } }`. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(
  err: HttpError,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    {
      error: {
        code: err.code,
        message: err.message,
        details: { ...err.details, request_id: requestId },
      },
    },
    {
      status: ERROR_HTTP_STATUS[err.code],
      headers: { ...corsHeaders, 'x-request-id': requestId, ...headers },
    },
  );
}

/** The fields of a PostgREST / Postgres error the mapper reads (`details` is the DETAIL text). */
export interface PgErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** RAISE ... DETAIL is JSON text for the guard triggers; anything else yields {}. */
function detailJson(err: PgErrorLike): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(err.details ?? '');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 06 §3.2 rule names for the under-18 guard, used when the DETAIL JSON is missing. */
const CHILD_RULES: Record<string, string> = {
  weight_loss: 'no_weight_loss_under_18',
  weight_gain: 'no_weight_gain_under_18',
  kcal_target: 'no_calorie_target_under_18',
};

/**
 * Maps Postgres errors per 06 §2.3 and §3.2:
 * - `LIMIT_REACHED:` trigger prefix -> LIMIT_REACHED
 * - `CHILD_RULE:<rule>` (S2-03 under-18 guard) -> VALIDATION_FAILED with `details.rule`
 * - `CONSENT_REQUIRED` / `CHILD_DATA_CONSENT_REQUIRED` (0022 consent guards) -> CONSENT_REQUIRED
 *   with `details.consents`
 * - `MODULE_NOT_APPLICABLE` (23514, pregnancy/breastfeeding goal on a child) -> VALIDATION_FAILED
 * - `PLAN_ALREADY_ACTIVE` / `PREMIUM_REQUIRED` (S3-02 plan entitlement trigger) -> same codes
 * - 42501 RLS -> FORBIDDEN, 23505 unique -> CONFLICT
 */
export function fromPostgrestError(err: PgErrorLike): HttpError {
  const message = err.message ?? 'Database error';
  if (message.startsWith('LIMIT_REACHED:'))
    return new HttpError('LIMIT_REACHED', message.slice(14).trim());
  if (message.startsWith('CHILD_RULE:')) {
    const key = message.slice(11).trim();
    const detail = detailJson(err);
    const rule = typeof detail.rule === 'string' ? detail.rule : (CHILD_RULES[key] ?? key);
    return new HttpError('VALIDATION_FAILED', 'This goal is not available for members under 18.', {
      ...detail,
      rule,
    });
  }
  if (message === 'CHILD_DATA_CONSENT_REQUIRED') {
    return new HttpError('CONSENT_REQUIRED', 'Consent for child data is needed first.', {
      consents: ['child_data'],
    });
  }
  if (message === 'CONSENT_REQUIRED') {
    const kind = detailJson(err).kind;
    return new HttpError('CONSENT_REQUIRED', 'Consent for health data is needed first.', {
      consents: [typeof kind === 'string' ? kind : 'health_data'],
    });
  }
  if (message === 'MODULE_NOT_APPLICABLE') {
    // DETAIL is the goal_type as plain text today; JSON keys are passed through if it changes.
    const detail = detailJson(err);
    const plain = !Object.keys(detail).length && err.details ? { goal_type: err.details } : {};
    return new HttpError('VALIDATION_FAILED', 'This goal does not apply to this family member.', {
      ...detail,
      ...plain,
      rule: 'module_not_applicable',
    });
  }
  // S3-02 plan entitlement trigger (detail JSON: resource, limit, current / reason, kind, week_count).
  if (message === 'PLAN_ALREADY_ACTIVE') {
    return new HttpError(
      'PLAN_ALREADY_ACTIVE',
      'The free plan allows one active meal plan. Upgrade or replace the current plan.',
      detailJson(err),
    );
  }
  if (message === 'PREMIUM_REQUIRED') {
    return new HttpError('PREMIUM_REQUIRED', 'This plan option needs Premium.', {
      feature: 'plan.multi_week_or_kind',
      ...detailJson(err),
    });
  }
  if (err.code === '42501') return new HttpError('FORBIDDEN', 'Not allowed');
  if (err.code === '23505') return new HttpError('CONFLICT', 'Already exists');
  return new HttpError('INTERNAL', 'Unexpected database error');
}
