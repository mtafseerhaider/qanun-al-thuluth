import { isAppError } from '@/lib/supabase/app-error';

/** Whole days until an ISO instant, at least 0 (02 §7.8.5 "expires in N days"). */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const ms = Date.parse(iso) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : 0;
}

/** Outcome of `household-invite` accept for the AcceptInvite screen (11 §12.4). */
export type AcceptOutcome =
  'joined' | 'already_member' | 'expired' | 'invalid' | 'email_mismatch' | 'error';

export function acceptOutcomeFor(error: unknown): AcceptOutcome {
  if (!isAppError(error)) return 'error';
  switch (error.code) {
    case 'ALREADY_MEMBER':
      return 'already_member';
    case 'INVITE_EXPIRED':
      return 'expired';
    case 'INVITE_INVALID':
    case 'NOT_FOUND':
    case 'CONFLICT':
      return 'invalid';
    case 'INVITE_EMAIL_MISMATCH':
      return 'email_mismatch';
    default:
      return 'error';
  }
}
