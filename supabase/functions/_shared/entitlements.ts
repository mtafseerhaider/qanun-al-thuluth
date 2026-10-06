import type { SupabaseClient } from '@supabase/supabase-js';

import { HttpError } from './errors.ts';
import { check } from './platform.ts';

/**
 * Server-side entitlement checks for every gated Edge Function (17 §8-10, 06 §2.7, FR-SUB-05,
 * FR-SUB-06, FR-HH-06). The client's premium state is never trusted: tiers come from the SQL
 * functions `has_premium(p_user_id)` and `household_has_premium(p_household_id)`.
 *
 * Scopes (which entitlement a feature follows):
 * - `household`: household-scoped content (plans, adjustments, grocery lists, Ramadan plans)
 *   follows the household owner's entitlement, shared with every member (FR-HH-06). This matches
 *   the database triggers (`enforce_plan_entitlement`, member limits), which also use
 *   `household_has_premium`, so a function never accepts what the database would refuse.
 * - `personal`: the caller's own entitlement only. AI chat quotas (FR-HH-06: "Personal AI chat
 *   quota follows the chatting user's own entitlement only").
 * - `household_or_personal`: `premium_for(household)` in 17 §8: the caller's own premium, or the
 *   premium of a household they belong to (meal photo analysis, voice transcription).
 *   The caller must already have verified membership of `householdId`.
 *
 * `premium_for` and `get_my_entitlements` read `auth.uid()`, which is null for the service-role
 * client the functions use, so this module calls their building blocks (`has_premium`,
 * `household_has_premium`, `household_is_read_only`) with the verified user id instead of
 * re-deriving anything from `subscriptions`.
 */

export type Tier = 'free' | 'premium';
export type PremiumScope = 'household' | 'personal' | 'household_or_personal';

export interface Entitlement {
  tier: Tier;
  premium: boolean;
  /** Where premium came from; null for free. */
  source: 'personal' | 'household' | null;
}

export interface EntitlementStore {
  /** `has_premium(p_user_id)`. */
  userPremium(userId: string): Promise<boolean>;
  /** `household_has_premium(p_household_id)`: the owner's entitlement. */
  householdPremium(householdId: string): Promise<boolean>;
  /**
   * `household_is_read_only(p_household_id)` (17 §10.3, FR-SUB-06): a free owner's extra
   * households are read-only for new plans; the owner keeps one (`keep_household_on_downgrade`,
   * else the oldest live household).
   */
  householdReadOnly(householdId: string): Promise<boolean>;
}

const FREE: Entitlement = { tier: 'free', premium: false, source: null };
const PREMIUM = (source: 'personal' | 'household'): Entitlement => ({
  tier: 'premium',
  premium: true,
  source,
});

/** The caller's tier for a feature of the given scope. */
export async function resolveEntitlement(
  store: Pick<EntitlementStore, 'userPremium' | 'householdPremium'>,
  args: { userId: string; householdId?: string | null; scope: PremiumScope },
): Promise<Entitlement> {
  if (args.scope === 'personal') {
    return (await store.userPremium(args.userId)) ? PREMIUM('personal') : FREE;
  }
  if (args.scope === 'household') {
    if (!args.householdId) throw new Error('household scope needs a householdId');
    return (await store.householdPremium(args.householdId)) ? PREMIUM('household') : FREE;
  }
  if (await store.userPremium(args.userId)) return PREMIUM('personal');
  if (args.householdId && (await store.householdPremium(args.householdId)))
    return PREMIUM('household');
  return FREE;
}

/** Throws `PREMIUM_REQUIRED` (402, `details.feature`) unless the entitlement is premium. */
export function requirePremium(
  ent: Entitlement,
  feature: string,
  message = 'This feature needs Premium.',
): void {
  if (!ent.premium) throw new HttpError('PREMIUM_REQUIRED', message, { feature });
}

/** 06 §2.7 daily quotas and burst limits per function and tier; 0 = not available on that tier. */
export const TIER_LIMITS = {
  'ai-chat': { daily: { free: 20, premium: 200 }, perMinute: { free: 6, premium: 20 } },
  'ai-intake-assess': { daily: { free: 5, premium: 10 }, perMinute: { free: 2, premium: 2 } },
  'ai-generate-plan': { daily: { free: 3, premium: 10 }, perMinute: { free: 1, premium: 1 } },
  'ai-adjust-plan': { daily: { free: 0, premium: 20 }, perMinute: { free: 0, premium: 3 } },
  'ai-analyze-meal': { daily: { free: 0, premium: 30 }, perMinute: { free: 0, premium: 5 } },
  'ai-transcribe': { daily: { free: 0, premium: 60 }, perMinute: { free: 0, premium: 10 } },
  'grocery-generate': { daily: { free: 10, premium: 30 }, perMinute: { free: 3, premium: 3 } },
  'ramadan-generate': { daily: { free: 0, premium: 5 }, perMinute: { free: 0, premium: 1 } },
  'growth-compute': { daily: { free: 60, premium: 60 }, perMinute: { free: 10, premium: 10 } },
  'export-pdf': { daily: { free: 0, premium: 30 }, perMinute: { free: 0, premium: 5 } },
  'account-export': { daily: { free: 2, premium: 2 }, perMinute: { free: 1, premium: 1 } },
  'account-delete': { daily: { free: 5, premium: 5 }, perMinute: { free: 2, premium: 2 } },
} as const;
export type GatedFunction = keyof typeof TIER_LIMITS;

