import type { ErrorCode } from '@shared/contracts';

/** Client-side codes for failures that never reached an Edge Function. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'NOT_CONFIGURED' | 'INVALID_RESPONSE';
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
