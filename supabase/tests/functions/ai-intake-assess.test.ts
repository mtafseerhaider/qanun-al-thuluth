import { assert, assertEquals, assertExists, assertStringIncludes } from 'jsr:@std/assert@1';
import { AIError, dailyFluidTarget, FakeProvider, RouteResolver } from '@thuluth/ai-core';
import type { AiModelRouteRow, AiUsageInsert, ChatRequest } from '@thuluth/ai-core';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';
import type { HouseholdRole } from '@thuluth/shared';

import {
  BURST_PER_MINUTE,
  createIntakeAssessHandler,
} from '../../functions/ai-intake-assess/handler.ts';
import type {
  AssessmentInsert,
  IntakeStore,
  MemberContext,
  SafetyEventInsert,
} from '../../functions/ai-intake-assess/store.ts';

const HH = '00000000-0000-4000-b000-000000000001';
const OWNER = '00000000-0000-4000-a000-000000000001';
const VIEWER = '00000000-0000-4000-a000-000000000002';
const USMAN = '00000000-0000-4000-c000-000000000001';
const HINA = '00000000-0000-4000-c000-000000000002';
const ZAINAB = '00000000-0000-4000-c000-000000000003';
const OTHER = '00000000-0000-4000-c000-0000000000ff';
const NOW = new Date('2026-10-06T08:00:00Z');
const KEY = 'intake-key-0001';

function member(over: Partial<MemberContext> & Pick<MemberContext, 'id' | 'name'>): MemberContext {
  return {
    date_of_birth: '1988-06-01',
    sex_at_birth: 'male',
    height_cm: 175,
    weight_kg: 84,
    activity_level: 'moderate',
    special_modules: [],
    sleep_schedule: { bed: '23:00', wake: '06:00' },
    lifestyle: {
      meal_pattern: [
        { meal: 'breakfast', time: '07:30' },
        { meal: 'lunch', time: '13:30' },
        { meal: 'dinner', time: '20:00' },
      ],
    },
    conditions: [],
    allergies: [],
    medications: [],
    goals: [],
    pregnancy: null,
    has_sensory_profile: false,
    safe_food_count: 0,
    ...over,
  };
}

/** Usman (01 §3.2): 38 y, 84 kg, 175 cm, moderate, weight loss to 70 kg. */
const usman = member({
  id: USMAN,
  name: 'Usman',
  goals: [{ goal_type: 'weight_loss', is_primary: true, target_value: 70, target_unit: 'kg' }],
});
/** Hina: 34 y, breastfeeding. */
const hina = member({
  id: HINA,
  name: 'Hina',
  date_of_birth: '1992-03-15',
  sex_at_birth: 'female',
  height_cm: 162,
  weight_kg: 62,
  activity_level: 'light',
  special_modules: ['breastfeeding'],
});
/** Zainab: 7 y. */
const zainab = member({
  id: ZAINAB,
  name: 'Zainab',
  date_of_birth: '2019-03-10',
  sex_at_birth: 'female',
  height_cm: 121,
  weight_kg: 22,
  activity_level: 'active',
  goals: [{ goal_type: 'weight_loss', is_primary: true, target_value: null, target_unit: null }],
});

