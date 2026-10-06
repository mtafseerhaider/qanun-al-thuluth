import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback } from 'react';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import {
  getCurrentOffering,
  isPurchasesAvailable,
  purchase,
  restore,
  type StorePackage,
} from '@/lib/purchases/purchases';
import { qk } from '@/lib/query/query-keys';
import type { PaywallTrigger } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';
import { useSubscriptionStore } from '@/stores/use-subscription-store';

import { fetchEntitlements, syncEntitlement } from '../api/entitlements-api';
import { effectivePremium } from '../utils/paywall-rules';

/** Server entitlements in the active (or given) household context, 60 s fresh (17 §6). */
export function useEntitlements(householdId?: string | null) {
  const active = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const userId = useSessionStore((s) => s.userId);
  const hid = householdId === undefined ? active : householdId;
  return useQuery({
    queryKey: qk.entitlements(hid),
    queryFn: () => fetchEntitlements(hid),
    enabled: Boolean(userId) && isSupabaseConfigured,
    staleTime: 60_000,
  });
}

/**
 * Effective premium for UI gating: server truth, or the RevenueCat entitlement while the webhook
 * lands. Never a security boundary (FR-SUB-05).
 */
export function usePremium(householdId?: string | null): {
  premium: boolean;
  loading: boolean;
} {
  const ent = useEntitlements(householdId);
  const clientPremium = useSubscriptionStore((s) => s.clientPremium);
  const purchasedAt = useSubscriptionStore((s) => s.purchasedAt);
  return {
    premium: effectivePremium({
      server: ent.data ? ent.data.premium : null,
      clientPremium,
      purchasedAt,
      now: Date.now(),
    }),
    loading: ent.isLoading,
  };
}

/**
 * Opens the paywall for a trigger, holding `intent` (for example "send this photo") so it runs
 * after a purchase (02 §5.11). Already premium: runs the intent at once.
 */
export function usePaywall() {
  const navigation = useNavigation();
  const setPendingIntent = useSubscriptionStore((s) => s.setPendingIntent);
  return useCallback(
    (trigger: PaywallTrigger, intent?: () => void) => {
      setPendingIntent(intent ? { id: Crypto.randomUUID(), run: intent } : null);
      track('upsell_tapped', { trigger });
      navigation.navigate('PaywallModal', { trigger });
    },
    [navigation, setPendingIntent],
  );
}

export function useOffering() {
  const userId = useSessionStore((s) => s.userId);
  return useQuery({
    queryKey: qk.offering(),
    queryFn: getCurrentOffering,
    enabled: Boolean(userId) && isPurchasesAvailable(),
    staleTime: 5 * 60_000,
    meta: { persist: false },
  });
}

/** Polls server truth for up to 10 s after a purchase (02 §5.11) and reports whether it landed. */
async function waitForServerPremium(
  refetch: () => Promise<{ data?: { premium: boolean } | undefined }>,
  attempts = 5,
  delayMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const r = await refetch();
    if (r.data?.premium) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export function usePurchase(trigger: PaywallTrigger) {
  const qc = useQueryClient();
  const ent = useEntitlements();
  const markPurchased = useSubscriptionStore((s) => s.markPurchased);
  return useMutation({
    mutationKey: ['subscription', 'purchase'],
    networkMode: 'online',
    mutationFn: async (pkg: StorePackage) => {
      const period = pkg.period === 'monthly' ? 'monthly' : 'annual';
      track('purchase_started', { period });
      const outcome = await purchase(pkg.identifier);
      if (outcome.kind === 'purchased') {
        if (outcome.active) markPurchased();
        track('purchase_completed', { period, trigger, pending: !outcome.active });
        await qc.invalidateQueries({ queryKey: qk.me() });
        if (outcome.active) {
          await syncEntitlement();
          await waitForServerPremium(() => ent.refetch());
        }
      } else if (outcome.kind === 'pending') {
        track('purchase_completed', { period, trigger, pending: true });
      } else if (outcome.kind === 'failed') {
        track('purchase_failed', { code: outcome.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_') });
      }
      return outcome;
    },
  });
}

export function useRestorePurchases() {
  const qc = useQueryClient();
  const markPurchased = useSubscriptionStore((s) => s.markPurchased);
  return useMutation({
    mutationKey: ['subscription', 'restore'],
    networkMode: 'online',
    mutationFn: async () => {
      const r = await restore();
      if (r.active) {
        markPurchased();
        await syncEntitlement();
      }
      track('purchase_restored', { had_entitlement: r.active });
      await qc.invalidateQueries({ queryKey: qk.me() });
      return r;
    },
  });
}
