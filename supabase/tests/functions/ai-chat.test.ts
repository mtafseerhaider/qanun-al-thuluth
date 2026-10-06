import { assert, assertEquals, assertFalse, assertMatch } from 'jsr:@std/assert@1';
import { ChatSseEvent } from '@thuluth/shared/contracts/ai-chat.ts';

import {
  createChatHandler,
  resetGlobalCostCache,
  toHistory,
} from '../../functions/ai-chat/handler.ts';
import type { ChatMessageRow } from '../../functions/ai-chat/store.ts';
import {
  AIError,
  chatDeps,
  memoryChatStore,
  PLAN_ID,
  readSse,
  SOURCE_VERIFIED,
  textOut,
  toolOut,
} from './chat-fixtures.ts';
import type { ChatMemoryOptions, ChatScript, SseEvent } from './chat-fixtures.ts';
import { HH, HINA, IBRAHIM, kicker, MARYAM, NOW, OWNER, USMAN, VIEWER } from './plan-fixtures.ts';
import { memoryPlatform } from './platform-fixtures.ts';

function setup(
  opts: ChatMemoryOptions & {
    premium?: boolean;
    script?: ChatScript;
    flags?: Record<string, boolean>;
  } = {},
) {
  resetGlobalCostCache();
  const mem = memoryChatStore(opts);
  const plat = memoryPlatform({
    roles: { [OWNER]: 'owner', [VIEWER]: 'viewer' },
    flags: opts.flags ?? {},
  });
  plat.state.userPremium = opts.premium ?? false;
  const ai = chatDeps(opts.script);
  const bg = kicker();
  const handler = createChatHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    platform: plat.platform,
    entitlements: plat.entitlements,
    store: mem.store,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    kick: bg.kick,
    now: () => NOW,
  });
  return { handler, ...mem, ai, bg, plat: plat.state };
}

let n = 0;
const cmid = () => `00000000-0000-4000-9999-${String(++n).padStart(12, '0')}`;

function chat(
  body: Record<string, unknown> & { text?: string; client_message_id?: string },
  jwt = 'owner',
  signal?: AbortSignal,
): Request {
  const { text = 'What can we have for dinner?', ...rest } = body;
  return new Request('http://local/ai-chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: null,
      household_id: HH,
      client_message_id: cmid(),
      message: { text },
      ...rest,
    }),
    ...(signal ? { signal } : {}),
  });
}

const of = (events: SseEvent[], type: string) => events.filter((e) => e.event === type);
const textOf = (events: SseEvent[]) =>
  of(events, 'message.delta')
    .map((e) => e.data.text)
    .join('');

/** Event order rules from 06 §4.1. */
function assertContract(events: SseEvent[]) {
  assertEquals(events[0]?.event, 'message.start');
  const last = events[events.length - 1];
  assert(last && (last.event === 'done' || last.event === 'error'));
  assertEquals(events.filter((e) => e.event === 'done' || e.event === 'error').length, 1);
  assert(of(events, 'safety').length <= 1);
  assert(of(events, 'follow_up').length <= 1);
  const rank: Record<string, number> = {
    'message.start': 0,
    'tool.call': 1,
    'tool.result': 1,
    'message.delta': 1,
    citation: 2,
    safety: 3,
    follow_up: 4,
    done: 5,
    error: 5,
  };
  for (let i = 1; i < events.length; i++) {
    assert(
      (rank[events[i]!.event] ?? 9) >= (rank[events[i - 1]!.event] ?? 9),
      `order: ${events[i - 1]!.event} then ${events[i]!.event}`,
    );
  }
  events.forEach((e, i) => {
    assertEquals(e.id, i + 1);
    ChatSseEvent.parse({ type: e.event, data: e.data });
  });
}

