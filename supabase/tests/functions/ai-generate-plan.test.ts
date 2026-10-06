import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';
import { AIError, mealAllergenCodes } from '@thuluth/ai-core';

import { createGeneratePlanHandler } from '../../functions/ai-generate-plan/handler.ts';
import type { GenerationMeta } from '../../functions/_shared/plan/pipeline.ts';
import type { MealPlanRow } from '../../functions/_shared/plan/store.ts';
import {
  FAMILY,
  fakeDeps,
  HH,
  IBRAHIM,
  kicker,
  mealId,
  memoryStore,
  NOW,
  OWNER,
  SECRET,
  selection,
  START,
  text,
  VIEWER,
} from './plan-fixtures.ts';
import type { MemoryOptions, PlanScript } from './plan-fixtures.ts';

const SAFE_RATIONALE =
  'A varied week on the Thuluth plate: plenty of vegetables, daal and chicken, with familiar sides for the children.';

const firstPick: PlanScript = (req, model) =>
  model === 'model-plan.generate' || model === 'model-plan.adjust'
    ? text(selection(req, (_s, refs) => refs[0] ?? 'c1', SAFE_RATIONALE))
    : undefined;

function setup(opts: MemoryOptions & { script?: PlanScript } = {}) {
  const mem = memoryStore(opts);
  const ai = fakeDeps(opts.script ?? firstPick);
  const bg = kicker();
  const handler = createGeneratePlanHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    secrets: () => [SECRET],
    store: mem.store,
    entitlements: mem.entitlements,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    kick: bg.kick,
    now: () => NOW,
  });
  return { handler, bg, ...mem, ...ai };
}

