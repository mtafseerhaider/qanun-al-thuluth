import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import { AiReassessResponse, createReassessHandler } from '../../functions/ai-reassess/handler.ts';
import type {
  LatestAssessment,
  PeriodicAssessmentInsert,
  ReassessSafetyEventInsert,
  ReassessStore,
} from '../../functions/ai-reassess/store.ts';
import { supabaseReassessStore } from '../../functions/ai-reassess/store.ts';
import type { MemberContext } from '../../functions/ai-intake-assess/store.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

const SECRET = 'reassess-secret-for-tests';
const HH = '00000000-0000-4000-b000-000000000001';
const HH2 = '00000000-0000-4000-b000-000000000002';
const USMAN = '00000000-0000-4000-c000-000000000001';
const ZAINAB = '00000000-0000-4000-c000-000000000003';
const NOW = new Date('2026-10-06T08:00:00Z');

function member(over: Partial<MemberContext> & Pick<MemberContext, 'id' | 'name'>): MemberContext {
  return {
    date_of_birth: '1988-06-01',
    sex_at_birth: 'male',
    height_cm: 175,
    weight_kg: 80,
    activity_level: 'moderate',
    special_modules: [],
    sleep_schedule: { bed: '23:00', wake: '06:00' },
    lifestyle: {},
    conditions: [],
    allergies: [],
    medications: [],
    goals: [{ goal_type: 'weight_loss', is_primary: true, target_value: 70, target_unit: 'kg' }],
    pregnancy: null,
    has_sensory_profile: false,
    safe_food_count: 0,
    ...over,
  };
}

/** Usman lost 4 kg since his intake (84 -> 80 kg). */
const usman = member({ id: USMAN, name: 'Usman' });
/** Zainab, 7: a child. Her intake row carried an internal estimate (display false). */
const zainab = member({
  id: ZAINAB,
  name: 'Zainab',
  date_of_birth: '2019-03-10',
  sex_at_birth: 'female',
  height_cm: 124,
  weight_kg: 24,
  activity_level: 'active',
  goals: [],
});

function prev(
  over: Partial<LatestAssessment> & Pick<LatestAssessment, 'id' | 'family_member_id'>,
): LatestAssessment {
  return {
    household_id: HH,
    kind: 'intake',
    created_at: '2026-09-01T08:00:00Z',
    energy_targets: {},
    macro_targets: {},
    hydration_targets: {},
    risk_flags: [],
    input_snapshot: {},
    ...over,
  };
}

const PREV_USMAN = prev({
  id: '00000000-0000-4000-e000-000000000001',
  family_member_id: USMAN,
  energy_targets: { display: true, kcal_per_day: 2300 },
  macro_targets: { protein_g: 120, carbs_g: 280, fat_g: 75, fiber_g: 30 },
  hydration_targets: { daily_ml: 2600 },
  risk_flags: ['red_flag.eating_disorder_signals', 'summary_replaced_by_template'],
  input_snapshot: {
    age_months: 459,
    life_stage: 'adult',
    weight_kg: 84,
    height_cm: 175,
    activity_level: 'moderate',
    goals: ['weight_loss'],
    special_modules: [],
    climate: 'very_hot',
  },
});
const PREV_ZAINAB = prev({
  id: '00000000-0000-4000-e000-000000000003',
  family_member_id: ZAINAB,
  energy_targets: { display: false, internal_estimate: { kcal_per_day: 1500 } },
  hydration_targets: { daily_ml: 1200 },
  input_snapshot: {
    age_months: 84,
    life_stage: 'child',
    activity_level: 'active',
    climate: 'very_hot',
  },
});

