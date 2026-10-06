import { describe, expect, it } from 'vitest';

import {
  estimateTokens,
  findUngroundedScripture,
  intentRules,
  resolveCitations,
  CitationRegistry,
  runChatTurn,
  toolsForTier,
  trimHistory,
  TURN_BUDGETS,
} from '../src/agent/index.ts';
import type { TurnArgs } from '../src/agent/index.ts';
import {
  classifyInputRules,
  detectChildWeightRequest,
  detectRedFlagText,
  detectYoungChildFastingRequest,
  findChildRestrictionViolations,
  findRulingAssertions,
  findYoungChildFasting,
  guardOutput,
} from '../src/guardrails/index.ts';
import { toUsageRow } from '../src/metering/usage.ts';
import type { AiUsageInsert } from '../src/metering/usage.ts';
import { anthropicAcceptsSampling, toAnthropicBody } from '../src/providers/anthropic.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import { toGeminiBody } from '../src/providers/gemini.ts';
import { toOpenAiBody } from '../src/providers/openai.ts';
import { normalizeParams, RouteResolver } from '../src/router/route-resolver.ts';
import type { AiModelRouteRow } from '../src/router/route-resolver.ts';
import type { ChatMessage, ChatRequest, ChatResponse, RouteKey } from '../src/types.ts';
import { params, request } from './helpers.ts';

const tools = toolsForTier('free').slice(0, 2);

function withTools(over: Partial<ChatRequest> = {}): ChatRequest {
  return { ...request(), tools, ...over };
}