let keyN = 0;
function post(body: Record<string, unknown>, opts: { jwt?: string; key?: string } = {}): Request {
  return new Request('http://localhost/functions/v1/ai-generate-plan', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.jwt ?? 'owner'}`,
      'content-type': 'application/json',
      'idempotency-key': opts.key ?? `plan-key-${String(++keyN).padStart(4, '0')}`,
    },
    body: JSON.stringify({ household_id: HH, start_date: START, ...body }),
  });
}

function worker(body: Record<string, unknown>, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-internal-secret'] = secret;
  return new Request('http://localhost/functions/v1/ai-generate-plan/worker', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function activePlan(id: string): MealPlanRow {
  return {
    id,
    household_id: HH,
    kind: 'standard',
    status: 'active',
    title: null,
    start_date: '2026-10-05',
    end_date: '2026-10-11',
    week_count: 1,
    version: 1,
    parent_plan_id: null,
    budget_profile_id: null,
    created_by_user_id: OWNER,
    rationale: null,
    generation_progress: { phase: 'done' },
    generation_meta: {},
    deleted_at: null,
  };
}

Deno.test(
  'premium: 202 accepted, worker writes a validated draft week for the Usman family',
  async () => {
    const { handler, bg, state, catalog, usage } = setup();
    const res = await handler(post({ week_count: 1 }));
    assertEquals(res.status, 202);
    const body = (await res.json()) as { meal_plan_id: string; mode: string; plan_status: string };
    assertEquals(body.mode, 'full');
    assertEquals(body.plan_status, 'generating');
    assertEquals(state.plans.get(body.meal_plan_id)?.status, 'generating');
    assertEquals(state.enqueued, [body.meal_plan_id]);

    await bg.drain();
    const plan = state.plans.get(body.meal_plan_id);
    assertExists(plan);
    assertEquals(plan.status, 'draft');
    assertEquals(plan.generation_progress.phase, 'done');
    assertEquals(plan.generation_progress.completed_weeks, 1);
    assertEquals(plan.rationale, SAFE_RATIONALE);
    const meals = state.meals.get(plan.id) ?? [];
    assertEquals(meals.length, 28);
    // Every serving: four members, portions from the catalog, no allergen or haram meal.
    for (const m of meals) {
      assertEquals(m.servings.length, 4);
      const meal = catalog.meals.get(m.meal_id);
      assertExists(meal);
      assert(!meal.ingredientIds.includes('i-pork'));
      assert(!meal.ingredientIds.includes('i-gelatin'));
      assert(m.servings.every((s) => s.portion_id));
    }
    // Children never get a reduced (standard adult) portion and get safe foods noted.
    const notes = meals.map((m) => m.notes ?? '').join(' ');
    assert(notes.includes('Safe food on the side for Ibrahim'));
    assert(state.weeks[0]?.week.recommendations.length);
    assert(usage.some((u) => u.route_key === 'plan.generate'));
    assert(state.audits.includes('update:meal_plans'));
  },
);

Deno.test(
  'the model can only pick candidate refs: junk and unknown refs are repaired then fall back',
  async () => {
    let calls = 0;
    const { handler, bg, state, catalog } = setup({
      script: (req, model) => {
        if (model !== 'model-plan.generate') return undefined;
        calls++;
        // Unknown refs everywhere, twice: the worker must fall back to the engine.
        return text(selection(req, () => 'c99', SAFE_RATIONALE));
      },
    });
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    await bg.drain();
    const plan = state.plans.get(meal_plan_id);
    assertEquals(plan?.status, 'draft');
    assertEquals(calls, 2); // first answer plus one repair round
    const engine = (plan?.generation_meta as { engine?: { fallback_slots: number } }).engine;
    assert((engine?.fallback_slots ?? 0) > 0);
    for (const m of state.meals.get(meal_plan_id) ?? []) assert(catalog.meals.has(m.meal_id));
  },
);

Deno.test('provider outage: the deterministic engine still produces a draft', async () => {
  const { handler, bg, state } = setup({
    script: (_req, model) =>
      model === 'model-plan.generate' ? new AIError('AUTH', 'down') : undefined,
  });
  const res = await handler(post({}));
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  await bg.drain();
  assertEquals(state.plans.get(meal_plan_id)?.status, 'draft');
  assertEquals(state.meals.get(meal_plan_id)?.length, 28);
});

Deno.test(
  'a rationale that sets a calorie number for the family is replaced by the template',
  async () => {
    const { handler, bg, state } = setup({
      script: (req, model) =>
        model === 'model-plan.generate'
          ? text(
              selection(
                req,
                (_s, r) => r[0] ?? 'c1',
                'Ibrahim should eat 1200 kcal a day to lose weight.',
              ),
            )
          : undefined,
    });
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    await bg.drain();
    const plan = state.plans.get(meal_plan_id);
    assertEquals(plan?.status, 'draft');
    assert(!/kcal|lose weight/i.test(plan?.rationale ?? ''), plan?.rationale ?? '');
    assert((plan?.rationale ?? '').includes('Thuluth plate'));
  },
);

Deno.test('peanut-allergic child: no meal in the plan contains peanuts', async () => {
  const members = FAMILY.map((m) =>
    m.id === IBRAHIM
      ? {
          ...m,
          allergies: [
            {
              allergen_code: 'peanuts',
              severity: 'anaphylactic' as const,
              kind: 'allergy' as const,
            },
          ],
        }
      : m,
  );
  const { handler, bg, state, catalog } = setup({
    members,
    // Adversarial: always the last candidate.
    script: (req, model) =>
      model === 'model-plan.generate'
        ? text(selection(req, (_s, r) => r[r.length - 1] ?? 'c1', SAFE_RATIONALE))
        : undefined,
  });
  const res = await handler(post({}));
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  await bg.drain();
  const meals = state.meals.get(meal_plan_id) ?? [];
  assertEquals(meals.length, 28);
  for (const m of meals) {
    const meal = catalog.meals.get(m.meal_id);
    assertExists(meal);
    assert(!mealAllergenCodes(meal, catalog).has('peanuts'), meal.title);
  }
  assert(!meals.some((m) => m.meal_id === mealId('s-peanut')));
});

Deno.test('safety stop: an open child red flag fails the plan with SAFETY_ESCALATION', async () => {
  const { handler, bg, state } = setup({
    assessments: [
      {
        id: 'a1',
        family_member_id: IBRAHIM,
        risk_flags: ['red_flag.child_rapid_weight_loss'],
        target_kcal: null,
      },
    ],
    openSafety: [IBRAHIM],
  });
  const res = await handler(post({}));
  assertEquals(res.status, 202);
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  await bg.drain();
  const plan = state.plans.get(meal_plan_id);
  assertEquals(plan?.status, 'failed');
  assertEquals(plan?.generation_progress.error_code, 'SAFETY_ESCALATION');
  const esc = plan?.generation_progress.escalation as {
    recommend: string;
    family_member_id: string;
  };
  assertEquals(esc.recommend, 'see_pediatrician');
  assertEquals(esc.family_member_id, IBRAHIM);
  assertEquals(state.safety[0]?.source, 'plan_generation');
  assertEquals(state.meals.get(meal_plan_id), undefined);
});

Deno.test(
  'free tier: first plan is full generation; multi-week and other kinds need Premium',
  async () => {
    const { handler, state } = setup({ premium: false });
    const multi = await handler(post({ week_count: 2 }));
    assertEquals(multi.status, 402);
    assertEquals(
      ((await multi.json()) as { error: { code: string } }).error.code,
      'PREMIUM_REQUIRED',
    );
    const kind = await handler(post({ kind: 'growth' }));
    assertEquals(kind.status, 402);
    const first = await handler(post({}));
    assertEquals(first.status, 202);
    const body = (await first.json()) as { mode: string; meal_plan_id: string };
    assertEquals(body.mode, 'full');
    assertEquals(
      (state.plans.get(body.meal_plan_id)?.generation_meta as unknown as GenerationMeta).tier,
      'free',
    );
  },
);

Deno.test(
  'free tier with an active plan: PLAN_ALREADY_ACTIVE unless replace_active, then template mode',
  async () => {
    const active = activePlan('00000000-0000-4000-e000-00000000000a');
    const { handler, bg, state } = setup({ premium: false, plans: [active] });
    const blocked = await handler(post({}));
    assertEquals(blocked.status, 409);
    const err = (await blocked.json()) as { error: { code: string; details: { limit: number } } };
    assertEquals(err.error.code, 'PLAN_ALREADY_ACTIVE');
    assertEquals(err.error.details.limit, 1);

    const res = await handler(post({ replace_active: true }));
    assertEquals(res.status, 202);
    const body = (await res.json()) as { mode: string; meal_plan_id: string };
    assertEquals(body.mode, 'template_personalize');
    assertEquals(state.plans.get(active.id)?.status, 'archived');
    await bg.drain();
    const plan = state.plans.get(body.meal_plan_id);
    assertEquals(plan?.status, 'draft');
    const themes = plan?.weekly_themes as Array<{ template_key: string }>;
    assert(themes[0]?.template_key.startsWith('pk_t2_'));
    assertEquals(state.meals.get(body.meal_plan_id)?.length, 28);
  },
);

Deno.test('consents: child_data is required when the plan covers a minor', async () => {
  const { handler } = setup({ consents: ['ai_processing', 'health_data'] });
  const res = await handler(post({}));
  assertEquals(res.status, 403);
  const body = (await res.json()) as { error: { code: string; details: { consents: string[] } } };
  assertEquals(body.error.code, 'CONSENT_REQUIRED');
  assertEquals(body.error.details.consents, ['child_data']);
});

Deno.test('kill switch, start date window, role and rate limit', async () => {
  const off = setup({ flags: { 'plan.generate.enabled': false } });
  const disabled = await off.handler(post({}));
  assertEquals(
    ((await disabled.json()) as { error: { code: string } }).error.code,
    'FEATURE_DISABLED',
  );

  const { handler } = setup();
  const late = await handler(post({ start_date: '2026-11-30' }));
  assertEquals(late.status, 400);
  const past = await handler(post({ start_date: '2026-10-01' }));
  assertEquals(past.status, 400);
  const viewer = await handler(post({}, { jwt: 'viewer' }));
  assertEquals(viewer.status, 403);
  const ok = await handler(post({}));
  assertEquals(ok.status, 202);
  const burst = await handler(post({}));
  assertEquals(burst.status, 429);
  assertEquals(((await burst.json()) as { error: { code: string } }).error.code, 'RATE_LIMITED');
});

Deno.test('idempotency: the same key replays the 202 without a second plan', async () => {
  const { handler, state } = setup();
  const a = await handler(post({}, { key: 'same-key-0001' }));
  const b = await handler(post({}, { key: 'same-key-0001' }));
  assertEquals(a.status, 202);
  assertEquals(b.status, 202);
  assertEquals(b.headers.get('idempotent-replayed'), 'true');
  assertEquals(state.plans.size, 1);
  const reused = await handler(post({ week_count: 2 }, { key: 'same-key-0001' }));
  assertEquals(
    ((await reused.json()) as { error: { code: string } }).error.code,
    'IDEMPOTENCY_KEY_REUSED',
  );
});

Deno.test('ai.plan.enabled off: no model call, the engine plans alone', async () => {
  const { handler, bg, state, provider } = setup({ flags: { 'ai.plan.enabled': false } });
  const res = await handler(post({}));
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  await bg.drain();
  assertEquals(state.plans.get(meal_plan_id)?.status, 'draft');
  assertEquals(provider.calls.length, 0);
});

Deno.test(
  'worker route: x-internal-secret required; processes a plan by id or the next message',
  async () => {
    const { handler, state } = setup();
    const denied = await handler(worker({}, null));
    assertEquals(denied.status, 401);
    const wrong = await handler(worker({}, 'nope'));
    assertEquals(wrong.status, 401);

    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    const run = await handler(worker({}));
    assertEquals(run.status, 200);
    assertEquals(await run.json(), { processed: 1, rescheduled: false });
    assertEquals(state.plans.get(meal_plan_id)?.status, 'draft');
    // A second run on the same plan is a no-op (already claimed and finished).
    const again = await handler(worker({ meal_plan_id }));
    assertEquals(await again.json(), { processed: 0, rescheduled: false });
  },
);

Deno.test('premium 2-week plan: both weeks written, weekly red-meat limit holds', async () => {
  const { handler, bg, state, catalog } = setup();
  const res = await handler(post({ week_count: 2 }));
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  await bg.drain();
  const plan = state.plans.get(meal_plan_id);
  assertEquals(plan?.status, 'draft');
  assertEquals(plan?.generation_progress.completed_weeks, 2);
  const meals = state.meals.get(meal_plan_id) ?? [];
  assertEquals(meals.length, 56);
  assertEquals(
    state.weeks.map((w) => w.week.week),
    [1, 2],
  );
  const beefDinners = meals.filter(
    (m) =>
      m.meal_type === 'dinner' && catalog.meals.get(m.meal_id)?.ingredientIds.includes('i-beef'),
  );
  assert(beefDinners.length <= 6);
});

const withUnresolvedAllergy = FAMILY.map((m) =>
  m.id === IBRAHIM ? { ...m, unresolved_allergy_ids: ['00000000-0000-4000-a110-000000000001'] } : m,
);

Deno.test(
  'fail closed: an allergy whose allergen code does not resolve fails the plan, naming the member',
  async () => {
    const { handler, bg, state } = setup({ members: withUnresolvedAllergy });
    const res = await handler(post({}));
    assertEquals(res.status, 202);
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    await bg.drain();
    const plan = state.plans.get(meal_plan_id);
    assertEquals(plan?.status, 'failed');
    assertEquals(plan?.generation_progress.error_code, 'AI_OUTPUT_INVALID');
    const detail = plan?.generation_progress.detail as {
      reason: string;
      family_member_ids: string[];
      members: Array<{ name: string }>;
    };
    assertEquals(detail.reason, 'unresolved_allergy');
    assertEquals(detail.family_member_ids, [IBRAHIM]);
    assertEquals(detail.members[0]?.name, 'Ibrahim');
    assert((plan?.failure_reason ?? '').includes('Ibrahim'));
    assertEquals(state.meals.get(meal_plan_id), undefined);
  },
);

Deno.test('replace_active: a failed replacement restores the previous plan to active', async () => {
  const active = activePlan('00000000-0000-4000-e000-00000000000b');
  const { handler, bg, state } = setup({
    premium: false,
    plans: [active],
    members: withUnresolvedAllergy,
  });
  const res = await handler(post({ replace_active: true }));
  assertEquals(res.status, 202);
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  assertEquals(state.plans.get(active.id)?.status, 'archived');
  assertEquals(
    (state.plans.get(meal_plan_id)?.generation_meta as unknown as GenerationMeta).replaced_plan_id,
    active.id,
  );
  await bg.drain();
  assertEquals(state.plans.get(meal_plan_id)?.status, 'failed');
  assertEquals(state.plans.get(active.id)?.status, 'active');
});

Deno.test('replace_active: no restore when another plan became active meanwhile', async () => {
  const active = activePlan('00000000-0000-4000-e000-00000000000c');
  const { handler, bg, state } = setup({
    premium: false,
    plans: [active],
    members: withUnresolvedAllergy,
  });
  const res = await handler(post({ replace_active: true }));
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  const other = activePlan('00000000-0000-4000-e000-00000000000d');
  state.plans.set(other.id, other);
  await bg.drain();
  assertEquals(state.plans.get(meal_plan_id)?.status, 'failed');
  assertEquals(state.plans.get(active.id)?.status, 'archived');
  assertEquals(state.plans.get(other.id)?.status, 'active');
});

// ---- Sprint 4: plan_ready / plan_failed notifications and the generation sweeper ------------------

const minutesAgo = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

Deno.test(
  'plan_ready: a finished generation notifies the requester, lock-screen safe',
  async () => {
    const { handler, bg, state } = setup();
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    await bg.drain();
    assertEquals(state.plans.get(meal_plan_id)?.status, 'draft');
    assertEquals(state.notifications.length, 1);
    const n = state.notifications[0]!;
    assertEquals(n.kind, 'plan_ready');
    assertEquals(n.user_id, OWNER);
    assertEquals(n.household_id, HH);
    assertEquals(n.dedupe_key, `plan_ready:${meal_plan_id}`);
    assertEquals(n.title, 'Your meal plan is ready');
    assertEquals(n.data.route, `thuluth://plan/${meal_plan_id}`);
    assertEquals(n.scheduled_for, NOW.toISOString());
  },
);