function memoryStore(opts: { latest?: LatestAssessment[]; lease?: boolean | null } = {}) {
  const state = {
    inserted: [] as PeriodicAssessmentInsert[],
    hydration: [] as Array<{ familyMemberId: string; dailyMl: number }>,
    safety: [] as ReassessSafetyEventInsert[],
    audits: 0,
    leases: [] as string[],
    dueCalls: [] as Array<{
      before: string;
      limit: number;
      householdIds: readonly string[] | undefined;
    }>,
  };
  const store: ReassessStore = {
    acquireLease: async (name) => {
      state.leases.push(`acquire:${name}`);
      return opts.lease === undefined ? true : opts.lease;
    },
    releaseLease: async (name) => {
      state.leases.push(`release:${name}`);
    },
    // Mirrors due_reassessments: due at or before `before`, oldest first, capped, household filter.
    dueAssessments: async ({ before, limit, householdIds }) => {
      state.dueCalls.push({ before: before.toISOString(), limit, householdIds });
      return (opts.latest ?? [PREV_USMAN, PREV_ZAINAB])
        .filter((a) => !householdIds?.length || householdIds.includes(a.household_id))
        .filter((a) => Date.parse(a.created_at) <= before.getTime())
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    household: async (id) =>
      id === HH
        ? { id: HH, country_code: 'PK', timezone: 'Asia/Karachi', climate_zone: 'hot_semi_arid' }
        : null,
    ownerLocale: async () => 'en',
    members: async (_h, ids) => [usman, zainab].filter((m) => ids.includes(m.id)),
    verifiedRecommendations: async () => [],
    insertAssessments: async (rows) => {
      state.inserted.push(...rows);
    },
    setHydrationTarget: async (a) => {
      state.hydration.push({ familyMemberId: a.familyMemberId, dailyMl: a.dailyMl });
    },
    insertSafetyEvents: async (rows) => {
      state.safety.push(...rows);
    },
    audit: async () => {
      state.audits++;
    },
  };
  let n = 0;
  const handler = createReassessHandler({
    secrets: () => [SECRET],
    store,
    now: () => NOW,
    uuid: () => `00000000-0000-4000-f000-${String(++n).padStart(12, '0')}`,
  });
  return { handler, state };
}

const call = (
  handler: (r: Request) => Promise<Response>,
  body: unknown = {},
  secret: string | null = SECRET,
) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-internal-secret'] = secret;
  return handler(
    new Request('http://localhost/ai-reassess', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
};

Deno.test('ai-reassess: internal secret required', async () => {
  const { handler } = memoryStore();
  assertEquals((await call(handler, {}, null)).status, 401);
  assertEquals((await call(handler, {}, 'wrong-secret-0000000')).status, 401);
});

Deno.test('ai-reassess: recomputes due members and records a targets diff', async () => {
  const { handler, state } = memoryStore();
  const res = await call(handler);
  assertEquals(res.status, 200);
  const body = AiReassessResponse.parse(await res.json());
  assertEquals(body.due, 2);
  assertEquals(body.reassessed, 2);
  assertEquals(state.inserted.length, 2);
  assertEquals(state.audits, 1);
  assertEquals(state.leases, ['acquire:ai-reassess', 'release:ai-reassess']);

  const u = state.inserted.find((r) => r.family_member_id === USMAN)!;
  assertEquals(u.kind, 'periodic');
  assertEquals(u.model, null);
  assertEquals(u.created_by_user_id, null);
  const diff = u.input_snapshot.targets_diff as {
    changed: boolean;
    items: Array<{ target: string; from: number | null; to: number | null }>;
    reasons: string[];
  };
  assert(diff.changed);
  const kcal = diff.items.find((i) => i.target === 'energy_kcal')!;
  assertEquals(kcal.from, 2300);
  assertEquals(kcal.to, (u.energy_targets as { kcal_per_day: number }).kcal_per_day);
  assert(diff.reasons.includes('weight_changed'));
  assertEquals(u.input_snapshot.previous_assessment_id, PREV_USMAN.id);
  // Red flags carry forward; run-only flags do not.
  assert(u.risk_flags.includes('red_flag.eating_disorder_signals'));
  assertFalse(u.risk_flags.includes('summary_replaced_by_template'));
  assertEquals(state.safety.length, 0);
});

Deno.test(
  'ai-reassess: never stores or diffs kcal, macro or weight numbers for a child',
  async () => {
    const { handler, state } = memoryStore();
    const body = AiReassessResponse.parse(await (await call(handler)).json());
    const z = state.inserted.find((r) => r.family_member_id === ZAINAB)!;
    assertEquals(z.energy_targets.display, false);
    assertFalse('kcal_per_day' in z.energy_targets);
    assertFalse('internal_estimate' in z.energy_targets);
    assertEquals(z.macro_targets, {});
    assertFalse('weight_kg' in z.input_snapshot);
    assertFalse('height_cm' in z.input_snapshot);
    const diff = body.members.find((m) => m.family_member_id === ZAINAB)!.targets_diff;
    assert(diff.minor);
    assert(diff.items.every((i) => i.unit === 'ml'));
    assertFalse(diff.reasons.includes('weight_changed'));
    assertFalse(/kcal|kg/i.test(JSON.stringify(z.input_snapshot.targets_diff)));
    assertFalse(/\d{3,4} ?kcal|calorie/i.test(z.summary));
    // Her fluid target changed (7 -> 7.5 years, hot climate): it is saved.
    if (diff.items.length) assert(state.hydration.some((h) => h.familyMemberId === ZAINAB));
  },
);

Deno.test(
  'ai-reassess: members assessed within 28 days are skipped; force needs households',
  async () => {
    const recent = { ...PREV_USMAN, created_at: '2026-09-25T08:00:00Z' };
    const { handler, state } = memoryStore({ latest: [recent] });
    const body = AiReassessResponse.parse(await (await call(handler)).json());
    assertEquals(body.due, 0);
    assertEquals(state.inserted.length, 0);
    assertEquals((await call(handler, { force: true })).status, 400);
    const forced = AiReassessResponse.parse(
      await (await call(handler, { force: true, household_ids: [HH] })).json(),
    );
    assertEquals(forced.reassessed, 1);
  },
);

Deno.test('ai-reassess: dry run writes nothing; a held lease skips the run', async () => {
  const dry = memoryStore();
  const body = AiReassessResponse.parse(await (await call(dry.handler, { dry_run: true })).json());
  assertEquals(body.reassessed, 2);
  assertEquals(dry.state.inserted.length, 0);
  assertEquals(dry.state.leases, []);
  assert(body.members.every((m) => m.assessment_id === null));

  const held = memoryStore({ lease: false });
  const skipped = AiReassessResponse.parse(await (await call(held.handler)).json());
  assert(skipped.skipped);
  assertEquals(held.state.inserted.length, 0);
});

Deno.test('ai-reassess: a missing household is skipped without failing the run', async () => {
  const other = { ...PREV_USMAN, household_id: HH2, id: '00000000-0000-4000-e000-0000000000ff' };
  const { handler, state } = memoryStore({ latest: [other, PREV_ZAINAB] });
  const body = AiReassessResponse.parse(await (await call(handler)).json());
  assertEquals(body.due, 2);
  assertEquals(body.reassessed, 1);
  assertEquals(state.inserted.length, 1);
});

Deno.test('ai-reassess: asks the database for due members (28 days back, capped)', async () => {
  const { handler, state } = memoryStore();
  await call(handler, { limit: 5 });
  assertEquals(state.dueCalls, [
    { before: '2026-09-08T08:00:00.000Z', limit: 5, householdIds: undefined },
  ]);
  const forced = memoryStore();
  await call(forced.handler, { force: true, household_ids: [HH] });
  assertEquals(forced.state.dueCalls, [
    { before: NOW.toISOString(), limit: 200, householdIds: [HH] },
  ]);
});

Deno.test('ai-reassess store: dueAssessments calls the due_reassessments RPC', async () => {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const row = { ...PREV_USMAN, risk_flags: null };
  const admin = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: [row], error: null });
    },
  } as unknown as SupabaseClient;
  const store = supabaseReassessStore(admin);
  const out = await store.dueAssessments({ before: NOW, limit: 50 });
  assertEquals(calls, [
    {
      fn: 'due_reassessments',
      args: { p_before: NOW.toISOString(), p_limit: 50, p_household_ids: null },
    },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0]!.risk_flags, []);
  await store.dueAssessments({ before: NOW, limit: 1, householdIds: [HH, HH2] });
  assertEquals((calls[1]!.args as { p_household_ids: string[] }).p_household_ids, [HH, HH2]);
});

Deno.test('ai-reassess store: an RPC error is thrown', async () => {
  const admin = {
    rpc: () =>
      Promise.resolve({ data: null, error: { code: 'P0001', message: 'VALIDATION_FAILED' } }),
  } as unknown as SupabaseClient;
  const err = await supabaseReassessStore(admin)
    .dueAssessments({ before: NOW, limit: 0 })
    .then(
      () => null,
      (e: unknown) => e,
    );
  assertEquals((err as { message?: string } | null)?.message, 'VALIDATION_FAILED');
});