Deno.test('ai-chat streams a reply with the SSE contract and persists both messages', async () => {
  const t = setup({
    script: () => textOut('A light daal with roti and a salad works well tonight.'),
  });
  const res = await t.handler(chat({}));
  assertEquals(res.status, 200);
  assertMatch(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const events = await readSse(res);
  assertContract(events);
  const start = of(events, 'message.start')[0]!.data;
  assertEquals(start.model_route, 'chat.free');
  assertEquals(start.quota, { limit: 20, remaining: 14 });
  assertMatch(textOf(events), /daal with roti/);
  assertEquals(of(events, 'done')[0]!.data.finish_reason, 'complete');
  assertEquals(t.state.sessions.length, 1);
  const [user, assistant] = t.state.messages;
  assertEquals(user?.role, 'user');
  assertEquals(assistant?.finish_reason, 'complete');
  assertMatch(assistant?.content ?? '', /daal/);
  assertEquals(t.ai.steps.get('chat-free'), 1);
});

Deno.test('ai-chat routes premium users to chat.default and exposes premium tools', async () => {
  let toolNames: string[] = [];
  const t = setup({
    premium: true,
    script: (req) => {
      toolNames = (req.tools ?? []).map((x) => x.name);
      return textOut('Sure.');
    },
  });
  const events = await readSse(await t.handler(chat({})));
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.default');
  assert(toolNames.includes('adjust_meal_plan'));
  assert(toolNames.includes('escalate_to_clinician'));
  assert(toolNames.includes('log_hydration'));
  assert(toolNames.includes('log_fasting'));
  // Tools without backing data are never offered.
  assertFalse(toolNames.includes('generate_meal_plan'));
});

Deno.test('ai-chat message.start announces the route the turn is served on', async () => {
  // A premium greeting is a light turn: served by chat.free, and announced as chat.free.
  let t = setup({ premium: true, script: () => textOut('Wa alaikum assalam!') });
  let events = await readSse(await t.handler(chat({ text: 'Assalamu alaikum!' })));
  assertContract(events);
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.free');
  assertEquals(t.ai.steps.get('chat-free'), 1);
  assertFalse(t.ai.steps.has('chat-default'));
  assertEquals(
    t.ai.usage.filter((u) => u.route_key.startsWith('chat.')).map((u) => u.route_key),
    ['chat.free'],
  );

  // A premium household question stays on chat.default and says so.
  t = setup({ premium: true, script: () => textOut('Sure.') });
  events = await readSse(await t.handler(chat({ text: 'How much rice for Hina?' })));
  assertContract(events);
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.default');
  assertFalse(t.ai.steps.has('chat-free'));

  // A model failure after routing still opens with message.start (the route tried), then error.
  t = setup({ premium: true, script: () => new AIError('OVERLOADED', 'busy') });
  events = await readSse(await t.handler(chat({ text: 'Assalamu alaikum!' })));
  assertContract(events);
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.free');
  assertEquals(of(events, 'error').length, 1);
});

Deno.test('ai-chat free users do not see premium tools', async () => {
  let toolNames: string[] = [];
  const t = setup({
    script: (req) => {
      toolNames = (req.tools ?? []).map((x) => x.name);
      return textOut('Sure.');
    },
  });
  await readSse(await t.handler(chat({})));
  assertFalse(toolNames.includes('adjust_meal_plan'));
  assert(toolNames.includes('search_meals'));
});

Deno.test(
  'ai-chat cites only verified sources retrieved this turn and strips bare markers',
  async () => {
    const t = setup({
      script: (_req, _model, step) =>
        step === 0
          ? toolOut('search_islamic_sources', { query: 'eating a third of the stomach' })
          : textOut(
              'Fill a third with food, a third with drink and leave a third for breath [[src:tirmidhi-2380]]. Another narration praises honey [[src:unverified-1]]. Doctors agree [7].',
            ),
    });
    const events = await readSse(await t.handler(chat({ text: 'What is the rule of thirds?' })));
    assertContract(events);
    const cites = of(events, 'citation');
    assertEquals(cites.length, 1);
    assertEquals(cites[0]!.data.ref_id, SOURCE_VERIFIED);
    assertEquals(cites[0]!.data.marker, 1);
    const text = textOf(events);
    assertMatch(text, /breath \[1\]/);
    assertFalse(/\[7\]|\[\[|unverified/i.test(text));
    assertEquals(of(events, 'tool.call')[0]!.data.name, 'search_islamic_sources');
    assertEquals(of(events, 'tool.result')[0]!.data.ok, true);
    const stored = t.state.messages.find((m) => m.role === 'assistant')!;
    assert(stored.safety_flags.includes('citation_unresolved'));
  },
);

Deno.test(
  'ai-chat crisis input gets the template with Pakistan numbers and no model call',
  async () => {
    const t = setup({ script: () => textOut('should not be used') });
    const events = await readSse(
      await t.handler(chat({ text: 'My son is not breathing properly' })),
    );
    assertContract(events);
    const text = textOf(events);
    assertMatch(text, /1122/);
    assertMatch(text, /115/);
    const safety = of(events, 'safety')[0]!.data;
    assertEquals(safety.action, 'escalate');
    assertEquals(of(events, 'done')[0]!.data.finish_reason, 'escalated');
    assertEquals(t.ai.steps.get('chat-free'), undefined);
    assertEquals(t.state.safety.length, 1);
    assertEquals(t.state.safety[0]!.urgency, 'emergency_now');
    assertEquals(t.state.safety[0]!.source, 'chat');
    assertEquals(t.state.safety[0]!.chat_message_id, t.state.messages[1]!.id);
  },
);

Deno.test(
  'ai-chat hard red flag (insulin + fasting) refers to a clinician without planning',
  async () => {
    const t = setup({ script: () => textOut('should not be used') });
    const events = await readSse(
      await t.handler(chat({ text: 'Usman takes insulin, can he fast all of Ramadan?' })),
    );
    assertEquals(of(events, 'safety')[0]!.data.action, 'escalate');
    assertEquals(t.ai.steps.get('chat-free'), undefined);
    assertEquals(t.state.safety[0]!.category, 'diabetes_fasting_risk');
  },
);

Deno.test('ai-chat never shows a child energy number', async () => {
  const t = setup({
    script: (req, _m, step) => {
      if (step === 0) return toolOut('calculate_energy_needs', { familyMemberId: IBRAHIM });
      // A misbehaving model that copies the internal estimate into the reply.
      const toolMsg = req.messages.at(-1)?.content[0];
      const raw = toolMsg?.type === 'tool_result' ? toolMsg.content : '';
      assertFalse(/\d{3,4}/.test(raw), 'tool result for a child carries no kcal');
      return textOut('Ibrahim needs about 1700 kcal a day. Offer him a variety of foods.');
    },
  });
  const events = await readSse(await t.handler(chat({ text: 'How much should Ibrahim eat?' })));
  const text = textOf(events);
  assertFalse(/kcal|calorie|\b1[0-9]{3}\b/i.test(text), text);
  assertEquals(of(events, 'safety')[0]?.data.notice_key, 'safety.notice.child_no_restriction');
});

Deno.test('ai-chat adult energy numbers come from the calculator and are grounded', async () => {
  const t = setup({
    script: (req, _m, step) => {
      if (step === 0) return toolOut('calculate_energy_needs', { familyMemberId: HINA });
      const part = req.messages.at(-1)?.content[0];
      const data = JSON.parse(part?.type === 'tool_result' ? part.content : '{}').data;
      return textOut(
        `Hina needs about ${data.targetKcal} kcal a day while breastfeeding. Some say 5000 kcal is fine.`,
      );
    },
  });
  const events = await readSse(await t.handler(chat({ text: 'How much should Hina eat?' })));
  const text = textOf(events);
  assertMatch(text, /Hina needs about \d+ kcal/);
  assertFalse(/5000/.test(text));
  assertMatch(text, /not medical advice|medical/i);
});

Deno.test('ai-chat write tools return a proposal card and never write', async () => {
  const t = setup({
    premium: true,
    script: (_r, _m, step) =>
      step === 0
        ? toolOut('adjust_meal_plan', {
            mealPlanId: PLAN_ID,
            changeRequest: 'No fish on Friday',
            userConfirmed: false,
          })
        : textOut('I prepared the change. Tap Confirm to apply it.'),
  });
  const events = await readSse(await t.handler(chat({ text: 'Remove fish on Friday' })));
  assertContract(events);
  const result = of(events, 'tool.result')[0]!.data;
  assertEquals((result.card as Record<string, unknown>).kind, 'plan_adjustment_proposal');
  assertEquals((result.card as Record<string, unknown>).meal_plan_id, PLAN_ID);
});

Deno.test('ai-chat log_meal returns a log_proposal card', async () => {
  const t = setup({
    script: (_r, _m, step) =>
      step === 0
        ? toolOut('log_meal', {
            familyMemberId: MARYAM,
            eatenAt: '2026-10-06T13:00:00+05:00',
            mealType: 'lunch',
            description: 'Plain rice and daal',
          })
        : textOut('Ready to save when you tap Save.'),
  });
  const events = await readSse(await t.handler(chat({ text: 'Log Maryam lunch: rice and daal' })));
  const card = of(events, 'tool.result')[0]!.data.card as Record<string, unknown>;
  assertEquals(card.kind, 'log_proposal');
  assertEquals(card.table, 'meal_logs');
});

Deno.test('ai-chat search_meals only returns meals safe for the members', async () => {
  let resultMeals: Array<{ title: string }> = [];
  const t = setup({
    script: (req, _m, step) => {
      if (step === 0) return toolOut('search_meals', { forFamilyMemberIds: [USMAN, IBRAHIM] });
      const part = req.messages.at(-1)?.content[0];
      resultMeals = JSON.parse(part?.type === 'tool_result' ? part.content : '{}').data.meals;
      return textOut('Here are some options.');
    },
  });
  await readSse(await t.handler(chat({ text: 'Dinner ideas for Usman and Ibrahim' })));
  assert(resultMeals.length > 0);
});

Deno.test('ai-chat estimate_cost reads the latest grocery list', async () => {
  const t = setup({
    script: (req, _m, step) => {
      if (step === 0)
        return toolOut('estimate_cost', { target: { kind: 'meal_plan', mealPlanId: PLAN_ID } });
      const part = req.messages.at(-1)?.content[0];
      const data = JSON.parse(part?.type === 'tool_result' ? part.content : '{}').data;
      return textOut(`This week costs about ${data.estimatedTotal}.`);
    },
  });
  const events = await readSse(await t.handler(chat({ text: 'How much is this week?' })));
  assertMatch(textOf(events), /12,500/);
});

Deno.test('ai-chat replays a completed client_message_id without a model call', async () => {
  const t = setup({ script: () => textOut('Try khichdi tonight.') });
  const id = cmid();
  const first = await readSse(await t.handler(chat({ client_message_id: id })));
  const sessionId = of(first, 'message.start')[0]!.data.session_id;
  const before = t.ai.steps.get('chat-free');
  const res = await t.handler(chat({ client_message_id: id, session_id: sessionId }));
  assertEquals(res.headers.get('idempotent-replayed'), 'true');
  const again = await readSse(res);
  assertContract(again);
  assertEquals(of(again, 'message.delta').length, 1);
  assertEquals(textOf(again), textOf(first));
  assertEquals(of(again, 'done')[0]!.data.replayed, true);
  assertEquals(t.ai.steps.get('chat-free'), before);
  assertEquals(t.state.messages.length, 2);
});

Deno.test('ai-chat replays even when the retry has no session id yet', async () => {
  const t = setup({ script: () => textOut('Try khichdi tonight.') });
  const id = cmid();
  await readSse(await t.handler(chat({ client_message_id: id })));
  const again = await readSse(await t.handler(chat({ client_message_id: id })));
  assertEquals(of(again, 'done')[0]!.data.replayed, true);
  assertEquals(t.state.sessions.length, 1);
});

Deno.test('ai-chat model failure ends with an error event; the retry regenerates', async () => {
  let fail = true;
  const t = setup({
    script: () => (fail ? new AIError('OVERLOADED', 'busy') : textOut('Back now: try daal.')),
  });
  const id = cmid();
  const events = await readSse(await t.handler(chat({ client_message_id: id })));
  assertContract(events);
  assertEquals(of(events, 'error')[0]!.data.code, 'AI_UNAVAILABLE');
  assertEquals(t.state.messages[1]!.finish_reason, 'error');
  fail = false;
  const retry = await readSse(await t.handler(chat({ client_message_id: id })));
  assertEquals(of(retry, 'done')[0]!.data.replayed, false);
  assertMatch(textOf(retry), /daal/);
  assertEquals(t.state.messages.length, 2);
  assertEquals(t.state.messages[1]!.finish_reason, 'complete');
});

Deno.test('ai-chat cancellation stops the loop and stores a cancelled reply', async () => {
  const ac = new AbortController();
  const t = setup({
    script: (_r, _m, step) => {
      if (step === 0) {
        ac.abort();
        return toolOut('get_household_snapshot', {});
      }
      return textOut('never sent');
    },
  });
  const res = await t.handler(chat({}, 'owner', ac.signal));
  const events = await readSse(res).catch(() => [] as SseEvent[]);
  const done = of(events, 'done')[0];
  if (done) assertEquals(done.data.finish_reason, 'cancelled');
  assertEquals(t.state.messages[1]!.finish_reason, 'cancelled');
  assertEquals(t.ai.steps.get('chat-free'), 1);
});

Deno.test('ai-chat pre-stream errors use the JSON envelope', async () => {
  // Free tier with a photo.
  let t = setup();
  let res = await t.handler(
    chat({
      message: {
        text: 'What is this?',
        attachments: [{ kind: 'image', storage_path: `${HH}/s/x.jpg`, mime: 'image/jpeg' }],
      },
    }),
  );
  assertEquals(res.status, 402);
  assertEquals((await res.json()).error.code, 'PREMIUM_REQUIRED');

  // Missing consent.
  t = setup({ consents: ['ai_processing', 'health_data'] });
  res = await t.handler(chat({}));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.details.consents, ['child_data']);

  // Daily quota.
  t = setup({ quota: { allowed: false, remaining: 0, degrade_to: null } });
  res = await t.handler(chat({}));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, 'QUOTA_EXCEEDED');

  // Kill switch.
  t = setup({ flags: { 'ai.chat.enabled': false } });
  res = await t.handler(chat({}));
  assertEquals((await res.json()).error.code, 'FEATURE_DISABLED');

  // Not a member.
  t = setup();
  res = await t.handler(chat({}, 'nobody'));
  assertEquals(res.status, 401);
});

Deno.test('ai-chat burst limit returns RATE_LIMITED', async () => {
  const t = setup();
  for (let i = 0; i < 6; i++) await readSse(await t.handler(chat({})));
  const res = await t.handler(chat({}));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, 'RATE_LIMITED');
});

