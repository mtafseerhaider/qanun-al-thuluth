import { z } from 'zod';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Server truth for premium (17 §8): `get_my_entitlements(p_household)` returns the effective
 * premium for the caller in a household (own subscription or the owner's shared household premium),
 * the subscription status for the Subscription screen and `householdReadOnly` for downgrade.
 * Parsed leniently so a newer server field never breaks the client.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export const SUBSCRIPTION_STATUSES = [
  'active',
  'in_grace',
  'in_billing_retry',
  'cancelled',
  'expired',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const Entitlements = z.object({
  premium: z.boolean().catch(false),
  personalPremium: z.boolean().catch(false),
  householdPremium: z.boolean().catch(false),
  status: z.string().nullable().catch(null),
  periodType: z.string().nullable().optional().catch(null),
  currentPeriodEnd: z.string().nullable().catch(null),
  willRenew: z.boolean().nullable().catch(null),
  householdReadOnly: z.boolean().optional().catch(false),
});

export interface EntitlementsView {
  premium: boolean;
  personalPremium: boolean;
  householdPremium: boolean;
  status: SubscriptionStatus | null;
  trial: boolean;
  currentPeriodEnd: string | null;
  willRenew: boolean;
  householdReadOnly: boolean;
}

export function parseEntitlements(raw: unknown): EntitlementsView {
  const e = Entitlements.parse(raw ?? {});
  return {
    premium: e.premium,
    personalPremium: e.personalPremium,
    householdPremium: e.householdPremium,
    status: (SUBSCRIPTION_STATUSES as readonly string[]).includes(e.status ?? '')
      ? (e.status as SubscriptionStatus)
      : null,
    trial: e.periodType === 'trial',
    currentPeriodEnd: e.currentPeriodEnd,
    willRenew: e.willRenew ?? false,
    householdReadOnly: e.householdReadOnly ?? false,
  };
}

export async function fetchEntitlements(householdId: string | null): Promise<EntitlementsView> {
  const { data, error } = await client().rpc(
    'get_my_entitlements',
    householdId ? { p_household: householdId } : {},
  );
  if (error) throw toDbAppError(error);
  return parseEntitlements(data);
}

const SyncResponse = z.object({
  premium: z.boolean(),
  status: z.string().nullable(),
  current_period_end: z.string().nullable(),
  synced: z.boolean(),
});

/**
 * `POST /revenuecat-webhook/sync` (17 §7.5): asks the server to refetch the caller's RevenueCat
 * subscriber right after a purchase or restore, so premium lands without waiting for the webhook.
 * Limited to 6 an hour per user; best effort, so failures resolve to null.
 */
export async function syncEntitlement(): Promise<boolean | null> {
  try {
    const r = await invokeEdge('revenuecat-webhook/sync', {}, SyncResponse);
    return r.premium;
  } catch {
    return null;
  }
}