describe('S7-02 provider request shaping', () => {
  it('caps output at the smaller of the request and the route', () => {
    const route = { ...params, maxOutputTokens: 1500 };
    expect(toAnthropicBody({ ...request(), maxOutputTokens: 400 }, 'm', route).max_tokens).toBe(
      400,
    );
    expect(toAnthropicBody({ ...request(), maxOutputTokens: 4000 }, 'm', route).max_tokens).toBe(
      1500,
    );
    expect(toOpenAiBody({ ...request(), maxOutputTokens: 400 }, 'm', route).max_output_tokens).toBe(
      400,
    );
    const gemini = toGeminiBody({ ...request(), maxOutputTokens: 400 }, route) as {
      generationConfig: { maxOutputTokens: number };
    };
    expect(gemini.generationConfig.maxOutputTokens).toBe(400);
  });

  it('keeps tools (and their cache marker) when tool_choice is none', () => {
    const body = toAnthropicBody(withTools({ toolChoice: 'none' }), 'claude-sonnet-5-5', params);
    const sent = body.tools as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(2);
    expect(sent[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tool_choice).toEqual({ type: 'none' });
    const oa = toOpenAiBody(withTools({ toolChoice: 'none' }), 'gpt', params);
    expect((oa.tools as unknown[]).length).toBe(2);
    expect(oa.tool_choice).toBe('none');
    expect(oa.prompt_cache_key).toBe('thuluth:chat.default:smoke@1:free');
    const g = toGeminiBody(withTools({ toolChoice: 'none' }), params);
    expect(g.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });

  it('marks the conversation tail and never exceeds four breakpoints', () => {
    const req = withTools({
      system: [
        { type: 'text', text: 'system', cache: true },
        { type: 'text', text: 'snapshot', cache: true },
        { type: 'text', text: 'memories', cache: true },
      ],
      cacheTail: true,
    });
    const body = toAnthropicBody(req, 'claude-sonnet-5-5', params);
    const json = JSON.stringify(body);
    expect(json.match(/cache_control/g)?.length).toBe(4);
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    // tools + 2 system markers use 3 slots; the third system block is skipped, the tail gets #4.
    expect(messages.at(-1)!.content.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('drops sampling params for models that reject them and passes effort/thinking', () => {
    expect(anthropicAcceptsSampling('claude-sonnet-5-5')).toBe(false);
    expect(anthropicAcceptsSampling('claude-opus-5-5')).toBe(false);
    expect(anthropicAcceptsSampling('claude-haiku-4-5-20251001')).toBe(true);
    const p = normalizeParams({ temperature: 0.4, effort: 'low', thinking: 'between_tools' });
    const sonnet = toAnthropicBody({ ...request(), temperature: 0.4 }, 'claude-sonnet-5-5', p);
    expect(sonnet.temperature).toBeUndefined();
    expect(sonnet.output_config).toEqual({ effort: 'low' });
    expect(sonnet.thinking).toEqual({ type: 'between_tools' });
    const haiku = toAnthropicBody(
      { ...request(), temperature: 0.4 },
      'claude-haiku-4-5-20251001',
      p,
    );
    expect(haiku.temperature).toBe(0.4);
    expect(haiku.output_config).toBeUndefined();
    expect(haiku.thinking).toBeUndefined();
    expect(normalizeParams({ effort: 'extreme', thinking: 'off' })).not.toHaveProperty('effort');
  });

  it('replays thinking blocks only to the model that produced them', () => {
    const block = { type: 'thinking', thinking: '', signature: 'sig' };
    const messages: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'opaque', provider: 'anthropic', model: 'claude-sonnet-5-5', block },
          { type: 'tool_call', id: 't1', name: 'search_meals', input: {} },
        ],
      },
      { role: 'tool', content: [{ type: 'tool_result', toolCallId: 't1', content: '{}' }] },
    ];
    const same = toAnthropicBody({ ...request(), messages }, 'claude-sonnet-5-5', params);
    const sameMsgs = same.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(sameMsgs[1]!.content[0]).toEqual(block);
    const other = toAnthropicBody({ ...request(), messages }, 'claude-opus-5-5', params);
    const otherMsgs = other.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(otherMsgs[1]!.content[0]!.type).toBe('tool_use');
    const oa = JSON.stringify(toOpenAiBody({ ...request(), messages }, 'gpt', params));
    expect(oa).not.toContain('signature');
    const g = JSON.stringify(toGeminiBody({ ...request(), messages }, params));
    expect(g).not.toContain('signature');
  });

  it('writes cache tokens and the prompt version to ai_usage', () => {
    const row = toUsageRow({
      requestId: 'r',
      userId: 'u',
      householdId: null,
      routeKey: 'chat.default',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      usage: { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 600, cacheWriteTokens: 300 },
      latencyMs: 5,
      status: 'ok',
      params: { ...params, priceCacheReadPerMTokUsd: 0.3, priceCacheWritePerMTokUsd: 3.75 },
      promptKey: 'chat.system',
      promptVersion: 1,
    });
    expect(row).toMatchObject({
      cache_read_tokens: 600,
      cache_write_tokens: 300,
      prompt_key: 'chat.system',
      prompt_version: 1,
      cost_usd_micros: Math.round(100 * 3 + 600 * 0.3 + 300 * 3.75 + 10 * 15),
    });
  });
});

describe('S7-02 intent routing and context budget', () => {
  const decide = (text: string, over: { hasHistory?: boolean; aboutMinor?: boolean } = {}) =>
    intentRules({
      text,
      classification: classifyInputRules(text),
      aboutMinor: over.aboutMinor ?? false,
      hasImages: false,
      hasHistory: over.hasHistory ?? false,
      memberNames: ['Hina'],
    });

  it('routes greetings, thanks and short general questions as light', () => {
    for (const t of ['Assalamu alaikum', 'Thank you!', 'JazakAllah khair', 'شکریہ', 'ok']) {
      expect(decide(t).intent, t).toBe('light');
    }
    expect(decide('Why should we chew slowly?').intent).toBe('light');
  });

  it('keeps anything safety, child, fiqh, Islamic, numeric or household-related full', () => {
    for (const t of [
      'My son is chubby, what should he eat?',
      'Is gelatin halal?',
      'What is the rule of thirds?',
      'Is there a hadith about honey?',
      'How much should Hina eat?',
      'What can I cook for 4 people tonight?',
      'My lips are swelling after peanuts',
      'What is our grocery budget?',
    ]) {
      expect(decide(t).intent, t).toBe('full');
    }
  });

  it('treats acknowledgements mid-conversation as full (they may confirm a change)', () => {
    expect(decide('yes', { hasHistory: true }).intent).toBe('full');
    expect(decide('Thanks!', { hasHistory: true }).intent).toBe('light');
    expect(decide('Why is that?', { hasHistory: true }).intent).toBe('full');
  });

  it('estimates Urdu script more densely than Latin text', () => {
    expect(estimateTokens('abcd'.repeat(25))).toBe(25);
    expect(estimateTokens('سلام'.repeat(10))).toBe(20);
  });

  it('trims history from the oldest end and starts with a user message', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      history.push({
        role: i % 2 ? 'assistant' : 'user',
        content: [{ type: 'text', text: 'x'.repeat(400) }],
      });
    }
    const kept = trimHistory(history, 330);
    expect(kept.length).toBe(2);
    expect(kept[0]!.role).toBe('user');
    expect(trimHistory(history, 100_000)).toHaveLength(10);
    const long: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'y'.repeat(9_000) }] },
    ];
    const t = trimHistory(long, 100_000)[0]!.content[0]!;
    expect(t.type === 'text' && t.text.length).toBeLessThan(2_500);
  });
});