function memoryStore(opts: { members?: MemberContext[]; consents?: ConsentKind[] } = {}) {
  const roles = new Map<string, HouseholdRole>([
    [OWNER, 'owner'],
    [VIEWER, 'viewer'],
  ]);
  const members = opts.members ?? [usman, hina, zainab];
  const consents = opts.consents ?? ['ai_processing', 'health_data', 'child_data'];
  const counters = new Map<string, number>();
  const idem = new Map<
    string,
    { id: string; hash: string; status?: number; body?: unknown; done: boolean }
  >();
  const assessments: AssessmentInsert[] = [];
  const hydration: { familyMemberId: string; dailyMl: number; schedule: unknown[] }[] = [];
  const safety: SafetyEventInsert[] = [];
  const audits: string[] = [];
  const failed: string[] = [];
  const limits = { burst: BURST_PER_MINUTE, daily: Infinity as number };
  const store: IntakeStore = {
    household: async (h) =>
      h === HH
        ? { id: HH, country_code: 'PK', timezone: 'Asia/Karachi', climate_zone: 'hot_semi_arid' }
        : null,
    membership: async (_h, u) => roles.get(u) ?? null,
    userProfile: async () => ({ locale: 'en' }),
    hasPremium: async () => false,
    activeConsents: async () => consents,
    consumeRateLimit: async (key, limit, _window) => {
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      const cap = key.endsWith(':day') ? Math.min(limit, limits.daily) : limit;
      return {
        allowed: n <= cap,
        remaining: Math.max(0, cap - n),
        reset_at: '2026-10-06T08:01:00Z',
      };
    },
    idempotencyBegin: async (_scope, user, key, hash) => {
      const k = `${user}:${key}`;
      const row = idem.get(k);
      if (!row) {
        const id = crypto.randomUUID();
        idem.set(k, { id, hash, done: false });
        return { state: 'new', id };
      }
      if (row.hash !== hash) return { state: 'mismatch' };
      if (!row.done) return { state: 'in_progress' };
      return { state: 'replay', status: row.status ?? 200, body: row.body };
    },
    idempotencyComplete: async (id, status, body) => {
      for (const row of idem.values()) {
        if (row.id === id) Object.assign(row, { status, body, done: true });
      }
    },
    idempotencyFail: async (id) => {
      failed.push(id);
      for (const [k, row] of idem) if (row.id === id) idem.delete(k);
    },
    members: async (_h, ids) => (ids ? members.filter((m) => ids.includes(m.id)) : members),
    verifiedRecommendations: async () => [
      {
        id: '00000000-0000-4000-d000-000000000001',
        code: 'thirds_rule',
        applies_to: {},
        contraindications: {},
      },
      {
        id: '00000000-0000-4000-d000-000000000002',
        code: 'lactation_fluids',
        applies_to: { modules: ['breastfeeding'] },
        contraindications: {},
      },
    ],
    insertAssessments: async (rows) => {
      assessments.push(...rows);
    },
    setHydrationTarget: async (a) => {
      hydration.push({
        familyMemberId: a.familyMemberId,
        dailyMl: a.dailyMl,
        schedule: a.schedule,
      });
    },
    insertSafetyEvents: async (rows) => {
      safety.push(...rows);
    },
    audit: async (e) => {
      audits.push(`${e.action}:${e.entity}`);
    },
  };
  return { store, assessments, hydration, safety, audits, failed, limits };
}

const routes: AiModelRouteRow[] = [
  {
    route_key: 'plan.adjust',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    params: {},
    priority: 1,
    enabled: true,
  },
  {
    route_key: 'classify.safety',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    params: {},
    priority: 1,
    enabled: true,
  },
];

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** Refs and minor markers from the facts the handler sends, so scripted summaries can target them. */
function factsOf(req: ChatRequest): { ref: string; minor: boolean }[] {
  const first = req.messages[0]?.content[0];
  const body = first?.type === 'text' ? first.text : '';
  const json = body.slice(body.indexOf('<household>') + 11, body.lastIndexOf('</household>'));
  return JSON.parse(json) as { ref: string; minor: boolean }[];
}

type SummaryFn = (fact: { ref: string; minor: boolean }) => string;
const SAFE: SummaryFn = (f) =>
  f.minor
    ? 'Regular family meals and plenty of play keep growth on track.'
    : 'A steady routine with regular meals and water through the day suits you well.';

function setup(
  opts: {
    summary?: SummaryFn;
    planError?: AIError;
    classifierPass?: boolean;
    store?: ReturnType<typeof memoryStore>;
  } = {},
) {
  const mem = opts.store ?? memoryStore();
  const usage: AiUsageInsert[] = [];
  const provider = new FakeProvider({
    id: 'anthropic',
    script: (req, model) => {
      if (model === 'claude-haiku-4-5') {
        return text(JSON.stringify({ pass: opts.classifierPass ?? true, categories: [] }));
      }
      if (opts.planError) return opts.planError;
      const summary = opts.summary ?? SAFE;
      return text(
        JSON.stringify({ members: factsOf(req).map((f) => ({ ref: f.ref, summary: summary(f) })) }),
      );
    },
  });
  let n = 0;
  const handler = createIntakeAssessHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    store: mem.store,
    fallback: {
      resolver: new RouteResolver(async (key) => routes.filter((r) => r.route_key === key)),
      providers: { anthropic: provider },
      sleep: async () => {},
    },
    writeUsage: async (row) => {
      usage.push(row);
    },
    now: () => NOW,
    uuid: () => `00000000-0000-4000-e000-${String(++n).padStart(12, '0')}`,
  });
  return { handler, usage, provider, ...mem };
}

