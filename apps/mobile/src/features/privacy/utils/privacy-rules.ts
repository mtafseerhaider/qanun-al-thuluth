import { ACCOUNT_DELETION_GRACE_DAYS } from '@shared/contracts';

import { isAppError } from '@/lib/supabase/app-error';

/**
 * Privacy and account deletion rules (FR-SET-05 to -07, 16 §7.4 to §7.5, 11 §15). Pure and tested.
 */

/** account-delete and account-export answer UNAUTHENTICATED + details.reauth when the sign-in is stale. */
export function needsReauth(error: unknown): boolean {
  if (!isAppError(error) || error.code !== 'UNAUTHENTICATED') return false;
  const details = (error.details ?? {}) as Record<string, unknown>;
  return details.reauth === true;
}

export interface DeletionState {
  pending: boolean;
  scheduledFor: string | null;
  daysLeft: number | null;
  /** Past the scheduled time: deletion is running and can no longer be cancelled. */
  inProgress: boolean;
}

export function deletionState(scheduledFor: string | null, now: number): DeletionState {
  if (!scheduledFor)
    return { pending: false, scheduledFor: null, daysLeft: null, inProgress: false };
  const ms = Date.parse(scheduledFor) - now;
  return {
    pending: true,
    scheduledFor,
    daysLeft: Math.max(0, Math.ceil(ms / 864e5)),
    inProgress: ms <= 0,
  };
}

export const GRACE_DAYS = ACCOUNT_DELETION_GRACE_DAYS;

export type DeleteProblem =
  'reauth' | 'already_pending' | 'transfer_ownership' | 'in_progress' | 'not_pending' | 'generic';

export function deleteProblem(error: unknown): DeleteProblem {
  if (needsReauth(error)) return 'reauth';
  if (!isAppError(error)) return 'generic';
  const details = (error.details ?? {}) as Record<string, unknown>;
  if (error.code === 'ACCOUNT_DELETION_PENDING') return 'already_pending';
  if (error.code === 'OWNERSHIP_TRANSFER_REQUIRED') return 'transfer_ownership';
  if (error.code === 'CONFLICT' && details.reason === 'in_progress') return 'in_progress';
  if (error.code === 'CONFLICT' && details.reason === 'not_pending') return 'not_pending';
  return 'generic';
}

/** Households named in OWNERSHIP_TRANSFER_REQUIRED (details.households), when present. */
export function householdsToTransfer(error: unknown): string[] {
  if (!isAppError(error)) return [];
  const list = ((error.details ?? {}) as Record<string, unknown>).households;
  if (!Array.isArray(list)) return [];
  return list.flatMap((h: unknown) => {
    if (typeof h === 'string') return [h];
    if (h && typeof h === 'object' && typeof (h as { name?: unknown }).name === 'string')
      return [(h as { name: string }).name];
    return [];
  });
}

/** Consents that can be withdrawn here; terms and privacy end with deleting the account. */
export const WITHDRAWABLE = ['marketing', 'ai_processing', 'health_data', 'child_data'] as const;
export type WithdrawableConsent = (typeof WITHDRAWABLE)[number];

export function isWithdrawable(kind: string): kind is WithdrawableConsent {
  return (WITHDRAWABLE as readonly string[]).includes(kind);
}
