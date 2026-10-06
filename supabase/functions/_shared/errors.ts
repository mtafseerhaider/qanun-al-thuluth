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

/** Maps Postgres errors per 06 §2.3: `LIMIT_REACHED:` trigger prefix, 42501 RLS, 23505 unique. */
export function fromPostgrestError(err: { code?: string; message?: string }): HttpError {
  const message = err.message ?? 'Database error';
  if (message.startsWith('LIMIT_REACHED:'))
    return new HttpError('LIMIT_REACHED', message.slice(14).trim());
  // Under-18 guard trigger (S2-03): 'CHILD_RULE:weight_loss' | 'CHILD_RULE:weight_gain' | 'CHILD_RULE:kcal_target'.
  if (message.startsWith('CHILD_RULE:')) {
    return new HttpError('VALIDATION_FAILED', 'This goal is not available for members under 18.', {
      rule: message.slice(11).trim(),
    });
  }
  if (err.code === '42501') return new HttpError('FORBIDDEN', 'Not allowed');
  if (err.code === '23505') return new HttpError('CONFLICT', 'Already exists');
  return new HttpError('INTERNAL', 'Unexpected database error');
}
