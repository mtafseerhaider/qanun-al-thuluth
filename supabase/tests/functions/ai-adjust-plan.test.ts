import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';
import type { ChatRequest } from '@thuluth/ai-core';

import { createAdjustPlanHandler } from '../../functions/ai-adjust-plan/handler.ts';
import { createGeneratePlanHandler } from '../../functions/ai-generate-plan/handler.ts';
import {
  fakeDeps,
  HH,
  HINA,
  IBRAHIM,
  kicker,
  memoryStore,
  NOW,
  OWNER,
  SECRET,
  selection,
  START,
  text,
  userText,
  VIEWER,
} from './plan-fixtures.ts';
import type { MemoryOptions } from './plan-fixtures.ts';

type Edits = Record<string, unknown>;

/** Builds `plan.adjust` edits from the prompt: refs for named ingredients and slots by weekday. */
function editsFrom(req: ChatRequest, build: (p: PromptRefs) => Edits): string {
  const body = userText(req);
  const plan = body.slice(body.indexOf('<plan>') + 6, body.indexOf('</plan>'));
  const lines = plan.trim().split('\n');
  const ingredient = (name: string) => {
    const m = plan.match(new RegExp(`(i\\d+) ${name}`));
    return m?.[1] ?? null;
  };
  const slots = (pred: (line: string) => boolean) =>
    lines.filter(pred).map((l) => l.split(' ')[0] ?? '');
  const family = JSON.parse(
    body.slice(body.indexOf('<family>') + 8, body.indexOf('</family>')),
  ) as Array<{
    ref: string;
    minor: boolean;
  }>;
  return JSON.stringify({
    summary: 'Changed as you asked.',
    ...build({ ingredient, slots, family }),
  });
}

interface PromptRefs {
  ingredient: (name: string) => string | null;
  slots: (pred: (line: string) => boolean) => string[];
  family: Array<{ ref: string; minor: boolean }>;
}

function setup(opts: MemoryOptions & { edits?: (p: PromptRefs) => Edits } = {}) {
  const mem = memoryStore(opts);
  const ai = fakeDeps((req, model) => {
    if (model === 'model-plan.generate') {
      return text(
        selection(req, (_s, r) => r[0] ?? 'c1', 'A balanced family week on the Thuluth plate.'),
      );
    }
    if (model === 'model-plan.adjust') {
      return text(editsFrom(req, opts.edits ?? (() => ({ change_all: true }))));
    }
    return undefined;
  });
  const bg = kicker();
  const verify = async (jwt: string) =>
    jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null;
  const generate = createGeneratePlanHandler({
    verify,
    secrets: () => [SECRET],
    store: mem.store,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    kick: bg.kick,
    now: () => NOW,
  });
  const handler = createAdjustPlanHandler({
    verify,
    store: mem.store,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    kick: bg.kick,
    now: () => NOW,
  });
  return { handler, generate, bg, ...mem, ...ai };
}

let keyN = 0;
const key = () => `adjust-key-${String(++keyN).padStart(4, '0')}`;

/** Generates and activates a plan through the real generate path; returns its id. */
async function activePlan(ctx: ReturnType<typeof setup>, weeks = 1): Promise<string> {
  const premium = ctx.state.premium;
  ctx.state.premium = true;
  const res = await ctx.generate(
    new Request('http://localhost/functions/v1/ai-generate-plan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer owner',
        'content-type': 'application/json',
        'idempotency-key': key(),
      },
      body: JSON.stringify({ household_id: HH, start_date: START, week_count: weeks }),
    }),
  );
  const { meal_plan_id } = (await res.json()) as { meal_plan_id: string };
  await ctx.bg.drain();
  const plan = ctx.state.plans.get(meal_plan_id);
  assertEquals(plan?.status, 'draft');
  if (plan) plan.status = 'active';
  ctx.state.premium = premium;
  ctx.provider.calls.length = 0;
  return meal_plan_id;
}

function post(body: Record<string, unknown>, jwt = 'owner'): Request {
  return new Request('http://localhost/functions/v1/ai-adjust-plan', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      'idempotency-key': key(),
    },
    body: JSON.stringify(body),
  });
}

const week1 = { from_date: '2026-10-12', to_date: '2026-10-18' };

interface Completed {
  status: 'completed';
  meal_plan_id: string | null;
  parent_plan_id: string;
  version: number;
  diff: Array<{
    plan_date: string;
    meal_type: string;
    before: { meal_id: string };
    after: { meal_id: string };
    reason: string;
  }>;
  rationale: string;
}

const adjustCalls = (ctx: ReturnType<typeof setup>) =>
  ctx.provider.calls.filter((c) => c.model === 'model-plan.adjust').length;