Deno.test('ai-chat cost ceilings: free blocked, premium degraded to chat.free', async () => {
  let t = setup({ costToday: { user: 60_000 } });
  let res = await t.handler(chat({}));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.details.reason, 'daily_cost');

  t = setup({ premium: true, costToday: { user: 2_000_000 } });
  let events = await readSse(await t.handler(chat({})));
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.free');

  t = setup({ costToday: { global: 200_000_000 } });
  res = await t.handler(chat({}));
  assertEquals(res.status, 503);

  t = setup({ premium: true, rules: { global_daily_usd_micros: 10 }, costToday: { global: 11 } });
  events = await readSse(await t.handler(chat({})));
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.free');

  // Monthly ceiling from ai_quota_check.
  t = setup({ premium: true, quota: { allowed: true, remaining: 100, degrade_to: 'chat.free' } });
  events = await readSse(await t.handler(chat({})));
  assertEquals(of(events, 'message.start')[0]!.data.model_route, 'chat.free');
});

Deno.test(
  'ai-chat premium memory: extracted in the background, health facts dropped, recalled later',
  async () => {
    const t = setup({
      premium: true,
      script: (_r, model) =>
        model === 'summarize'
          ? textOut(
              JSON.stringify({
                facts: [
                  {
                    fact: 'Family prefers desi breakfast on weekends',
                    member: null,
                    kind: 'preference',
                    confidence: 0.9,
                  },
                  {
                    fact: 'Usman has diabetes',
                    member: 'Usman',
                    kind: 'context',
                    confidence: 0.95,
                  },
                ],
              }),
            )
          : textOut('Weekend parathas sound lovely.'),
    });
    await readSse(await t.handler(chat({ text: 'We like desi breakfast on weekends' })));
    assertEquals(t.bg.pending, 1);
    await t.bg.drain();
    assertEquals(
      t.state.memories.map((m) => m.fact),
      ['Family prefers desi breakfast on weekends'],
    );
    assert(t.state.memories[0]!.expires_at > NOW.toISOString());

    let systemText = '';
    const t2 = { ...t };
    t2.ai.provider.calls.length = 0;
    await readSse(await t.handler(chat({ text: 'Breakfast ideas?' })));
    systemText = t.ai.provider.calls
      .filter((c) => c.model === 'chat-premium')
      .flatMap((c) => c.req.system.map((p) => (p.type === 'text' ? p.text : '')))
      .join('\n');
    assertMatch(systemText, /<memories>[\s\S]*desi breakfast/);
  },
);