Deno.test(
  'plan_failed: a failed generation notifies without naming the member or the reason',
  async () => {
    const { handler, bg, state } = setup({ members: withUnresolvedAllergy });
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    await bg.drain();
    assertEquals(state.plans.get(meal_plan_id)?.status, 'failed');
    assertEquals(
      state.notifications.map((n) => n.kind),
      ['plan_failed'],
    );
    const n = state.notifications[0]!;
    const text = `${n.title} ${n.body}`.toLowerCase();
    assert(!text.includes('ibrahim') && !text.includes('allerg'), text);
    assertEquals(n.data.route, `thuluth://plan/${meal_plan_id}`);
  },
);

Deno.test(
  'sweeper: a plan stalled mid-generation for 15 minutes is re-queued and finished',
  async () => {
    const { handler, state } = setup();
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    const plan = state.plans.get(meal_plan_id)!;
    // The worker claimed it, then died.
    plan.generation_progress = { ...plan.generation_progress, phase: 'generating', attempt: 1 };
    plan.updated_at = minutesAgo(20);
    state.enqueued.length = 0;
    const run = await handler(worker({}));
    assertEquals(await run.json(), { processed: 0, rescheduled: true });
    assertEquals(plan.status, 'draft', 'without pgmq the sweeper runs one plan inline');
    assertEquals(plan.generation_progress.attempt, 2);
    // The re-queued message is then read in the same run, finds the plan done, and is acked.
    assertEquals(state.enqueued, []);
    assertEquals(state.acked, [1]);
    assertEquals(
      state.notifications.map((n) => n.kind),
      ['plan_ready'],
    );
  },
);

