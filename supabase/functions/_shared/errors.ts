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
    const text =
      key === 'fasting_under_7'
        ? 'Children under 7 do not fast; they can join the family at suhoor and iftar.'
        : 'This goal is not available for members under 18.';
    return new HttpError('VALIDATION_FAILED', text, { ...detail, rule });
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
    const detail = detailJson(err);
    // S5 downgrade (17 §6): a read-only household cannot start or reactivate a plan.
    if (detail.reason === 'household_read_only') {
      return new HttpError(
        'PREMIUM_REQUIRED',
        'This household is read-only on the free plan. Upgrade to make changes.',
        { feature: 'household.write', ...detail },
      );
    }
    return new HttpError('PREMIUM_REQUIRED', 'This plan option needs Premium.', {
      feature: 'plan.multi_week_or_kind',
      ...detail,
    });
  }
  // S6 growth_tracking guards: adults use weight_tracking; no measurement before birth.
  if (message.startsWith('GROWTH_RULE:')) {
    return new HttpError(
      'GROWTH_REFERENCE_OUT_OF_RANGE',
      'Growth charts cover children only. Use weight tracking for adults.',
      { ...detailJson(err), rule: message.slice(12).trim() },
    );
  }
  if (message === 'MEASUREMENT_BEFORE_BIRTH') {
    return new HttpError('VALIDATION_FAILED', 'The measurement date is before the date of birth.', {
      field: 'measured_on',
      rule: 'measured_before_birth',
    });
  }
  // S6 account rights RPCs (request/cancel/execute account deletion).
  if (message === 'ACCOUNT_DELETION_PENDING') {
    return new HttpError('ACCOUNT_DELETION_PENDING', 'Account deletion is already scheduled.', {
      ...detailJson(err),
    });
  }
  if (message === 'OWNERSHIP_TRANSFER_REQUIRED') {
    return new HttpError(
      'OWNERSHIP_TRANSFER_REQUIRED',
      'You own a household with other members. Transfer ownership or remove them first.',
      detailJson(err),
    );
  }
  if (message === 'ACCOUNT_DELETION_NOT_PENDING') {
    return new HttpError('CONFLICT', 'There is no account deletion to cancel.', {
      reason: 'not_pending',
    });
  }
  if (message === 'ACCOUNT_DELETION_IN_PROGRESS' || message === 'ACCOUNT_DELETION_NOT_DUE') {
    return new HttpError('CONFLICT', 'The account deletion can no longer be changed.', {
      ...detailJson(err),
      reason: message === 'ACCOUNT_DELETION_IN_PROGRESS' ? 'in_progress' : 'not_due',
    });
  }
  if (message === 'NOT_FOUND' && err.code === 'P0002') {
    return new HttpError('NOT_FOUND', 'Not found');
  }
  // S5 table guards raising a plain VALIDATION_FAILED (e.g. ramadan_plans foreign member keys).
  if (message === 'VALIDATION_FAILED') {
    return new HttpError('VALIDATION_FAILED', 'Some values are not valid.', detailJson(err));
  }
  if (err.code === '42501') return new HttpError('FORBIDDEN', 'Not allowed');
  if (err.code === '23505') return new HttpError('CONFLICT', 'Already exists');
  return new HttpError('INTERNAL', 'Unexpected database error');
}
