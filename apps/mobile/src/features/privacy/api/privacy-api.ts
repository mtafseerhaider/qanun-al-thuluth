import {
  AccountDeleteResponse,
  AccountExportAccepted,
  type AccountDeleteReason,
} from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toAuthAppError, toDbAppError } from '@/lib/supabase/error-mapping';

function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface AccountState {
  deletionScheduledFor: string | null;
  deletionRequestedAt: string | null;
  analyticsOptOut: boolean;
}

export async function fetchAccountState(userId: string): Promise<AccountState> {
  const { data, error } = await client()
    .from('users')
    .select('deletion_scheduled_for, deletion_requested_at, analytics_opt_out')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return {
    deletionScheduledFor: data?.deletion_scheduled_for ?? null,
    deletionRequestedAt: data?.deletion_requested_at ?? null,
    analyticsOptOut: data?.analytics_opt_out ?? false,
  };
}

export async function updateAnalyticsOptOut(userId: string, optOut: boolean): Promise<void> {
  const { error } = await client()
    .from('users')
    .update({ analytics_opt_out: optOut })
    .eq('id', userId);
  if (error) throw toDbAppError(error);
}

export interface ConsentRow {
  id: string;
  kind: string;
  householdId: string | null;
  grantedAt: string;
}

export async function fetchConsentRows(userId: string): Promise<ConsentRow[]> {
  const { data, error } = await client()
    .from('consents')
    .select('id, kind, household_id, granted_at')
    .eq('user_id', userId)
    .is('withdrawn_at', null)
    .order('granted_at', { ascending: false });
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    householdId: r.household_id,
    grantedAt: r.granted_at,
  }));
}

export async function withdrawConsent(consentId: string): Promise<void> {
  const { error } = await client()
    .from('consents')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('id', consentId);
  if (error) throw toDbAppError(error);
}

/* --- Step-up re-auth (11 §15.1): a fresh email OTP for the signed-in user ---------------------- */

export async function sendReauthCode(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw toAuthAppError(error);
}

export async function verifyReauthCode(email: string, token: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw toAuthAppError(error);
}

/* --- Edge Functions ---------------------------------------------------------------------------- */

export function requestAccountDeletion(
  reason: AccountDeleteReason | null,
  idempotencyKey: string,
): Promise<AccountDeleteResponse> {
  return invokeEdge(
    'account-delete',
    { action: 'request', confirm: 'DELETE', immediate: false, ...(reason ? { reason } : {}) },
    AccountDeleteResponse,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export function cancelAccountDeletion(idempotencyKey: string): Promise<AccountDeleteResponse> {
  return invokeEdge('account-delete', { action: 'cancel' }, AccountDeleteResponse, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function requestAccountExport(idempotencyKey: string): Promise<AccountExportAccepted> {
  return invokeEdge('account-export', { include_pdfs: true }, AccountExportAccepted, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