Deno.test(
  'sweeper: after 3 attempts a stalled plan fails with AI_UNAVAILABLE and restores the replaced plan',
  async () => {
    const active = activePlan('00000000-0000-4000-e000-00000000000e');
    const { handler, state } = setup({ premium: false, plans: [active] });
    const res = await handler(post({ replace_active: true }));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    assertEquals(state.plans.get(active.id)?.status, 'archived');
    const plan = state.plans.get(meal_plan_id)!;
    plan.generation_progress = { ...plan.generation_progress, phase: 'validating', attempt: 3 };
    plan.updated_at = minutesAgo(16);
    state.enqueued.length = 0;
    const run = await handler(worker({}));
    assertEquals(await run.json(), { processed: 0, rescheduled: false });
    assertEquals(plan.status, 'failed');
    assertEquals(plan.generation_progress.error_code, 'AI_UNAVAILABLE');
    assertEquals(state.plans.get(active.id)?.status, 'active');
    assertEquals(
      state.notifications.map((n) => n.kind),
      ['plan_failed'],
    );
  },
);

Deno.test(
  'worker: a message read more than 3 times fails its plan (04 §5.3) and is acked',
  async () => {
    const { handler, state } = setup();
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    state.readCt.set(meal_plan_id, 4);
    const run = await handler(worker({}));
    assertEquals(await run.json(), { processed: 0, rescheduled: false });
    const plan = state.plans.get(meal_plan_id)!;
    assertEquals(plan.status, 'failed');
    assertEquals(plan.generation_progress.error_code, 'AI_UNAVAILABLE');
    assertEquals((plan.generation_progress.detail as { read_ct: number }).read_ct, 4);
    assertEquals(state.acked, [1]);
  },
);

