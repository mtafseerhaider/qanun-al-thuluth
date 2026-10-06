import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef } from 'react';

import type { ConsentKind } from '@shared';
import type { AccountDeleteReason } from '@shared/contracts';

import { clearAnalyticsQueue, track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useSessionStore } from '@/stores/use-session-store';

import {
  cancelAccountDeletion,
  fetchAccountState,
  fetchConsentRows,
  requestAccountDeletion,
  requestAccountExport,
  sendReauthCode,
  updateAnalyticsOptOut,
  verifyReauthCode,
  withdrawConsent,
  type ConsentRow,
} from '../api/privacy-api';

export function useAccountState() {
  const userId = useSessionStore((s) => s.userId);
  const setOptOut = usePreferencesStore((s) => s.setAnalyticsOptOut);
  const query = useQuery({
    queryKey: qk.account(),
    queryFn: () => fetchAccountState(userId as string),
    enabled: Boolean(userId) && isSupabaseConfigured,
  });
  // The server flag wins on a new device (FR-SET-07).
  useEffect(() => {
    if (query.data) setOptOut(query.data.analyticsOptOut);
  }, [query.data, setOptOut]);
  return query;
}

export function useSetAnalyticsOptOut() {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  const setOptOut = usePreferencesStore((s) => s.setAnalyticsOptOut);
  return useMutation({
    mutationKey: ['account', 'analytics-opt-out'],
    mutationFn: async (optOut: boolean) => {
      // Local first: nothing more is queued from this moment, even offline.
      setOptOut(optOut);
      if (optOut) clearAnalyticsQueue();
      if (userId) await updateAnalyticsOptOut(userId, optOut);
    },
    onSuccess: (_r, optOut) => {
      if (!optOut) track('setting_changed', { key: 'analytics' });
      void qc.invalidateQueries({ queryKey: qk.account() });
    },
  });
}

export function useConsentRows() {
  const userId = useSessionStore((s) => s.userId);
  return useQuery({
    queryKey: [...qk.consents(), 'rows'],
    queryFn: () => fetchConsentRows(userId as string),
    enabled: Boolean(userId) && isSupabaseConfigured,
  });
}

export function useWithdrawConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['consents', 'withdraw'],
    mutationFn: (row: ConsentRow) => withdrawConsent(row.id),
    onSuccess: (_r, row) => {
      track('consent_updated', { kind: row.kind as ConsentKind, granted: false });
      void qc.invalidateQueries({ queryKey: qk.consents() });
    },
  });
}

/** Step-up re-auth: send a code to the account email, then verify it (fresh `amr`, 5 minutes). */
export function useReauth() {
  const email = useSessionStore((s) => s.email);
  const send = useMutation({
    mutationKey: ['reauth', 'send'],
    mutationFn: () => sendReauthCode(email as string),
  });
  const verify = useMutation({
    mutationKey: ['reauth', 'verify'],
    mutationFn: (code: string) => verifyReauthCode(email as string, code.trim()),
  });
  return { email, send, verify };
}

/**
 * Account deletion request and cancel. One idempotency key per user intent: retrying after a
 * re-auth reuses it, so a response lost in transit never schedules twice.
 */
export function useAccountDeletion() {
  const qc = useQueryClient();
  const key = useRef<string | null>(null);
  const request = useMutation({
    mutationKey: ['account', 'delete'],
    mutationFn: (reason: AccountDeleteReason | null) => {
      key.current ??= Crypto.randomUUID();
      return requestAccountDeletion(reason, key.current);
    },
    onSuccess: () => {
      key.current = null;
      track('account_delete_requested', {});
      void qc.invalidateQueries({ queryKey: qk.account() });
    },
  });
  const cancel = useMutation({
    mutationKey: ['account', 'delete-cancel'],
    mutationFn: () => cancelAccountDeletion(Crypto.randomUUID()),
    onSuccess: () => {
      track('account_delete_cancelled', {});
      void qc.invalidateQueries({ queryKey: qk.account() });
    },
  });
  return { request, cancel };
}

export function useAccountExport() {
  const key = useRef<string | null>(null);
  return useMutation({
    mutationKey: ['account', 'export'],
    mutationFn: () => {
      key.current ??= Crypto.randomUUID();
      return requestAccountExport(key.current);
    },
    onSuccess: () => {
      key.current = null;
      track('account_export_requested', {});
    },
  });
}
