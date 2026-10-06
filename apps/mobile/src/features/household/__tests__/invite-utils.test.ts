import { AppError } from '@/lib/supabase/app-error';

import { acceptOutcomeFor, daysUntil } from '../utils/invite-utils';

it('maps accept errors to AcceptInvite outcomes', () => {
  expect(acceptOutcomeFor(new AppError('ALREADY_MEMBER', 'x'))).toBe('already_member');
  expect(acceptOutcomeFor(new AppError('INVITE_EXPIRED', 'x'))).toBe('expired');
  expect(acceptOutcomeFor(new AppError('INVITE_INVALID', 'x'))).toBe('invalid');
  expect(acceptOutcomeFor(new AppError('INVITE_EMAIL_MISMATCH', 'x'))).toBe('email_mismatch');
  expect(acceptOutcomeFor(new Error('offline'))).toBe('error');
});

it('counts whole days until expiry', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  expect(daysUntil('2026-10-13T00:00:00Z', now)).toBe(7);
  expect(daysUntil('2026-10-06T01:00:00Z', now)).toBe(1);
  expect(daysUntil('2026-10-01T00:00:00Z', now)).toBe(0);
});