function post(body: unknown, opts: { jwt?: string; key?: string | null } = {}): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.jwt ?? 'owner'}`,
    'content-type': 'application/json',
    'x-request-id': 'req-1',
  };
  if (opts.key !== null) headers['idempotency-key'] = opts.key ?? KEY;
  return new Request('http://localhost/ai-intake-assess', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

interface Assessment {
  family_member_id: string;
  summary: string;
  life_stage: string;
  energy_targets: {
    kcal_per_day: number;
    tdee_kcal?: number;
    bmr_kcal?: number;
    pal?: number;
    goal_adjustment_kcal?: number;
  } | null;
  macro_targets: Record<string, number> | null;
  hydration_target_ml: number;
  child_guidance?: string[];
  risk_flags: string[];
  escalation: { family_member_id: string; reason: string } | null;
  recommendation_ids: string[];
}

async function assessments(res: Response): Promise<Map<string, Assessment>> {
  const json = (await res.json()) as { assessments: Assessment[]; disclaimer_key: string };
  assertEquals(json.disclaimer_key, 'disclaimer.not_medical_advice');
  return new Map(json.assessments.map((a) => [a.family_member_id, a]));
}

Deno.test(
  'Usman fixture: TDEE 2711, weight-loss target 2300 kcal, macros from the engine',
  async () => {
    const { handler, assessments: rows, usage, audits } = setup();
    const res = await handler(post({ household_id: HH }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('x-quota-limit'), '5');
    const a = (await assessments(res)).get(USMAN);
    assertExists(a?.energy_targets);
    assertEquals(a.energy_targets.tdee_kcal, 2711);
    assertEquals(a.energy_targets.bmr_kcal, 1749);
    assertEquals(a.energy_targets.pal, 1.55);
    assertEquals(a.energy_targets.goal_adjustment_kcal, -407);
    assertEquals(a.energy_targets.kcal_per_day, 2300);
    assertExists(a.macro_targets);
    assertEquals(a.life_stage, 'adult');
    assertEquals(a.escalation, null);
    assertEquals(rows.length, 3);
    assertEquals(rows[0]?.model_route, 'plan.adjust');
    assertEquals(rows[0]?.prompt_version, 'assessment.intake@1');
    // One plan.adjust call plus one classify.safety review, both metered.
    assertEquals(usage.map((u) => u.route_key).sort(), ['classify.safety', 'plan.adjust']);
    assertEquals(audits, ['insert:ai_assessments']);
  },
);

Deno.test(
  'minors: no calorie or macro targets in the response; estimate stored internally only',
  async () => {
    const { handler, assessments: rows, provider } = setup();
    const res = await handler(post({ household_id: HH }));
    const z = (await assessments(res)).get(ZAINAB);
    assertExists(z);
    assertEquals(z.energy_targets, null);
    assertEquals(z.macro_targets, null);
    assert((z.child_guidance ?? []).length > 0);
    // The child's weight-loss goal is ignored and flagged, never actioned.
    assert(z.risk_flags.includes('child_weight_goal_ignored'), z.risk_flags.join(','));
    const stored = rows.find((r) => r.family_member_id === ZAINAB);
    const et = stored?.energy_targets as {
      display: boolean;
      internal_estimate?: { kcal_per_day: number };
    };
    assertEquals(et.display, false);
    assert((et.internal_estimate?.kcal_per_day ?? 0) > 1000);
    assertEquals(stored?.macro_targets, {});
    // The model never sees the child's internal estimate.
    const sent = JSON.stringify(provider.calls[0]?.req.messages);
    assert(!sent.includes(String(et.internal_estimate?.kcal_per_day)));
  },
);

Deno.test(
  'Hina: breastfeeding raises the hydration target by at least 700 ml (FR-HYD-01)',
  async () => {
    const { handler, hydration } = setup();
    const res = await handler(post({ household_id: HH }));
    const h = (await assessments(res)).get(HINA);
    assertExists(h);
    const baseline = dailyFluidTarget({
      ageMonths: 34 * 12 + 6,
      sex: 'female',
      weightKg: 62,
      climate: 'warm',
      activity: 'light',
    });
    assert(h.hydration_target_ml >= baseline.dailyMl + 700, `${h.hydration_target_ml}`);
    assert(h.recommendation_ids.includes('00000000-0000-4000-d000-000000000002'));
    const stored = hydration.find((x) => x.familyMemberId === HINA);
    assertEquals(stored?.dailyMl, h.hydration_target_ml);
    const windows = stored?.schedule as { ml: number; kind: string }[];
    assertEquals(
      windows.reduce((s, w) => s + w.ml, 0),
      h.hydration_target_ml,
    );
    assert(windows.some((w) => w.kind === 'pre_meal'));
    assertEquals(hydration.length, 3);
  },
);

Deno.test(
  'red flag screening: escalation in the response and a safety event recorded',
  async () => {
    const { handler, safety, assessments: rows } = setup();
    const res = await handler(
      post({
        household_id: HH,
        red_flag_screening: {
          [USMAN]: { unintended_weight_change: { kg: -6, months: 3 } },
        },
      }),
    );
    assertEquals(res.status, 200);
    const u = (await assessments(res)).get(USMAN);
    assertExists(u?.escalation);
    assertEquals(u.escalation.family_member_id, USMAN);
    assert(
      u.risk_flags.some((f) => f.startsWith('red_flag.')),
      u.risk_flags.join(','),
    );
    // A hard red flag suppresses the weight-loss deficit.
    assertEquals(u.energy_targets?.goal_adjustment_kcal, 0);
    assertEquals(safety.length, 1);
    assertEquals(safety[0]?.family_member_id, USMAN);
    assertEquals(safety[0]?.source, 'intake');
    assert(
      rows
        .find((r) => r.family_member_id === USMAN)
        ?.risk_flags.some((f) => f.startsWith('red_flag.')),
    );
  },
);

Deno.test(
  'an unsafe model summary for a child is replaced by the growth-first template',
  async () => {
    const { handler, assessments: rows } = setup({
      summary: (f) =>
        f.minor
          ? 'She should eat less and aim for 1,300 kcal a day to lose weight.'
          : 'A steady routine with regular meals suits you well.',
    });
    const res = await handler(post({ household_id: HH }));
    const z = (await assessments(res)).get(ZAINAB);
    assertExists(z);
    assertStringIncludes(z.summary, 'Growth comes first');
    assert(!/kcal|eat less|lose weight/i.test(z.summary));
    assert(
      rows
        .find((r) => r.family_member_id === ZAINAB)
        ?.risk_flags.includes('summary_replaced_by_template'),
    );
  },
);

Deno.test('an invented number in an adult summary is replaced (numeric grounding)', async () => {
  const { handler } = setup({
    summary: (f) => (f.minor ? SAFE(f) : 'Aim for 1,800 kcal a day.'),
  });
  const res = await handler(post({ household_id: HH }));
  const u = (await assessments(res)).get(USMAN);
  assertStringIncludes(u?.summary ?? '', '2300 kcal');
});

Deno.test('the classify.safety review can fail the whole batch back to templates', async () => {
  const { handler } = setup({ classifierPass: false });
  const res = await handler(post({ household_id: HH }));
  const all = await assessments(res);
  assertStringIncludes(all.get(USMAN)?.summary ?? '', 'Daily energy target 2300 kcal');
  assertStringIncludes(all.get(ZAINAB)?.summary ?? '', 'Growth comes first');
});

Deno.test('401 without a valid token', async () => {
  const { handler } = setup();
  const res = await handler(post({ household_id: HH }, { jwt: 'nope' }));
  assertEquals(res.status, 401);
});

Deno.test('Idempotency-Key header is required', async () => {
  const { handler } = setup();
  const res = await handler(post({ household_id: HH }, { key: null }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, 'VALIDATION_FAILED');
});

Deno.test('viewers cannot run an assessment', async () => {
  const { handler } = setup();
  const res = await handler(post({ household_id: HH }, { jwt: 'viewer' }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, 'FORBIDDEN');
});

Deno.test('unknown household is NOT_FOUND', async () => {
  const { handler } = setup();
  const res = await handler(post({ household_id: '00000000-0000-4000-b000-0000000000ff' }));
  assertEquals(res.status, 404);
});

Deno.test('child_data consent is required when the household has a minor', async () => {
  const store = memoryStore({ consents: ['ai_processing', 'health_data'] });
  const { handler, failed, assessments: rows } = setup({ store });
  const res = await handler(post({ household_id: HH }));
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.error.code, 'CONSENT_REQUIRED');
  assertEquals(json.error.details.consents, ['child_data']);
  assertEquals(failed.length, 1);
  assertEquals(rows.length, 0);
  // Adults only: child_data is not needed.
  const res2 = await handler(
    post({ household_id: HH, family_member_ids: [USMAN] }, { key: 'intake-key-0002' }),
  );
  assertEquals(res2.status, 200);
});

Deno.test('members outside the household are NOT_FOUND', async () => {
  const { handler } = setup();
  const res = await handler(post({ household_id: HH, family_member_ids: [USMAN, OTHER] }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.details.family_member_ids, [OTHER]);
});

Deno.test(
  'replay with the same key returns the stored body without a second model call',
  async () => {
    const { handler, provider, assessments: rows } = setup();
    const body = { household_id: HH, family_member_ids: [USMAN] };
    const first = await handler(post(body));
    assertEquals(first.status, 200);
    const firstJson = await first.json();
    const calls = provider.calls.length;
    const again = await handler(post(body));
    assertEquals(again.status, 200);
    assertEquals(again.headers.get('idempotent-replayed'), 'true');
    assertEquals(await again.json(), firstJson);
    assertEquals(provider.calls.length, calls);
    assertEquals(rows.length, 1);
    const reused = await handler(post({ household_id: HH, family_member_ids: [HINA] }));
    assertEquals((await reused.json()).error.code, 'IDEMPOTENCY_KEY_REUSED');
  },
);

Deno.test('burst limit is RATE_LIMITED, daily limit is QUOTA_EXCEEDED', async () => {
  const { handler } = setup();
  const body = { household_id: HH, family_member_ids: [USMAN] };
  for (let i = 0; i < BURST_PER_MINUTE; i++) {
    assertEquals((await handler(post(body, { key: `burst-key-${i}0000` }))).status, 200);
  }
  const limited = await handler(post(body, { key: 'burst-key-90000' }));
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error.code, 'RATE_LIMITED');

  const store = memoryStore();
  store.limits.daily = 0;
  const quota = setup({ store });
  const res = await quota.handler(post(body));
  assertEquals((await res.json()).error.code, 'QUOTA_EXCEEDED');
});

Deno.test('provider failure maps to AI_UNAVAILABLE and nothing is written', async () => {
  const {
    handler,
    assessments: rows,
    failed,
  } = setup({
    planError: new AIError('SERVER_ERROR', 'boom', { provider: 'anthropic', status: 500 }),
  });
  const res = await handler(post({ household_id: HH }));
  assertEquals((await res.json()).error.code, 'AI_UNAVAILABLE');
  assertEquals(rows.length, 0);
  assertEquals(failed.length, 1);
});

Deno.test('invalid model JSON twice is AI_OUTPUT_INVALID', async () => {
  const { handler } = setup({ summary: () => '' });
  const res = await handler(post({ household_id: HH }));
  assertEquals((await res.json()).error.code, 'AI_OUTPUT_INVALID');
});

Deno.test(
  'pregnant teen: pregnancy guidance with a see-your-doctor prompt and no numbers',
  async () => {
    const teen = member({
      id: OTHER,
      name: 'Sana',
      date_of_birth: '2009-08-01',
      sex_at_birth: 'female',
      height_cm: 158,
      weight_kg: 54,
      special_modules: ['pregnancy'],
      pregnancy: { trimester: 2, gestational_diabetes: false },
      goals: [
        { goal_type: 'pregnancy_support', is_primary: true, target_value: null, target_unit: null },
      ],
    });
    const { handler } = setup({ store: memoryStore({ members: [usman, teen] }) });
    const res = await handler(post({ household_id: HH }));
    assertEquals(res.status, 200);
    const a = (await assessments(res)).get(OTHER);
    assertExists(a);
    assertEquals(a.life_stage, 'teen');
    assertEquals(a.energy_targets, null);
    assertEquals(a.macro_targets, null);
    assert(a.risk_flags.includes('teen_pregnancy'), a.risk_flags.join(','));
    assert((a.child_guidance ?? [])[0]?.includes('doctor'));
  },
);