Deno.test('ai-chat memory stays off for free users and when the user turned it off', async () => {
  let t = setup({ script: () => textOut('ok') });
  await readSse(await t.handler(chat({})));
  assertEquals(t.bg.pending, 0);
  t = setup({ premium: true, memoryEnabled: false, script: () => textOut('ok') });
  await readSse(await t.handler(chat({})));
  assertEquals(t.bg.pending, 0);
});

Deno.test('ai-chat history excludes failed replies and starts with a user turn', () => {
  const row = (
    role: 'user' | 'assistant',
    content: string,
    finish: ChatMessageRow['finish_reason'] = 'complete',
  ) => ({ role, content, finish_reason: finish }) as ChatMessageRow;
  const h = toHistory([
    row('assistant', 'orphan'),
    row('user', 'a'),
    row('assistant', 'failed', 'error'),
    row('user', 'b'),
    row('assistant', 'reply'),
  ]);
  assertEquals(
    h.map((m) => [m.role, m.content[0]?.type === 'text' ? m.content[0].text : '']),
    [
      ['user', 'a\n\nb'],
      ['assistant', 'reply'],
    ],
  );
});

Deno.test('ai-chat follow-up chips are sent after a completed reply', async () => {
  const t = setup({ script: () => textOut('Try daal tonight.') });
  const events = await readSse(await t.handler(chat({})));
  const chips = of(events, 'follow_up')[0]?.data.suggestions as string[] | undefined;
  assert(chips && chips.length > 0 && chips.length <= 3);
  assert(chips.every((c) => c.length <= 80));
});