Deno.test('free households get PREMIUM_REQUIRED (feature plan.adjust)', async () => {
  const ctx = setup({ premium: false });
  const id = await activePlan(ctx);
  const res = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'No chicken this week', scope: week1 }),
  );
  assertEquals(res.status, 402);
  const body = (await res.json()) as { error: { code: string; details: { feature: string } } };
  assertEquals(body.error.code, 'PREMIUM_REQUIRED');
  assertEquals(body.error.details.feature, 'plan.adjust');
});

Deno.test('child restriction request: SAFETY_ESCALATION before any model call', async () => {
  const ctx = setup({ premium: true });
  const id = await activePlan(ctx);
  const res = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'Make Ibrahim eat less, he needs to lose weight',
      scope: week1,
    }),
  );
  assertEquals(res.status, 422);
  const body = (await res.json()) as {
    error: {
      code: string;
      details: { escalation: { reason: string; family_member_id: string; recommend: string } };
    };
  };
  assertEquals(body.error.code, 'SAFETY_ESCALATION');
  assertEquals(body.error.details.escalation.reason, 'other_clinical');
  assertEquals(body.error.details.escalation.family_member_id, IBRAHIM);
  assertEquals(body.error.details.escalation.recommend, 'see_pediatrician');
  assertEquals(ctx.provider.calls.length, 0);
  assertEquals(ctx.state.safety[0]?.source, 'plan_generation');
  assertEquals(ctx.state.plans.size, 1);
});

Deno.test('child restriction in Urdu and scoped to a child also escalate', async () => {
  const ctx = setup({ premium: true });
  const id = await activePlan(ctx);
  const urdu = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'میرے بیٹے کا کھانا کم کر دیں', scope: week1 }),
  );
  assertEquals(urdu.status, 422);
  const scoped = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'Smaller portions please',
      scope: { ...week1, family_member_ids: [IBRAHIM] },
    }),
  );
  assertEquals(scoped.status, 422);
  assertEquals(adjustCalls(ctx), 0);
});

Deno.test('model-detected restriction of a minor escalates too', async () => {
  const ctx = setup({
    premium: true,
    edits: (p) => ({
      restrict_members: p.family
        .filter((m) => m.minor)
        .map((m) => m.ref)
        .slice(0, 1),
    }),
  });
  const id = await activePlan(ctx);
  const res = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'Adjust things for the school week ahead',
      scope: week1,
    }),
  );
  assertEquals(res.status, 422);
  assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'SAFETY_ESCALATION');
});

Deno.test('dry_run: diff preview of chicken-free Monday and Tuesday, nothing written', async () => {
  const ctx = setup({
    premium: true,
    edits: (p) => ({ avoid_ingredients: [p.ingredient('Chicken')].filter(Boolean) }),
  });
  const id = await activePlan(ctx);
  const before = ctx.state.meals.get(id)?.length;
  const res = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'No chicken on Monday and Tuesday',
      scope: { from_date: '2026-10-12', to_date: '2026-10-13' },
      dry_run: true,
    }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as Completed;
  assertEquals(body.status, 'completed');
  assertEquals(body.meal_plan_id, null);
  assertEquals(body.parent_plan_id, id);
  assertEquals(body.version, 2);
  assert(body.diff.length > 0);
  for (const d of body.diff) {
    assert(d.plan_date <= '2026-10-13');
    const after = ctx.catalog.meals.get(d.after.meal_id);
    assertExists(after);
    assert(!after.ingredientIds.includes('i-chicken'), after.title);
    assert(d.reason.length > 0);
  }
  assertEquals(ctx.state.plans.size, 1);
  assertEquals(ctx.state.meals.get(id)?.length, before);
});

Deno.test('sync adjustment: version 2 draft with parent history preserved', async () => {
  const ctx = setup({
    premium: true,
    edits: (p) => ({ avoid_ingredients: [p.ingredient('Chicken')].filter(Boolean) }),
  });
  const id = await activePlan(ctx);
  const parentMeals = structuredClone(ctx.state.meals.get(id));
  const res = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'No chicken this week', scope: week1 }),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as Completed;
  assertExists(body.meal_plan_id);
  const child = ctx.state.plans.get(body.meal_plan_id);
  assertEquals(child?.status, 'draft');
  assertEquals(child?.version, 2);
  assertEquals(child?.parent_plan_id, id);
  assertEquals(ctx.state.plans.get(id)?.status, 'active');
  assertEquals(ctx.state.meals.get(id), parentMeals);
  const meals = ctx.state.meals.get(body.meal_plan_id) ?? [];
  assertEquals(meals.length, 28);
  for (const m of meals) {
    assert(!ctx.catalog.meals.get(m.meal_id)?.ingredientIds.includes('i-chicken'));
    assertEquals(m.servings.length, 4);
  }
  // A second adjustment of the same parent is refused (linear history).
  const again = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'No beef this week', scope: week1 }),
  );
  assertEquals(again.status, 409);
  assertEquals(((await again.json()) as { error: { code: string } }).error.code, 'CONFLICT');
});