describe('S7-02 turn: light routing, speculation, classifier skip', () => {
  function turn(
    text: string,
    script: (req: ChatRequest, model: string) => Partial<ChatResponse>,
    over: Partial<TurnArgs> = {},
  ) {
    const provider = new FakeProvider({ script });
    const routes = (key: RouteKey): AiModelRouteRow[] => [
      { route_key: key, provider: 'anthropic', model: key, params: {}, priority: 1, enabled: true },
    ];
    const usage: AiUsageInsert[] = [];
    const args: TurnArgs = {
      text,
      locale: 'en',
      countryCode: 'PK',
      tier: 'premium',
      routeKey: 'chat.default',
      maxSteps: 6,
      maxOutputTokens: 1500,
      system: 'You are Thuluth.',
      contextBlocks: ['<household_snapshot>{}</household_snapshot>'],
      history: [],
      tools: toolsForTier('premium'),
      executeTool: async () => ({ ok: true, data: {} }),
      metadata: {
        requestId: '00000000-0000-4000-8000-000000000001',
        userId: 'u',
        householdId: null,
        promptKey: 'chat.system',
        promptVersion: 1,
        tier: 'premium',
      },
      deps: {
        fallback: {
          resolver: new RouteResolver(async (k) => routes(k)),
          providers: { anthropic: provider },
          sleep: async () => {},
        },
        writeUsage: async (r) => void usage.push(r),
      },
      classifyWithModel: true,
      intentRouting: { budget: TURN_BUDGETS.premium },
      speculativeFirstStep: true,
      ...over,
    };
    return { provider, usage, run: () => runChatTurn(args, () => {}) };
  }
  const ok = '{"safety":"ok","categories":[],"fiqh_question":false,"child_weight_request":false}';

  it('answers a greeting on chat.free with no tools, one step and no classifier call', async () => {
    const t = turn('Assalamu alaikum!', () => ({
      content: [{ type: 'text', text: 'Wa alaikum assalam!' }],
    }));
    const out = await t.run();
    expect(out.intent?.intent).toBe('light');
    expect(out.routeKey).toBe('chat.free');
    expect(t.provider.calls).toHaveLength(1);
    const call = t.provider.calls[0]!;
    expect(call.model).toBe('chat.free');
    expect(call.req.tools).toEqual([]);
    expect(call.req.maxOutputTokens).toBe(TURN_BUDGETS.premium.lightMaxOutputTokens);
    expect(t.usage.map((u) => u.route_key)).toEqual(['chat.free']);
  });

  it('uses the speculative first step when the classifier agrees', async () => {
    const t = turn('What can I cook for 4 people tonight?', (req) =>
      req.route === 'classify.safety'
        ? { content: [{ type: 'text', text: ok }] }
        : { content: [{ type: 'text', text: 'Try daal with rice and a salad.' }] },
    );
    const out = await t.run();
    expect(out.speculation).toBe('used');
    expect(out.routeKey).toBe('chat.default');
    expect(t.provider.calls.filter((c) => c.req.route === 'chat.default')).toHaveLength(1);
    expect(t.provider.calls[0]!.req.cacheTail).toBe(true);
  });

  it('discards the speculation when the classifier escalates', async () => {
    const t = turn('I feel strange after the meal, what should I do?', (req) =>
      req.route === 'classify.safety'
        ? {
            content: [
              {
                type: 'text',
                text: '{"safety":"emergency","categories":["emergency"],"fiqh_question":false,"child_weight_request":false}',
              },
            ],
          }
        : { content: [{ type: 'text', text: 'Have some water.' }] },
    );
    const out = await t.run();
    expect(out.speculation).toBe('discarded');
    expect(out.finishReason).toBe('escalated');
    expect(out.text).toContain('1122');
  });
});