Deno.test('ai-chat Urdu locale answers the crisis template in Urdu', async () => {
  const t = setup({ locale: 'ur' });
  const events = await readSse(await t.handler(chat({ text: 'mera beta behosh ho gaya hai' })));
  const text = textOf(events);
  assertMatch(text, /1122/);
  assertMatch(text, /[؀-ۿ]/);
});

// ---- S6: get_growth_status and create_exposure_ladder --------------------------------------------

/** The data of the last tool result the model saw. */
function lastToolData(req: { messages: Array<{ content: Array<Record<string, unknown>> }> }) {
  const part = req.messages.at(-1)?.content.find((p) => p.type === 'tool_result');
  return part
    ? (JSON.parse(String(part.content)) as {
        ok: boolean;
        data?: Record<string, unknown>;
        error?: { code: string };
      })
    : null;
}

const growthRow = (d: string, wfa: number, z: number, flags: string[] = []) => ({
  measured_on: d,
  reference: 'who_2007',
  age_months: 96,
  height_for_age_percentile: 40,
  weight_for_age_percentile: wfa,
  bmi_for_age_percentile: 45,
  head_circumference_for_age_percentile: null,
  weight_for_age_z: z,
  height_for_age_z: -0.25,
  flags,
  computed_at: `${d}T10:00:00Z`,
});

