import { AppError } from '@/lib/supabase/app-error';

import {
  deleteProblem,
  deletionState,
  GRACE_DAYS,
  householdsToTransfer,
  isWithdrawable,
  needsReauth,
} from '../utils/privacy-rules';

const NOW = Date.parse('2026-10-06T12:00:00Z');

describe('privacy rules', () => {
  it('has a 30-day grace period', () => {
    expect(GRACE_DAYS).toBe(30);
  });

  it('asks for the email step-up only on UNAUTHENTICATED with details.reauth', () => {
    expect(needsReauth(new AppError('UNAUTHENTICATED', 'x', { details: { reauth: true } }))).toBe(
      true,
    );
    expect(needsReauth(new AppError('UNAUTHENTICATED', 'x'))).toBe(false);
    // S7: servers answer REAUTH_REQUIRED to clients that send the client-caps header.
    expect(needsReauth(new AppError('REAUTH_REQUIRED', 'x'))).toBe(true);
    expect(needsReauth(new Error('x'))).toBe(false);
  });

  it('maps deletion errors to calm states', () => {
    expect(deleteProblem(new AppError('UNAUTHENTICATED', 'x', { details: { reauth: true } }))).toBe(
      'reauth',
    );
    expect(deleteProblem(new AppError('ACCOUNT_DELETION_PENDING', 'x'))).toBe('already_pending');
    expect(deleteProblem(new AppError('OWNERSHIP_TRANSFER_REQUIRED', 'x'))).toBe(
      'transfer_ownership',
    );
    expect(
      deleteProblem(new AppError('CONFLICT', 'x', { details: { reason: 'in_progress' } })),
    ).toBe('in_progress');
    expect(
      deleteProblem(new AppError('CONFLICT', 'x', { details: { reason: 'not_pending' } })),
    ).toBe('not_pending');
    expect(deleteProblem(new AppError('INTERNAL', 'x'))).toBe('generic');
  });

  it('counts down the grace period and marks a due deletion as in progress', () => {
    expect(deletionState(null, NOW)).toEqual({
      pending: false,
      scheduledFor: null,
      daysLeft: null,
      inProgress: false,
    });
    const s = deletionState('2026-11-05T12:00:00Z', NOW);
    expect(s).toMatchObject({ pending: true, daysLeft: 30, inProgress: false });
    expect(deletionState('2026-10-06T11:00:00Z', NOW)).toMatchObject({
      daysLeft: 0,
      inProgress: true,
    });
  });

  it('lists households needing an ownership transfer', () => {
    const e = new AppError('OWNERSHIP_TRANSFER_REQUIRED', 'x', {
      details: { households: ['Home', { name: 'Grandma' }, 3] },
    });
    expect(householdsToTransfer(e)).toEqual(['Home', 'Grandma']);
    expect(householdsToTransfer(null)).toEqual([]);
  });

  it('only lets optional consents be withdrawn', () => {
    expect(isWithdrawable('marketing')).toBe(true);
    expect(isWithdrawable('child_data')).toBe(true);
    expect(isWithdrawable('terms')).toBe(false);
  });
});
