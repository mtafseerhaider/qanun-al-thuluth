import { assertEquals } from 'jsr:@std/assert@1';

import { errorResponse, fromPostgrestError } from '../../functions/_shared/errors.ts';

Deno.test('CHILD_RULE uses the rule from the DETAIL JSON (06 §3.2)', async () => {
  const err = fromPostgrestError({
    code: 'P0001',
    message: 'CHILD_RULE:weight_loss',
    details: '{"rule" : "no_weight_loss_under_18", "goal_type" : "weight_loss"}',
  });
  assertEquals(err.code, 'VALIDATION_FAILED');
  assertEquals(err.details.rule, 'no_weight_loss_under_18');
  assertEquals(err.details.goal_type, 'weight_loss');
  const res = errorResponse(err, 'req-1');
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.details.rule, 'no_weight_loss_under_18');
});

Deno.test('CHILD_RULE without DETAIL falls back to the 06 rule names', () => {
  const rules = ['weight_loss', 'weight_gain', 'kcal_target'].map(
    (r) =>
      fromPostgrestError({ code: 'P0001', message: `CHILD_RULE:${r}`, details: null }).details.rule,
  );
  assertEquals(rules, [
    'no_weight_loss_under_18',
    'no_weight_gain_under_18',
    'no_calorie_target_under_18',
  ]);
});

Deno.test('consent guards map to CONSENT_REQUIRED with details.consents', () => {
  const child = fromPostgrestError({
    code: 'P0001',
    message: 'CHILD_DATA_CONSENT_REQUIRED',
    hint: 'consent_required',
  });
  assertEquals(child.code, 'CONSENT_REQUIRED');
  assertEquals(child.details.consents, ['child_data']);
  const health = fromPostgrestError({
    code: 'P0001',
    message: 'CONSENT_REQUIRED',
    details: '{"kind" : "health_data"}',
  });
  assertEquals(health.code, 'CONSENT_REQUIRED');
  assertEquals(health.details.consents, ['health_data']);
  assertEquals(errorResponse(health, 'r').status, 403);
});

Deno.test('existing mappings are unchanged', () => {
  assertEquals(
    fromPostgrestError({ message: 'LIMIT_REACHED: family_members' }).code,
    'LIMIT_REACHED',
  );
  assertEquals(fromPostgrestError({ code: '42501', message: 'rls' }).code, 'FORBIDDEN');
  assertEquals(fromPostgrestError({ code: '23505', message: 'dup' }).code, 'CONFLICT');
  assertEquals(fromPostgrestError({ code: 'XX000', message: 'boom' }).code, 'INTERNAL');
});

Deno.test('MODULE_NOT_APPLICABLE maps to VALIDATION_FAILED with rule module_not_applicable', () => {
  const plain = fromPostgrestError({
    code: '23514',
    message: 'MODULE_NOT_APPLICABLE',
    details: 'pregnancy_support',
  });
  assertEquals(plain.code, 'VALIDATION_FAILED');
  assertEquals(plain.details, { goal_type: 'pregnancy_support', rule: 'module_not_applicable' });
  const json = fromPostgrestError({
    code: '23514',
    message: 'MODULE_NOT_APPLICABLE',
    details: '{"goal_type": "breastfeeding_support", "rule": "x"}',
  });
  assertEquals(json.details, { goal_type: 'breastfeeding_support', rule: 'module_not_applicable' });
});

Deno.test(
  'plan entitlement trigger errors map to PLAN_ALREADY_ACTIVE and PREMIUM_REQUIRED (S3-02)',
  async () => {
    const active = fromPostgrestError({
      code: 'P0001',
      message: 'PLAN_ALREADY_ACTIVE',
      details: '{"resource": "meal_plans", "limit": 1, "current": 1}',
    });
    assertEquals(active.code, 'PLAN_ALREADY_ACTIVE');
    assertEquals(active.details, { resource: 'meal_plans', limit: 1, current: 1 });
    assertEquals(errorResponse(active, 'r').status, 409);
    const premium = fromPostgrestError({
      code: 'P0001',
      message: 'PREMIUM_REQUIRED',
      details: '{"reason": "multi_week_or_kind", "kind": "standard", "week_count": 4}',
    });
    assertEquals(premium.code, 'PREMIUM_REQUIRED');
    assertEquals(premium.details.week_count, 4);
    const res = errorResponse(premium, 'r');
    assertEquals(res.status, 402);
    assertEquals((await res.json()).error.details.reason, 'multi_week_or_kind');
  },
);

Deno.test('S5 guards: fasting under 7, read-only household, plain VALIDATION_FAILED', () => {
  const fasting = fromPostgrestError({
    code: 'P0001',
    message: 'CHILD_RULE:fasting_under_7',
    details: JSON.stringify({ rule: 'no_fasting_under_7', family_member_id: 'm1' }),
  });
  assertEquals(fasting.code, 'VALIDATION_FAILED');
  assertEquals(fasting.details.rule, 'no_fasting_under_7');
  assertEquals(fasting.details.family_member_id, 'm1');

  const readOnly = fromPostgrestError({
    code: 'P0001',
    message: 'PREMIUM_REQUIRED',
    details: JSON.stringify({ reason: 'household_read_only', household_id: 'h1' }),
  });
  assertEquals(readOnly.code, 'PREMIUM_REQUIRED');
  assertEquals(readOnly.details.feature, 'household.write');
  assertEquals(readOnly.details.reason, 'household_read_only');

  const kind = fromPostgrestError({
    code: 'P0001',
    message: 'PREMIUM_REQUIRED',
    details: JSON.stringify({ reason: 'multi_week_or_kind', kind: 'ramadan' }),
  });
  assertEquals(kind.details.feature, 'plan.multi_week_or_kind');

  const foreign = fromPostgrestError({
    code: '22023',
    message: 'VALIDATION_FAILED',
    details: JSON.stringify({ field: 'child_participation', reason: 'not_in_household' }),
  });
  assertEquals(foreign.code, 'VALIDATION_FAILED');
  assertEquals(foreign.details.reason, 'not_in_household');
});