Deno.test(
  'adult change (less rice for the adults) is not escalated and keeps children served',
  async () => {
    const ctx = setup({
      premium: true,
      edits: () => ({ lighter_carbs_for_adults: true, change_all: true }),
    });
    const id = await activePlan(ctx);
    const res = await ctx.handler(
      post({
        meal_plan_id: id,
        change_request: 'Less rice for me and Hina on weekdays',
        scope: { ...week1, family_member_ids: [HINA] },
        dry_run: true,
      }),
    );
    assertEquals(res.status, 200);
    assertEquals(adjustCalls(ctx), 1);
  },
);

Deno.test('a range over 7 days answers 202 and the job writes the new version', async () => {
  const ctx = setup({ premium: true, edits: () => ({ cheaper: true, change_all: true }) });
  const id = await activePlan(ctx, 2);
  const res = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'Make the next two weeks cheaper',
      scope: { from_date: '2026-10-12', to_date: '2026-10-25' },
    }),
  );
  assertEquals(res.status, 202);
  const body = (await res.json()) as { status: string; meal_plan_id: string; plan_status: string };
  assertEquals(body.status, 'accepted');
  assertEquals(body.plan_status, 'generating');
  assertEquals(ctx.bg.pending, 1);
  await ctx.bg.drain();
  const child = ctx.state.plans.get(body.meal_plan_id);
  assertEquals(child?.status, 'draft');
  assertEquals(child?.parent_plan_id, id);
  assertEquals(ctx.state.meals.get(body.meal_plan_id)?.length, 56);
});

Deno.test('clarification, plan state and scope errors', async () => {
  const ctx = setup({
    premium: true,
    edits: () => ({ needs_clarification: true, questions: ['Which days do you mean?'] }),
  });
  const id = await activePlan(ctx);
  const unclear = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'Change it', scope: week1 }),
  );
  assertEquals(unclear.status, 400);
  const u = (await unclear.json()) as { error: { details: { questions: string[] } } };
  assertEquals(u.error.details.questions, ['Which days do you mean?']);

  const outside = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'No fish',
      scope: { from_date: '2026-10-12', to_date: '2026-10-30' },
    }),
  );
  assertEquals(outside.status, 400);

  const plan = ctx.state.plans.get(id);
  if (plan) plan.status = 'generating';
  const busy = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'No fish', scope: week1 }),
  );
  assertEquals(
    ((await busy.json()) as { error: { code: string } }).error.code,
    'PLAN_NOT_ADJUSTABLE',
  );

  const viewer = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'No fish', scope: week1 }, 'viewer'),
  );
  assertEquals(viewer.status, 403);
});

Deno.test('fail closed: an unresolved allergy refuses the adjustment (sync and job)', async () => {
  const ctx = setup({ premium: true, edits: () => ({ cheaper: true, change_all: true }) });
  const id = await activePlan(ctx, 2);
  ctx.state.members = ctx.state.members.map((m) =>
    m.id === HINA ? { ...m, unresolved_allergy_ids: ['00000000-0000-4000-a110-000000000002'] } : m,
  );
  const sync = await ctx.handler(
    post({ meal_plan_id: id, change_request: 'Make it cheaper', scope: week1 }),
  );
  const body = (await sync.json()) as {
    error: { code: string; details: { reason: string; family_member_ids: string[] } };
  };
  assertEquals(body.error.code, 'AI_OUTPUT_INVALID');
  assertEquals(body.error.details.reason, 'unresolved_allergy');
  assertEquals(body.error.details.family_member_ids, [HINA]);
  assertEquals(ctx.state.plans.size, 1);

  const job = await ctx.handler(
    post({
      meal_plan_id: id,
      change_request: 'Make the next two weeks cheaper',
      scope: { from_date: '2026-10-12', to_date: '2026-10-25' },
    }),
  );
  assertEquals(job.status, 202);
  const { meal_plan_id } = (await job.json()) as { meal_plan_id: string };
  await ctx.bg.drain();
  const child = ctx.state.plans.get(meal_plan_id);
  assertEquals(child?.status, 'failed');
  assertEquals(child?.generation_progress.error_code, 'AI_OUTPUT_INVALID');
  assertEquals(
    (child?.generation_progress.detail as { family_member_ids: string[] }).family_member_ids,
    [HINA],
  );
  assertEquals(ctx.state.plans.get(id)?.status, 'active');
});