Deno.test('ai-chat get_growth_status returns percentiles and alerts, never targets', async () => {
  let seen: ReturnType<typeof lastToolData> = null;
  const t = setup({
    premium: true,
    growth: {
      [IBRAHIM]: [
        growthRow('2026-04-01', 50, 0),
        growthRow('2026-07-01', 25, -0.67),
        growthRow('2026-10-01', 10, -1.28, ['red_flag.crossed_two_major_percentiles']),
      ],
    },
    script: (req, _m, step) => {
      if (step === 0)
        return toolOut('get_growth_status', { familyMemberId: IBRAHIM, includeTrend: true });
      seen = lastToolData(req as never);
      return textOut(
        'Ibrahim has moved from the 50th to the 10th percentile. Aim for 1400 kcal a day so he gains 2 kg.',
      );
    },
  });
  const events = await readSse(await t.handler(chat({ text: 'How is Ibrahim growing?' })));
  assertContract(events);
  const data = seen!.data!;
  assertEquals(data.alerts, ['crossed_two_major_percentiles']);
  assertEquals((data.trend as { direction: string }).direction, 'falling');
  assertEquals(data.seeClinician, true);
  const { instruction: _i, ...rest } = data;
  assertFalse(/kcal|kg|_cm|target/i.test(JSON.stringify(rest)));
  const text = textOf(events);
  assertFalse(/1400|2 kg/.test(text));
});