Deno.test(
  'worker: a redelivered message resumes a dead run, but waits while the plan is still moving',
  async () => {
    const { handler, state } = setup();
    const res = await handler(post({}));
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    const plan = state.plans.get(meal_plan_id)!;
    plan.generation_progress = { ...plan.generation_progress, phase: 'generating', attempt: 1 };
    plan.updated_at = minutesAgo(1);
    state.readCt.set(meal_plan_id, 2);
    const busy = await handler(worker({}));
    assertEquals(await busy.json(), { processed: 0, rescheduled: true });
    assertEquals(plan.status, 'generating');
    assertEquals(state.acked, [], 'left for redelivery');

    state.enqueued.push(meal_plan_id);
    plan.updated_at = minutesAgo(6);
    const resumed = await handler(worker({}));
    assertEquals(await resumed.json(), { processed: 1, rescheduled: false });
    assertEquals(plan.status, 'draft');
    assertEquals(state.acked, [1]);
  },
);

// ---- S5-14 entitlement gates (17 §10.3, FR-SUB-06) -------------------------------------------

Deno.test('free read-only household: PREMIUM_REQUIRED before any plan row', async () => {
  const { handler, state } = setup({ premium: false });
  state.readOnly = true;
  const res = await handler(post({ week_count: 1 }));
  assertEquals(res.status, 402);
  const body = (await res.json()) as { error: { code: string; details: Record<string, unknown> } };
  assertEquals(body.error.code, 'PREMIUM_REQUIRED');
  assertEquals(body.error.details.reason, 'household_read_only');
  assertEquals(state.plans.size, 0);
  // Premium households are never read-only for planning.
  const premium = setup({ premium: true });
  premium.state.readOnly = true;
  assertEquals((await premium.handler(post({ week_count: 1 }))).status, 202);
});

Deno.test(
  'free plan with more than 6 members: the first 6 are planned, the rest excluded',
  async () => {
    const extra = Array.from({ length: 8 - FAMILY.length }, (_, i) => ({
      ...FAMILY[0]!,
      id: `00000000-0000-4000-c000-0000000000${String(90 + i)}`,
      name: `Guest ${i + 1}`,
      goals: [],
    }));
    const members = [...FAMILY, ...extra];
    const { handler, state } = setup({ premium: false, members });
    const res = await handler(post({ week_count: 1 }));
    assertEquals(res.status, 202);
    assertEquals(res.headers.get('x-members-excluded'), '2');
    const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
    const meta = state.plans.get(meal_plan_id)?.generation_meta as unknown as GenerationMeta;
    assertEquals(
      meta.family_member_ids,
      members.slice(0, 6).map((m) => m.id),
    );
    // Premium plans everyone, no header.
    const premium = setup({ premium: true, members });
    const all = await premium.handler(post({ week_count: 1 }));
    assertEquals(all.status, 202);
    assertEquals(all.headers.get('x-members-excluded'), null);
  },
);
