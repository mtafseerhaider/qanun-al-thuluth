import { TIER_LIMITS } from '@thuluth/shared';
import type { SubscriptionTier } from '@thuluth/shared';

import type { RouteKey } from '../types.ts';

/**
 * Free-tier chat goes to the cheapest model (`chat.free`) and premium to `chat.default`.
 * Default for open decision 1 in 00 §11 until the product owner revisits pricing after beta.
 */
export function chatRouteForTier(tier: SubscriptionTier): RouteKey {
  return tier === 'premium' ? 'chat.default' : 'chat.free';
}

export interface CapCheck {
  allowed: boolean;
  limit: number;
  remaining: number;
}

/** Daily chat message cap from 00 §8 (20 free, 200 premium fair use). */
export function checkDailyChatCap(tier: SubscriptionTier, usedToday: number): CapCheck {
  const limit = TIER_LIMITS[tier].chatMessagesPerDay;
  return { allowed: usedToday < limit, limit, remaining: Math.max(0, limit - usedToday) };
}