Deno.test('ai-chat get_growth_status: trend is premium, adults get no growth chart', async () => {
  const seen: Array<ReturnType<typeof lastToolData>> = [];
  const t = setup({
    growth: { [IBRAHIM]: [growthRow('2026-04-01', 50, 0), growthRow('2026-10-01', 48, -0.05)] },
    script: (req, _m, step) => {
      if (step === 0)
        return toolOut('get_growth_status', { familyMemberId: IBRAHIM, includeTrend: true });
      if (step === 1) {
        seen.push(lastToolData(req as never));
        return toolOut('get_growth_status', { familyMemberId: USMAN });
      }
      seen.push(lastToolData(req as never));
      return textOut('His growth line looks steady.');
    },
  });
  const events = await readSse(await t.handler(chat({ text: 'Is Ibrahim growing well?' })));
  assertContract(events);
  assertEquals(seen[0]!.data!.trend, null);
  assertMatch(String(seen[0]!.data!.trendNote), /Premium/);
  assertEquals(seen[1]!.ok, false);
  assertEquals(seen[1]!.error!.code, 'NOT_A_CHILD');
});

Deno.test('ai-chat create_exposure_ladder proposes steps and writes nothing', async () => {
  let seen: ReturnType<typeof lastToolData> = null;
  const t = setup({
    premium: true,
    script: (req, _m, step) => {
      if (step === 0)
        return toolOut('create_exposure_ladder', {
          familyMemberId: MARYAM,
          targetFood: 'cucumber',
          strategy: 'exposure_ladder',
          startStage: 'look',
        });
      seen = lastToolData(req as never);
      return textOut('Here is a gentle plan. Make her finish the cucumber every time.');
    },
  });
  const events = await readSse(await t.handler(chat({ text: 'Help Maryam with cucumber' })));
  assertContract(events);
  const data = seen!.data!;
  assertEquals(data.saved, false);
  assertEquals(data.targetFood, 'Cucumber (kheera)');
  const steps = data.steps as Array<{ stage: string }>;
  assertEquals(steps[0]!.stage, 'look');
  assertEquals(steps.at(-1)!.stage, 'eat_portion');
  const result = of(events, 'tool.result')[0]!.data;
  assertEquals(result.ok, true);
  // The contract has no ladder card kind yet: the card is left off and the stream still validates.
  assertEquals(result.card, undefined);
  // Feeding pressure about a child is removed from the reply.
  assertFalse(/finish the cucumber/i.test(textOf(events)));
  assertEquals(t.state.safety.length, 0);
});

Deno.test('ai-chat create_exposure_ladder refuses an allergen target', async () => {
  const seen: Array<ReturnType<typeof lastToolData>> = [];
  const t = setup({
    premium: true,
    script: (req, _m, step) => {
      if (step === 0)
        return toolOut('create_exposure_ladder', {
          familyMemberId: MARYAM,
          targetFood: 'peanuts',
          strategy: 'food_chaining',
        });
      seen.push(lastToolData(req as never));
      return textOut('Let us pick a different food.');
    },
  });
  // Maryam with a severe peanut allergy in this household.
  t.state.members = t.state.members.map((m) =>
    m.id === MARYAM
      ? { ...m, allergies: [{ allergen_code: 'peanuts', severity: 'severe', kind: 'allergy' }] }
      : m,
  );
  await readSse(await t.handler(chat({ text: 'Ladder for peanuts for Maryam' })));
  assertEquals(seen[0]!.error!.code, 'UNSAFE_TARGET');
});
