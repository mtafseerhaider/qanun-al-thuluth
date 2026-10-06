import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import {
  assertHouseholdWritable,
  consumeTierQuota,
  FREE_PLAN_MEMBER_LIMIT,
  limitsFor,
  planEligibleMembers,
  requirePremium,
  resolveEntitlement,
  TIER_LIMITS,
} from '../../functions/_shared/entitlements.ts';
import type {
  Entitlement,
  EntitlementStore,
  RateLimiter,
} from '../../functions/_shared/entitlements.ts';
import { HttpError } from '../../functions/_shared/errors.ts';

const USER = 'u-1';
const HH = 'h-1';

function store(opts: { user?: boolean; household?: boolean; readOnly?: boolean } = {}) {
  const calls: string[] = [];
  const s: EntitlementStore = {
    userPremium: async (id) => {
      calls.push(`user:${id}`);
      return opts.user ?? false;
    },
    householdPremium: async (id) => {
      calls.push(`household:${id}`);
      return opts.household ?? false;
    },
    householdReadOnly: async (id) => {
      calls.push(`readOnly:${id}`);
      return opts.readOnly ?? false;
    },
  };
  return { s, calls };
}

const FREE: Entitlement = { tier: 'free', premium: false, source: null };
const PREMIUM: Entitlement = { tier: 'premium', premium: true, source: 'household' };

Deno.test('household scope follows the owner (household_has_premium) only', async () => {
  // A personal subscriber in a free household gets the free household tier (FR-HH-06).
  const personalOnly = store({ user: true });
  assertEquals(
    await resolveEntitlement(personalOnly.s, { userId: USER, householdId: HH, scope: 'household' }),
    FREE,
  );
  assertEquals(personalOnly.calls, [`household:${HH}`]);
  const shared = store({ household: true });
  assertEquals(
    await resolveEntitlement(shared.s, { userId: USER, householdId: HH, scope: 'household' }),
    { tier: 'premium', premium: true, source: 'household' },
  );
  await assertRejects(() =>
    resolveEntitlement(shared.s, { userId: USER, householdId: null, scope: 'household' }),
  );
});

Deno.test('personal scope ignores a premium household (AI chat quota)', async () => {
  const { s } = store({ household: true });
  assertEquals(
    await resolveEntitlement(s, { userId: USER, householdId: HH, scope: 'personal' }),
    FREE,
  );
  const own = store({ user: true });
  assertEquals(
    (await resolveEntitlement(own.s, { userId: USER, scope: 'personal' })).source,
    'personal',
  );
});

Deno.test('household_or_personal: own premium first, then the household', async () => {
  const both = store({ user: true, household: true });
  assertEquals(
    (
      await resolveEntitlement(both.s, {
        userId: USER,
        householdId: HH,
        scope: 'household_or_personal',
      })
    ).source,
    'personal',
  );
  const hh = store({ household: true });
  assertEquals(
    (
      await resolveEntitlement(hh.s, {
        userId: USER,
        householdId: HH,
        scope: 'household_or_personal',
      })
    ).source,
    'household',
  );
  const none = store();
  assertEquals(
    await resolveEntitlement(none.s, { userId: USER, scope: 'household_or_personal' }),
    FREE,
  );
});

Deno.test('requirePremium throws PREMIUM_REQUIRED with the feature', () => {
  requirePremium(PREMIUM, 'x');
  try {
    requirePremium(FREE, 'ramadan.plan');
    throw new Error('expected a throw');
  } catch (e) {
    assertEquals((e as HttpError).code, 'PREMIUM_REQUIRED');
    assertEquals((e as HttpError).details.feature, 'ramadan.plan');
  }
});

function limiter(deny: 'min' | 'day' | null = null) {
  const keys: Array<[string, number, number]> = [];
  const l: RateLimiter = {
    consumeRateLimit: async (key, limit, window) => {
      keys.push([key, limit, window]);
      const denied = deny !== null && key.endsWith(`:${deny}`);
      return {
        allowed: !denied,
        remaining: denied ? 0 : limit - 1,
        reset_at: '2026-10-07T00:00:00Z',
      };
    },
  };
  return { l, keys };
}

Deno.test('consumeTierQuota: tier limits, keys and headers (06 §2.7)', async () => {
  const { l, keys } = limiter();
  const headers = await consumeTierQuota(l, 'grocery-generate', USER, 'free');
  assertEquals(keys, [
    [`grocery-generate:${USER}:min`, 3, 60],
    [`grocery-generate:${USER}:day`, 10, 86_400],
  ]);
  assertEquals(headers, {
    'ratelimit-limit': '3',
    'ratelimit-remaining': '2',
    'x-quota-limit': '10',
    'x-quota-remaining': '9',
  });
  assertEquals(limitsFor('ai-chat', 'premium'), { daily: 200, perMinute: 20 });
  assertEquals(TIER_LIMITS['ramadan-generate'].daily.free, 0);
});

Deno.test('consumeTierQuota: no allowance, burst and daily errors', async () => {
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return (e as HttpError).code;
    }
  };
  const none = limiter();
  assertEquals(
    await code(consumeTierQuota(none.l, 'ramadan-generate', USER, 'free')),
    'PREMIUM_REQUIRED',
  );
  assertEquals(none.keys, []); // nothing consumed
  assertEquals(
    await code(consumeTierQuota(limiter('min').l, 'ai-chat', USER, 'free')),
    'RATE_LIMITED',
  );
  assertEquals(
    await code(consumeTierQuota(limiter('day').l, 'ai-chat', USER, 'free')),
    'QUOTA_EXCEEDED',
  );
  assertEquals(
    await code(consumeTierQuota(limiter().l, 'ramadan-generate', USER, 'premium')),
    'ok',
  );
});

Deno.test('assertHouseholdWritable: read-only only for a free household', async () => {
  const ro = store({ readOnly: true });
  await assertHouseholdWritable(ro.s, HH, PREMIUM, 'plan.generate');
  assertEquals(ro.calls, []); // premium never asks
  const err = await assertRejects(
    () => assertHouseholdWritable(ro.s, HH, FREE, 'plan.generate'),
    HttpError,
  );
  assertEquals(err.code, 'PREMIUM_REQUIRED');
  assertEquals(err.details, { feature: 'plan.generate', reason: 'household_read_only' });
  await assertHouseholdWritable(store().s, HH, FREE, 'plan.generate');
});

Deno.test('planEligibleMembers: first 6 on free, all on premium', () => {
  const members = Array.from({ length: 8 }, (_, i) => `m${i}`);
  const free = planEligibleMembers(members, FREE);
  assertEquals(free.eligible.length, FREE_PLAN_MEMBER_LIMIT);
  assertEquals(free.excluded, ['m6', 'm7']);
  assertEquals(planEligibleMembers(members, PREMIUM).excluded, []);
  assertEquals(planEligibleMembers(members.slice(0, 6), FREE).excluded, []);
});
