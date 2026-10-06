import type { StoreOffering, StorePackage } from '@/lib/purchases/purchases';
import type { PaywallTrigger } from '@/navigation/types';

import type { EntitlementsView, SubscriptionStatus } from '../api/entitlements-api';

/**
 * Paywall and gating rules (FR-SUB-01 to -06, 17 §5 and §10, 00 §8). Pure, so they are unit-tested.
 * Gating is UI-only: the server enforces every premium feature and answers `PREMIUM_REQUIRED`.
 */

/** Premium features the app gates in the UI (00 §8). Safety is never in this list (P1). */
export type PremiumFeature =
  'voice' | 'photo' | 'chat_memory' | 'ramadan_plan' | 'grocery_optimize' | 'plan_adjust';

export const FEATURE_TRIGGER: Record<PremiumFeature, PaywallTrigger> = {
  voice: 'voice',
  photo: 'photo',
  chat_memory: 'chat_quota',
  ramadan_plan: 'ramadan_plan',
  grocery_optimize: 'grocery_optimize',
  plan_adjust: 'plan_adjust',
};

export type GateDecision = 'allowed' | 'paywall' | 'disabled';

/**
 * `disabled` when the kill switch flag is off (no paywall for something nobody can use); `paywall`
 * for free users or when the server already said `PREMIUM_REQUIRED`; `allowed` otherwise.
 */
export function gate(input: {
  premium: boolean;
  flagEnabled?: boolean;
  serverSaidPremiumRequired?: boolean;
}): GateDecision {
  if (input.flagEnabled === false) return 'disabled';
  if (input.serverSaidPremiumRequired || !input.premium) return 'paywall';
  return 'allowed';
}

/**
 * Effective premium for UI (17 §6): server truth, or the client entitlement for up to 10 minutes
 * after a purchase while the webhook lands.
 */
export const OPTIMISTIC_WINDOW_MS = 10 * 60_000;
export function effectivePremium(input: {
  server: boolean | null;
  clientPremium: boolean;
  purchasedAt: number | null;
  now: number;
}): boolean {
  const optimistic =
    input.clientPremium &&
    input.purchasedAt !== null &&
    input.now - input.purchasedAt < OPTIMISTIC_WINDOW_MS;
  if (input.server === null) return input.clientPremium;
  return input.server || optimistic;
}

/** Annual first (preselected), then monthly; other packages are not shown (17 §2.3). */
export function paywallPackages(offering: StoreOffering | null): {
  annual: StorePackage | null;
  monthly: StorePackage | null;
} {
  const pkgs = offering?.packages ?? [];
  return {
    annual: pkgs.find((p) => p.period === 'annual') ?? null,
    monthly: pkgs.find((p) => p.period === 'monthly') ?? null,
  };
}

/**
 * Saving of annual vs twelve months of monthly, from the two store prices (never hardcoded,
 * 02 §7.13.3). Null when either is missing, currencies differ or there is no saving.
 */
export function annualSavingPercent(
  annual: Pick<StorePackage, 'price' | 'currencyCode'> | null,
  monthly: Pick<StorePackage, 'price' | 'currencyCode'> | null,
): number | null {
  if (!annual || !monthly || annual.currencyCode !== monthly.currencyCode) return null;
  const yearly = monthly.price * 12;
  if (!(yearly > 0) || annual.price >= yearly) return null;
  return Math.round(((yearly - annual.price) / yearly) * 100);
}

/** Per-month equivalent of the annual price, formatted with the store currency. */
export function perMonth(
  annual: Pick<StorePackage, 'price' | 'currencyCode' | 'pricePerMonthString'>,
  locale: string,
): string {
  if (annual.pricePerMonthString) return annual.pricePerMonthString;
  try {
    return new Intl.NumberFormat(locale.startsWith('ur') ? 'en-PK' : locale, {
      style: 'currency',
      currency: annual.currencyCode,
      maximumFractionDigits: 0,
    }).format(annual.price / 12);
  } catch {
    return `${annual.currencyCode} ${Math.round(annual.price / 12)}`;
  }
}

/** Rows of the free vs premium comparison table (00 §8, FR-SUB-03): copy keys under `paywall.compare`. */
export const COMPARISON_ROWS = [
  'households',
  'members',
  'plans',
  'chat',
  'grocery',
  'tracking',
  'growth',
  'autism',
  'picky',
  'ramadan',
  'exports',
] as const;
export type ComparisonRow = (typeof COMPARISON_ROWS)[number];

/** The trigger's own benefit is listed first (17 §5.2 "contextual hero"). */
export const BENEFITS = [
  'planning',
  'chat',
  'growth',
  'programs',
  'ramadan',
  'grocery',
  'exports',
] as const;
export type Benefit = (typeof BENEFITS)[number];
const TRIGGER_BENEFIT: Partial<Record<PaywallTrigger, Benefit>> = {
  chat_quota: 'chat',
  voice: 'chat',
  photo: 'chat',
  ramadan_plan: 'ramadan',
  grocery_optimize: 'grocery',
  plan_adjust: 'planning',
  plan_multi_week: 'planning',
  growth_chart: 'growth',
  exposure_ladder: 'programs',
  sensory_profile: 'programs',
  picky_coaching: 'programs',
  export: 'exports',
};
export function benefitsFor(trigger: PaywallTrigger): Benefit[] {
  const first = TRIGGER_BENEFIT[trigger];
  const rest = BENEFITS.filter((b) => b !== first);
  return (first ? [first, ...rest] : rest).slice(0, 5);
}

/** Headline copy key for a trigger (`subscription:paywall.headline.*`). */
export function headlineKey(trigger: PaywallTrigger): string {
  switch (trigger) {
    case 'photo':
    case 'voice':
    case 'chat_quota':
    case 'ramadan_plan':
    case 'grocery_optimize':
    case 'plan_adjust':
      return `paywall.headline.${trigger}`;
    default:
      return 'paywall.headline.default';
  }
}

/** Plain-language status (02 §7.13.3); `subscription:status.*`. */
export function statusKey(status: SubscriptionStatus | null, premium: boolean): string {
  if (!status) return premium ? 'status.shared' : 'status.free';
  return `status.${status}`;
}

export type DowngradeNotice = 'billing_issue' | 'ends_soon' | 'expired_read_only' | null;

/**
 * Downgrade read-only states (FR-SUB-06, 17 §10): data is never deleted. In grace: a payment banner.
 * Cancelled: ends on the period end. Expired with premium data: premium areas become read-only.
 */
export function downgradeNotice(e: EntitlementsView | null | undefined): DowngradeNotice {
  if (!e) return null;
  if (e.status === 'in_grace' || e.status === 'in_billing_retry') return 'billing_issue';
  if (e.status === 'cancelled' && e.premium) return 'ends_soon';
  if (!e.premium && (e.status === 'expired' || e.householdReadOnly)) return 'expired_read_only';
  return null;
}

/** Whether a premium area renders read-only: it has data from before but premium is gone. */
export function isReadOnlyPremiumArea(premium: boolean, hasExistingData: boolean): boolean {
  return !premium && hasExistingData;
}
