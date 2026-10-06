import type { SubscriptionTier } from '../enums.ts';

/** Tier entitlements from docs/00-foundations.md §8, enforced server-side. */
export interface TierLimits {
  households: number;
  membersPerHousehold: number;
  chatMessagesPerDay: number;
}

export const FREE_LIMITS: TierLimits = {
  households: 1,
  membersPerHousehold: 6,
  chatMessagesPerDay: 20,
};

export const PREMIUM_LIMITS: TierLimits = {
  households: Number.POSITIVE_INFINITY,
  membersPerHousehold: 20,
  chatMessagesPerDay: 200,
};

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: FREE_LIMITS,
  premium: PREMIUM_LIMITS,
};