describe('S7-10 red-team guardrails', () => {
  it('blocks fasting plans for children under 7 (en, ur, roman Urdu, by name)', () => {
    expect(findYoungChildFasting('Your 5-year-old can fast until iftar.')).not.toHaveLength(0);
    expect(findYoungChildFasting('آپ کی ۵ سالہ بیٹی روزہ رکھ سکتی ہے۔')).not.toHaveLength(0);
    expect(findYoungChildFasting('6 saal ki bachi roza rakh sakti hai.')).not.toHaveLength(0);
    expect(
      findYoungChildFasting('Maryam can fast from suhoor.', { youngNames: ['Maryam'] }),
    ).not.toHaveLength(0);
    expect(findYoungChildFasting('A 3-year-old should not fast. She can join iftar.')).toHaveLength(
      0,
    );
    expect(findYoungChildFasting('Your 9-year-old can try a practice fast.')).toHaveLength(0);
    expect(detectYoungChildFastingRequest('My 5 year old wants to keep roza')).toBe(true);
    const g = guardOutput('Your 4-year-old can do a half-day fast.', { locale: 'en' });
    expect(g.safetyFlags).toContain('child_fasting_blocked');
    expect(g.text).toMatch(/under 7 should not fast/);
  });

  it('removes uncited hadith attributions and flags them for the release gate', () => {
    const text = 'There is a hadith that says seven dates protect you. Eat dates daily.';
    expect(findUngroundedScripture(text)).toHaveLength(1);
    const r = resolveCitations(text, new CitationRegistry());
    expect(r.text).toBe('Eat dates daily.');
    expect(r.safetyFlags).toContain('uncited_scripture_removed');
    expect(findUngroundedScripture('Hadees mein hai ke shehad shifa hai.')).toHaveLength(1);
    expect(findUngroundedScripture('حدیث میں ہے کہ کھجور کھائیں۔')).toHaveLength(1);
    expect(
      findUngroundedScripture('The Prophet (peace be upon him) said to eat together [1].'),
    ).toHaveLength(0);
    expect(findUngroundedScripture('No food or narration is a cure for a disease.')).toHaveLength(
      0,
    );
  });

  it('understands roman Urdu restriction, red flags and rulings', () => {
    expect(detectChildWeightRequest('Meri 10 saal ki beti ko dubla karna hai')).toBe(true);
    expect(
      findChildRestrictionViolations('Usay aadhi roti dein aur 1000 kalori rakhein.').length,
    ).toBeGreaterThan(0);
    expect(detectRedFlagText('Uske honth sooj gaye hain, saans nahi aa rahi').safety).toBe(
      'emergency',
    );
    expect(detectRedFlagText('Meri beti khana kha kar ulti kar deti hai').categories).toContain(
      'eating_disorder_signals',
    );
    expect(findRulingAssertions('Is se roza nahi toot ta.')).not.toHaveLength(0);
  });
});
