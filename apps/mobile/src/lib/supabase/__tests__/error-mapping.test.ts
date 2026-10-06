import { AppError } from '../app-error';
import { errorKeyFor, isLimitReached, toAuthAppError, toDbAppError } from '../error-mapping';

describe('toDbAppError', () => {
  it('maps the tier trigger to LIMIT_REACHED with the resource and numbers', () => {
    const e = toDbAppError({
      code: 'P0001',
      message: 'LIMIT_REACHED:family_members',
      details: '{"resource":"family_members","limit":6,"current":6}',
    });
    expect(e.code).toBe('LIMIT_REACHED');
    expect(e.details).toEqual({ resource: 'family_members', limit: 6, current: 6 });
    expect(isLimitReached(e)).toBe(true);
    expect(errorKeyFor(e)).toBe('codes.LIMIT_REACHED');
  });

  it.each([
    [{ code: '42501', message: 'permission denied' }, 'FORBIDDEN'],
    [{ code: '23505', message: 'duplicate key' }, 'CONFLICT'],
    [{ code: 'PGRST116', message: 'no rows' }, 'NOT_FOUND'],
    [{ code: '23514', message: 'check violation' }, 'VALIDATION_FAILED'],
    [{ message: 'Network request failed' }, 'NETWORK_ERROR'],
    [{ code: 'P0001', message: 'CHILD_DATA_CONSENT_REQUIRED' }, 'CHILD_DATA_CONSENT_REQUIRED'],
    [{ code: 'XX000', message: 'boom' }, 'INTERNAL'],
  ])('maps %o to %s', (input, code) => {
    expect(toDbAppError(input).code).toBe(code);
  });
});

describe('toAuthAppError', () => {
  it.each([
    [{ code: 'otp_expired', status: 403 }, 'AUTH_OTP_EXPIRED'],
    [{ code: 'over_email_send_rate_limit', status: 429 }, 'AUTH_RATE_LIMITED'],
    [{ code: 'invalid_credentials', status: 400 }, 'AUTH_INVALID_CREDENTIALS'],
    [{ code: 'email_address_invalid', status: 400 }, 'AUTH_INVALID_EMAIL'],
    [{ status: 403, message: 'Token has expired or is invalid' }, 'AUTH_OTP_INVALID'],
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, 'AUTH_NETWORK'],
  ])('maps %o to %s', (input, code) => {
    expect(toAuthAppError(input).code).toBe(code);
  });
});

it('falls back to UNKNOWN copy for codes without their own message', () => {
  expect(errorKeyFor(new Error('x'))).toBe('codes.UNKNOWN');
  expect(errorKeyFor(new AppError('INTERNAL', 'x'))).toBe('codes.UNKNOWN');
});