export function limitsFor(fn: GatedFunction, tier: Tier): { daily: number; perMinute: number } {
  const l = TIER_LIMITS[fn];
  return { daily: l.daily[tier], perMinute: l.perMinute[tier] };
}

export interface RateLimiter {
  consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; reset_at: string }>;
}

/**
 * Consumes the burst (per minute) and daily buckets for `fn` at `tier` with `consume_rate_limit`.
 * Throws `PREMIUM_REQUIRED` when the tier has no allowance, `RATE_LIMITED` or `QUOTA_EXCEEDED`
 * otherwise; returns the 06 §2.7 response headers. Key format: `${fn}:${userId}:min|day`.
 */
export async function consumeTierQuota(
  limiter: RateLimiter,
  fn: GatedFunction,
  userId: string,
  tier: Tier,
): Promise<Record<string, string>> {
  const { daily, perMinute } = limitsFor(fn, tier);
  if (daily === 0 || perMinute === 0) {
    throw new HttpError('PREMIUM_REQUIRED', 'This feature needs Premium.', { feature: fn });
  }
  const burst = await limiter.consumeRateLimit(`${fn}:${userId}:min`, perMinute, 60);
  if (!burst.allowed) {
    throw new HttpError('RATE_LIMITED', 'Please wait a minute and try again.', {
      reset_at: burst.reset_at,
    });
  }
  const day = await limiter.consumeRateLimit(`${fn}:${userId}:day`, daily, 86_400);
  if (!day.allowed) {
    throw new HttpError('QUOTA_EXCEEDED', 'You have reached today’s limit for this feature.', {
      limit: daily,
      reset_at: day.reset_at,
    });
  }
  return {
    'ratelimit-limit': String(perMinute),
    'ratelimit-remaining': String(burst.remaining),
    'x-quota-limit': String(daily),
    'x-quota-remaining': String(day.remaining),
  };
}

// ---- downgrade rules (17 §10.3, FR-SUB-06): data is kept, extra capacity becomes read-only ------

/** Free households allow 6 members in new plans; premium 20 (00 §8). */
export const FREE_PLAN_MEMBER_LIMIT = 6;

/**
 * Throws `PREMIUM_REQUIRED` (`details.reason = 'household_read_only'`, as the plan entitlement
 * trigger does) when a free owner's extra household gets a new plan or list. Data stays readable
 * and safety logging stays allowed.
 */
export async function assertHouseholdWritable(
  store: Pick<EntitlementStore, 'householdReadOnly'>,
  householdId: string,
  ent: Entitlement,
  feature: string,
): Promise<void> {
  if (ent.premium || !(await store.householdReadOnly(householdId))) return;
  throw new HttpError(
    'PREMIUM_REQUIRED',
    'This household is read-only on the free plan. Choose it as your active household or upgrade to keep planning here.',
    { feature, reason: 'household_read_only' },
  );
}

/**
 * Members who may receive new plans: all on premium; on free the first 6 in household order
 * (`family_members.sort_order`), the rest stay visible but are excluded until upgrade (17 §10.3).
 */
export function planEligibleMembers<T>(
  members: readonly T[],
  ent: Entitlement,
): { eligible: T[]; excluded: T[] } {
  if (ent.premium || members.length <= FREE_PLAN_MEMBER_LIMIT)
    return { eligible: [...members], excluded: [] };
  return {
    eligible: members.slice(0, FREE_PLAN_MEMBER_LIMIT),
    excluded: members.slice(FREE_PLAN_MEMBER_LIMIT),
  };
}

// ---- Supabase implementation --------------------------------------------------------------------

export function supabaseEntitlementStore(admin: SupabaseClient): EntitlementStore {
  return {
    async userPremium(userId) {
      return check(await admin.rpc('has_premium', { p_user_id: userId })) === true;
    },
    async householdPremium(householdId) {
      return (
        check(await admin.rpc('household_has_premium', { p_household_id: householdId })) === true
      );
    },
    async householdReadOnly(householdId) {
      return (
        check(await admin.rpc('household_is_read_only', { p_household_id: householdId })) === true
      );
    },
  };
}
