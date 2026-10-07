/**
 * `pnpm --filter @thuluth/ai-core cost:sim` (S7-02, NFR 9.8, FR-AI-09): deterministic AI cost and
 * latency simulation. No keys, no network, no randomness.
 *
 * Every eval-dataset prompt is sent through the real `runChatTurn` (classifier, intent routing,
 * guardrails, metering) against a simulated Anthropic provider that:
 * - renders the real request body (`toAnthropicBody`: tools, system blocks, messages, breakpoints),
 * - counts tokens with `estimateTokens` (about 4 chars per token, 2 for Urdu script),
 * - simulates prompt caching per model (5-minute TTL, 4 breakpoints, the model's minimum cacheable
 *   prefix: 4096 tokens on Haiku 4.5, 512 on Sonnet 5.5 and Opus 5.5) on a simulated clock,
 * - answers with scripted replies of fixed length (a tool call when the turn needs data).
 * Cost is what `toUsageRow` computes from the route prices below, i.e. the same arithmetic as
 * `ai_usage.cost_usd_micros`.
 *
 * Two configurations are compared on the same traffic:
 * - `baseline`: the Sprint 6 behaviour (no intent routing, full history, no conversation cache
 *   breakpoint, tools dropped from the request on the last tool-loop step),
 * - `s7`: intent routing, history budgets, a conversation cache breakpoint, tools kept with
 *   tool_choice none, speculative first step.
 * Then a per-MAU model (usage profile below) and the per-user daily ceilings are evaluated.
 *
 * Flags: --json <file> writes all numbers; --quiet prints only the summary tables.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  CHAT_SYSTEM_PROMPT_KEY,
  estimateTokens,
  intentRules,
  renderChatSystem,
  runChatTurn,
  toolsForTier,
  TURN_BUDGETS,
} from '../src/agent/index.ts';
import type { TurnArgs, TurnOutcome } from '../src/agent/index.ts';
import { classifyInputRules } from '../src/guardrails/index.ts';
import type { AiUsageInsert } from '../src/metering/usage.ts';
import { toAnthropicBody } from '../src/providers/anthropic.ts';
import { streamFromChat } from '../src/providers/http.ts';
import { RouteResolver } from '../src/router/route-resolver.ts';
import type { AiModelRouteRow } from '../src/router/route-resolver.ts';
import type {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ContentPart,
  ModelParams,
  RouteKey,
  StreamEvent,
} from '../src/types.ts';

// ---- Assumptions (documented in docs/ai/s7-cost-latency.md) -------------------------------------

/** Anthropic list prices, USD per million tokens (claude-api reference, 2026-09). */
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2, write: 2.5 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5, read: 0.1, write: 1.25 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2, write: 5 },
} as const;
type Model = keyof typeof PRICES;
const MIN_CACHEABLE: Record<Model, number> = {
  'claude-sonnet-5-5': 512,
  'claude-haiku-4-5-20251001': 4096,
  'claude-opus-5-5': 512,
};
const ROUTE_MODEL: Partial<Record<RouteKey, Model>> = {
  'chat.default': 'claude-sonnet-5-5',
  'chat.free': 'claude-haiku-4-5-20251001',
  'classify.safety': 'claude-haiku-4-5-20251001',
  'classify.intent': 'claude-haiku-4-5-20251001',
};
/** Seeded route caps (supabase/seed/catalog/140_ai_model_routes.sql). */
const ROUTE_CAP: Partial<Record<RouteKey, number>> = {
  'chat.default': 1500,
  'chat.free': 800,
  'classify.safety': 200,
  'classify.intent': 150,
};
/** Turn limits from ai-chat (12 §17); unchanged by S7-02. */
const TURN_LIMITS = {
  free: { maxSteps: 4, maxOutputTokens: 800 },
  premium: { maxSteps: 6, maxOutputTokens: 1500 },
} as const;
/** Anthropic adds a tool-use system preamble when tools are present (approximate). */
const TOOL_PREAMBLE_TOKENS = 350;
/** Scripted reply sizes in output tokens. */
const REPLY_TOKENS = { light: 70, plain: 180, withTool: 240, toolCall: 45 } as const;
/** Size of a tool result fed back to the model (search_meals / sources / snapshot JSON). */
const TOOL_RESULT_CHARS = 2_800;
/**
 * Simulated pacing: seconds between messages in a session, and between sessions. `cold`: sessions
 * 15 minutes apart (no cross-user cache reuse, the launch-week floor). `warm`: a session starts
 * every 30 seconds for the same tier and locale, so the shared tools + system prefix stays cached.
 */
const MESSAGE_GAP_S = 60;
const SESSION_GAP_S = { cold: 900, warm: 30 } as const;
/** Modeled latency (p50 inputs): TTFT and decode speed per model, tool execution, classifier. */
const LATENCY = {
  ttftMs: { 'claude-sonnet-5-5': 900, 'claude-haiku-4-5-20251001': 450, 'claude-opus-5-5': 1400 },
  tokPerS: { 'claude-sonnet-5-5': 70, 'claude-haiku-4-5-20251001': 160, 'claude-opus-5-5': 50 },
  toolMs: 350,
  /** A cache hit on the prefix trims time to first token (prefill skipped). */
  cacheHitTtftFactor: 0.7,
} as const;

/** Synthetic household snapshot block, the size of the Lahore family of four in ai-chat. */
const SNAPSHOT = `<household_snapshot>
${JSON.stringify(
  {
    household: {
      name: 'Usman family',
      country: 'PK',
      city: 'Lahore',
      currency: 'PKR',
      tier: 'premium',
    },
    members: [
      {
        name: 'Usman',
        age: 38,
        life_stage: 'adult',
        goals: ['weight_management'],
        activity: 'light',
        allergies: [],
        dislikes: ['bitter gourd'],
      },
      {
        name: 'Hina',
        age: 34,
        life_stage: 'adult',
        breastfeeding: true,
        goals: ['energy'],
        allergies: [],
        dislikes: [],
      },
      {
        name: 'Ibrahim',
        age: 9,
        life_stage: 'child',
        minor: true,
        allergies: ['peanuts'],
        dislikes: ['okra'],
        likes: ['chicken pulao'],
      },
      {
        name: 'Maryam',
        age: 4,
        life_stage: 'child',
        minor: true,
        modules: ['autism'],
        safe_foods: ['plain rice', 'banana', 'paratha'],
        sensory: { textures_avoided: ['slimy', 'mixed'] },
      },
    ],
    active_plan: {
      week_start: '2026-10-05',
      kind: 'standard',
      today: ['Daal chawal with salad', 'Chicken karahi with roti', 'Fruit chaat'],
      adherence_7d: 0.71,
    },
    budget: { monthly_pkr: 60000, mode: 'hard_cap', spent_this_month_pkr: 21400 },
    hydration: { today_ml_logged: { Usman: 1250, Hina: 1500 } },
    recent_logs: ['breakfast: paratha and egg', 'lunch: daal chawal', 'snack: guava'],
    preferences: {
      meal_pattern: ['breakfast', 'lunch', 'snack', 'dinner'],
      batch_cooking: 'weekly_batch_day',
      cuisine: 'pakistani_home',
    },
  },
  null,
  1,
)}
</household_snapshot>`;

// ---- Simulated Anthropic provider with a prompt cache --------------------------------------------

interface CacheEntry {
  expiresAt: number;
}

class SimAnthropic implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly supports = {
    tools: true,
    vision: true,
    jsonSchema: true,
    promptCaching: 'explicit',
    streaming: true,
  } as const;
  readonly cache = new Map<string, CacheEntry>();
  now = 0;
  legacy = false;
  latencyMs = 0;
  calls = 0;

  readonly reply: (req: ChatRequest, model: Model) => ContentPart[];

  constructor(reply: (req: ChatRequest, model: Model) => ContentPart[]) {
    this.reply = reply;
  }

  async chat(reqIn: ChatRequest, modelIn: string, params: ModelParams): Promise<ChatResponse> {
    const model = modelIn as Model;
    this.calls++;
    // Sprint 6 request shape: no conversation breakpoint, tools dropped on tool_choice none.
    const req: ChatRequest = this.legacy
      ? {
          ...reqIn,
          cacheTail: false,
          ...(reqIn.toolChoice === 'none' ? { tools: [] } : {}),
        }
      : reqIn;
    const body = toAnthropicBody(req, model, params);
    // Walk the prompt in render order, recording cumulative tokens at each breakpoint.
    // tool_choice only invalidates the messages tier of the cache, so it enters the key there.
    const blocks: Array<{ text: string; mark: boolean; salt?: string }> = [];
    const tools = (body.tools as Array<Record<string, unknown>> | undefined) ?? [];
    if (tools.length) blocks.push({ text: 'x'.repeat(TOOL_PREAMBLE_TOKENS * 4), mark: false });
    for (const t of tools) blocks.push({ text: JSON.stringify(t), mark: !!t.cache_control });
    for (const s of body.system as Array<Record<string, unknown>>) {
      blocks.push({ text: String(s.text), mark: !!s.cache_control });
    }
    let firstMessage = true;
    for (const m of body.messages as Array<{ content: Array<Record<string, unknown>> }>) {
      for (const b of m.content) {
        const { cache_control: cc, ...rest } = b;
        blocks.push({
          text: JSON.stringify(rest),
          mark: !!cc,
          ...(firstMessage ? { salt: `tc:${JSON.stringify(body.tool_choice ?? 'auto')}` } : {}),
        });
        firstMessage = false;
      }
    }
    // Prefix key and cumulative tokens at every block boundary; entries are written only at
    // breakpoints, and each breakpoint looks back up to 20 blocks for an earlier entry.
    let total = 0;
    let key: string = model;
    const positions: Array<{ tokens: number; key: string; mark: boolean }> = [];
    for (const b of blocks) {
      total += estimateTokens(b.text);
      key = hash(`${key}|${b.salt ?? ''}|${b.text}`);
      positions.push({ tokens: total, key, mark: b.mark });
    }
    const min = MIN_CACHEABLE[model];
    let read = 0;
    let top = 0;
    positions.forEach((p, i) => {
      if (!p.mark || p.tokens < min) return;
      top = Math.max(top, p.tokens);
      for (let j = i; j >= Math.max(0, i - 20); j--) {
        const at = positions[j];
        if (!at) continue;
        const hit = this.cache.get(at.key);
        if (hit && hit.expiresAt > this.now) {
          read = Math.max(read, at.tokens);
          hit.expiresAt = this.now + 300_000;
          break;
        }
      }
    });
    const write = top > read ? top - read : 0;
    for (const p of positions) {
      if (p.mark && p.tokens >= min) this.cache.set(p.key, { expiresAt: this.now + 300_000 });
    }

    const content = this.reply(req, model);
    const outputTokens = content.reduce(
      (n, p) =>
        n +
        (p.type === 'text'
          ? estimateTokens(p.text)
          : p.type === 'tool_call'
            ? REPLY_TOKENS.toolCall
            : 0),
      0,
    );
    const ttft = LATENCY.ttftMs[model] * (read > 0 ? LATENCY.cacheHitTtftFactor : 1);
    const latencyMs = Math.round(ttft + (outputTokens / LATENCY.tokPerS[model]) * 1000);
    this.latencyMs += latencyMs;
    return {
      provider: 'anthropic',
      model,
      content,
      stopReason: content.some((p) => p.type === 'tool_call') ? 'tool_use' : 'end_turn',
      usage: { inputTokens: total, outputTokens, cacheReadTokens: read, cacheWriteTokens: write },
      latencyMs,
    };
  }

  stream(req: ChatRequest, model: string, params: ModelParams): AsyncIterable<StreamEvent> {
    return streamFromChat(req, this.id, model, () => this.chat(req, model, params));
  }
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

const BENIGN =
  'A balanced plate with vegetables, a source of protein and whole grains keeps everyone satisfied. ';

function textOfTokens(tokens: number): string {
  const chars = tokens * 4;
  return BENIGN.repeat(Math.ceil(chars / BENIGN.length)).slice(0, chars);
}

/** The scripted main model: classifier JSON, a tool call when the turn needs data, then a reply. */
function scriptedReply(req: ChatRequest, model: Model): ContentPart[] {
  if (req.route === 'classify.safety' || req.route === 'classify.intent') {
    return [
      {
        type: 'text',
        text:
          req.route === 'classify.intent'
            ? '{"needs_tools":true,"simple":false}'
            : '{"safety":"ok","categories":[],"fiqh_question":false,"child_weight_request":false,"confidence":0.97}',
      },
    ];
  }
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const hasToolResult = req.messages.at(-1)?.role === 'tool';
  if (!req.tools?.length) return [{ type: 'text', text: textOfTokens(REPLY_TOKENS.light) }];
  const userText = lastUser?.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ') ?? '';
  const reason = intentRules({
    text: userText,
    classification: classifyInputRules(userText),
    aboutMinor: false,
    hasImages: false,
    hasHistory: false,
  }).reason;
  const wantsTool = !hasToolResult && req.toolChoice !== 'none' && TOOL_REASONS.has(reason);
  if (wantsTool) {
    const name =
      reason === 'islamic' || reason === 'thuluth_or_sunnah_food'
        ? 'search_islamic_sources'
        : 'get_household_snapshot';
    return [
      { type: 'tool_call', id: `t${model.length}`, name, input: { query: userText.slice(0, 100) } },
    ];
  }
  return [
    {
      type: 'text',
      text: textOfTokens(hasToolResult ? REPLY_TOKENS.withTool : REPLY_TOKENS.plain),
    },
  ];
}
const TOOL_REASONS = new Set([
  'number',
  'household',
  'plan_or_data',
  'islamic',
  'thuluth_or_sunnah_food',
  'quantity',
  'member_named',
  'child',
  'about_minor',
  'child_weight_request',
]);

// ---- Traffic: eval-dataset prompts grouped into sessions -----------------------------------------

function corpus(): Array<{ text: string; locale: 'en' | 'ur' }> {
  const dir = new URL('../evals/datasets/', import.meta.url);
  const seen = new Set<string>();
  const out: Array<{ text: string; locale: 'en' | 'ur' }> = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()) {
    for (const line of readFileSync(new URL(f, dir), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { prompt?: string; locale?: string };
      if (!row.prompt || seen.has(row.prompt)) continue;
      seen.add(row.prompt);
      out.push({ text: row.prompt, locale: row.locale === 'ur' ? 'ur' : 'en' });
    }
  }
  return out;
}

/** Sessions of four prompts; every session opens with a greeting and every other one ends with thanks. */
function sessions(): Array<Array<{ text: string; locale: 'en' | 'ur' }>> {
  const all = corpus();
  const out: Array<Array<{ text: string; locale: 'en' | 'ur' }>> = [];
  for (let i = 0; i < all.length; i += 4) {
    const s = all.slice(i, i + 4);
    const locale = s[0]?.locale ?? 'en';
    out.push([
      { text: locale === 'ur' ? 'السلام علیکم' : 'Assalamu alaikum', locale },
      ...s,
      ...(out.length % 2 ? [{ text: locale === 'ur' ? 'شکریہ' : 'Thank you!', locale }] : []),
    ]);
  }
  return out;
}

// ---- Run ------------------------------------------------------------------------------------------

interface RunStats {
  config: 'baseline' | 's7';
  tier: 'free' | 'premium';
  messages: number;
  modelTurns: number;
  lightTurns: number;
  templateTurns: number;
  costMicros: number;
  costByRoute: Record<string, number>;
  tokensIn: number;
  cacheRead: number;
  cacheWrite: number;
  tokensOut: number;
  /** Modeled time until the validated reply starts streaming, per model-answered turn. */
  latencies: number[];
  perMessageMicros: number[];
}

function routeRows(): (key: RouteKey) => Promise<AiModelRouteRow[]> {
  return async (key) => {
    const model = ROUTE_MODEL[key];
    if (!model) return [];
    const p = PRICES[model];
    return [
      {
        route_key: key,
        provider: 'anthropic',
        model,
        priority: 1,
        enabled: true,
        params: {
          timeoutMs: 45_000,
          maxOutputTokens: ROUTE_CAP[key],
          priceInPerMTokUsd: p.in,
          priceOutPerMTokUsd: p.out,
          priceCacheReadPerMTokUsd: p.read,
          priceCacheWritePerMTokUsd: p.write,
        },
      },
    ];
  };
}

async function simulate(config: 'baseline' | 's7', tier: 'free' | 'premium', warmShared: boolean) {
  const provider = new SimAnthropic(scriptedReply);
  provider.legacy = config === 'baseline';
  const rows: AiUsageInsert[] = [];
  const stats: RunStats = {
    config,
    tier,
    messages: 0,
    modelTurns: 0,
    lightTurns: 0,
    templateTurns: 0,
    costMicros: 0,
    costByRoute: {},
    tokensIn: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokensOut: 0,
    latencies: [],
    perMessageMicros: [],
  };
  const deps = {
    fallback: {
      resolver: new RouteResolver(routeRows()),
      providers: { anthropic: provider },
      sleep: async () => {},
    },
    writeUsage: async (r: AiUsageInsert) => void rows.push(r),
  };
  const tools = toolsForTier(tier);
  for (const [si, session] of sessions().entries()) {
    // Without cross-user warmth every session starts cold (only its own turns warm the cache).
    if (!warmShared) provider.cache.clear();
    provider.now = si * SESSION_GAP_S[warmShared ? 'warm' : 'cold'] * 1000;
    const history: ChatMessage[] = [];
    for (const msg of session) {
      provider.now += MESSAGE_GAP_S * 1000;
      const before = rows.length;
      const latencyBefore = provider.latencyMs;
      const system = renderChatSystem({
        today: '2026-10-06',
        countryName: 'PK',
        locale: msg.locale,
        traditionPreference: 'shared',
        tier,
      });
      const args: TurnArgs = {
        text: msg.text,
        locale: msg.locale,
        countryCode: 'PK',
        tier,
        routeKey: tier === 'premium' ? 'chat.default' : 'chat.free',
        maxSteps: TURN_LIMITS[tier].maxSteps,
        maxOutputTokens: TURN_LIMITS[tier].maxOutputTokens,
        system,
        contextBlocks: [SNAPSHOT],
        history: [...history],
        tools,
        executeTool: async () => ({
          ok: true,
          data: { items: textOfTokens(Math.round(TOOL_RESULT_CHARS / 4)) },
        }),
        minorNames: ['Ibrahim', 'Maryam'],
        memberNames: ['Usman', 'Hina'],
        youngChildNames: ['Maryam'],
        metadata: {
          requestId: `sim-${si}`,
          userId: 'sim',
          householdId: null,
          promptKey: CHAT_SYSTEM_PROMPT_KEY,
          promptVersion: 1,
          tier,
        },
        deps,
        classifyWithModel: true,
        ...(config === 's7'
          ? {
              intentRouting: { budget: TURN_BUDGETS[tier] },
              historyTokenBudget: TURN_BUDGETS[tier].historyTokens,
              speculativeFirstStep: true,
            }
          : {}),
      };
      const out: TurnOutcome = await runChatTurn(args, () => {});
      stats.messages++;
      if (out.bypassedModel) stats.templateTurns++;
      else stats.modelTurns++;
      if (out.intent?.intent === 'light') stats.lightTurns++;
      const turnRows = rows.slice(before);
      const micros = turnRows.reduce((n, r) => n + r.cost_usd_micros, 0);
      stats.perMessageMicros.push(micros);
      if (!out.bypassedModel) {
        // The classifier runs before the main model unless the first step was speculative.
        const classifier = turnRows.find((r) => r.route_key === 'classify.safety');
        const classifierMs = classifier?.latency_ms ?? 0;
        const mainMs = provider.latencyMs - latencyBefore - classifierMs;
        const toolsMs = out.toolCalls.length * LATENCY.toolMs;
        // With speculation the classifier runs alongside the first step instead of before it.
        const serial =
          out.speculation === 'used' ? Math.max(classifierMs, mainMs) : classifierMs + mainMs;
        stats.latencies.push(Math.round(serial + toolsMs));
      }
      history.push(
        { role: 'user', content: [{ type: 'text', text: msg.text }] },
        { role: 'assistant', content: [{ type: 'text', text: out.text }] },
      );
    }
  }
  for (const r of rows) {
    stats.costMicros += r.cost_usd_micros;
    stats.costByRoute[r.route_key] = (stats.costByRoute[r.route_key] ?? 0) + r.cost_usd_micros;
    stats.tokensIn += r.tokens_in;
    stats.cacheRead += r.cache_read_tokens;
    stats.cacheWrite += r.cache_write_tokens;
    stats.tokensOut += r.tokens_out;
  }
  return stats;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const usd = (micros: number, digits = 4) => `$${(micros / 1e6).toFixed(digits)}`;

// ---- Per-MAU model and daily ceilings -------------------------------------------------------------

/**
 * Monthly usage profile per MAU (assumption, to be replaced by beta `ai_usage` data). Non-chat
 * call sizes are the seeded caps' typical fill: plan selection (S4) and adjustments on Sonnet or
 * Opus with the catalog in the prompt, vision with one 1024 px image.
 */
const PROFILE = {
  free: { activeDays: 8, messagesPerActiveDay: 4, planPersonalize: 2, intake: 0.25 },
  premium: {
    activeDays: 18,
    messagesPerActiveDay: 8,
    planGenerate: 3,
    planAdjust: 4,
    photos: 10,
    memorySummaries: 18,
    intake: 0.25,
  },
} as const;
/** One non-chat call: input (cached share), output, model. */
const CALLS = {
  planPersonalize: { model: 'claude-sonnet-5-5', in: 9_000, cached: 0.3, out: 2_500 },
  planGenerate: { model: 'claude-opus-5-5', in: 14_000, cached: 0.3, out: 6_000 },
  planAdjust: { model: 'claude-sonnet-5-5', in: 7_000, cached: 0.3, out: 2_000 },
  photo: { model: 'claude-sonnet-5-5', in: 2_800, cached: 0.3, out: 600 },
  memorySummary: { model: 'claude-haiku-4-5-20251001', in: 1_500, cached: 0, out: 200 },
  intake: { model: 'claude-sonnet-5-5', in: 3_000, cached: 0, out: 1_200 },
} as const;
function callMicros(c: { model: Model; in: number; cached: number; out: number }): number {
  const p = PRICES[c.model];
  return Math.round(c.in * (1 - c.cached) * p.in + c.in * c.cached * p.read + c.out * p.out);
}

/** ai-chat `DEFAULT_COST_CAPS` and NFR 9.8 (PO decision 2026-10-06). */
const DAILY_CEILING_MICROS = { free: 100_000, premium: 600_000 };

// ---- Main ----------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;

const results: Record<string, RunStats> = {};
function res(key: string): RunStats {
  const r = results[key];
  if (!r) throw new Error(`no simulation result ${key}`);
  return r;
}
for (const warm of [false, true]) {
  for (const tier of ['free', 'premium'] as const) {
    for (const config of ['baseline', 's7'] as const) {
      results[`${tier}.${config}.${warm ? 'warm' : 'cold'}`] = await simulate(config, tier, warm);
    }
  }
}

const lines: string[] = [];
const out = (s = '') => lines.push(s);
const first = res('free.baseline.cold');
out(
  `Traffic: ${first.messages} messages in ${sessions().length} sessions (eval-dataset prompts, greeting + thanks added).`,
);
out();
out(
  '| Tier | Cache | Config | Avg cost / message | p95 / message | Model turns | Light turns | Cache read share of input | Modeled time to first token p50 / p95 |',
);
out('|---|---|---|---|---|---|---|---|---|');
for (const [key, r] of Object.entries(results)) {
  const [tier, config, warm] = key.split('.');
  out(
    `| ${tier} | ${warm} | ${config} | ${usd(r.costMicros / r.messages, 5)} | ${usd(pct(r.perMessageMicros, 95), 5)} | ${r.modelTurns} | ${r.lightTurns} | ${((100 * r.cacheRead) / Math.max(1, r.tokensIn)).toFixed(0)}% | ${(pct(r.latencies, 50) / 1000).toFixed(2)} s / ${(pct(r.latencies, 95) / 1000).toFixed(2)} s |`,
  );
}
out();

const perMessage = (tier: 'free' | 'premium', config: 'baseline' | 's7', warm: 'cold' | 'warm') => {
  const r = res(`${tier}.${config}.${warm}`);
  return r.costMicros / r.messages;
};
interface MauRow {
  freeChat: number;
  freeOther: number;
  premiumChat: number;
  premiumOther: number;
}
const mau: Record<string, MauRow> = {};
for (const config of ['baseline', 's7'] as const) {
  for (const warm of ['cold', 'warm'] as const) {
    const f = PROFILE.free;
    const fChat = perMessage('free', config, warm) * f.activeDays * f.messagesPerActiveDay;
    const fOther =
      callMicros(CALLS.planPersonalize) * f.planPersonalize + callMicros(CALLS.intake) * f.intake;
    const p = PROFILE.premium;
    const pChat = perMessage('premium', config, warm) * p.activeDays * p.messagesPerActiveDay;
    const pOther =
      callMicros(CALLS.planGenerate) * p.planGenerate +
      callMicros(CALLS.planAdjust) * p.planAdjust +
      callMicros(CALLS.photo) * p.photos +
      callMicros(CALLS.memorySummary) * p.memorySummaries +
      callMicros(CALLS.intake) * p.intake;
    mau[`${config}.${warm}`] = {
      freeChat: fChat,
      freeOther: fOther,
      premiumChat: pChat,
      premiumOther: pOther,
    };
  }
}
out(
  '| Config | Cache | Free MAU (target $0.15) | of which chat | Premium MAU (target $1.20) | of which chat |',
);
out('|---|---|---|---|---|---|');
for (const [key, m] of Object.entries(mau)) {
  const [config, warm] = key.split('.');
  out(
    `| ${config} | ${warm} | ${usd(m.freeChat + m.freeOther, 3)} | ${usd(m.freeChat, 3)} | ${usd(m.premiumChat + m.premiumOther, 3)} | ${usd(m.premiumChat, 3)} |`,
  );
}
out();

// Daily ceilings: a heavy user at the message cap, every turn a full tool turn (worst realistic case).
const worstFull = (tier: 'free' | 'premium') => {
  const r = res(`${tier}.s7.cold`);
  return pct(r.perMessageMicros, 95);
};
const freeDay = worstFull('free') * 20;
const dayMessages = (tier: 'free' | 'premium') =>
  Math.floor(DAILY_CEILING_MICROS[tier] / worstFull(tier));
const premiumHeavyOther =
  callMicros(CALLS.photo) * 15 +
  callMicros(CALLS.planAdjust) * 20 +
  callMicros(CALLS.planGenerate) * 2;
out('| Daily ceiling check (s7, cold cache, p95 message cost) | Value |');
out('|---|---|');
out(
  `| Free: 20 messages (daily cap) at p95 cost | ${usd(freeDay, 4)} vs ceiling ${usd(DAILY_CEILING_MICROS.free, 2)} |`,
);
out(`| Free: messages until ceiling $0.10 at p95 cost | ${dayMessages('free')} |`);
out(`| Premium: messages until ceiling $0.60 | ${dayMessages('premium')} |`);
out(
  `| Premium heavy day without chat (15 photos, 20 adjustments, 2 plans) | ${usd(premiumHeavyOther, 3)} |`,
);
out();
const costShare = (key: string) =>
  Object.entries(res(key).costByRoute)
    .map(([k, v]) => `${k} ${usd(v, 3)}`)
    .join(', ');
out(`Route split, premium s7 cold: ${costShare('premium.s7.cold')}`);
out(`Route split, premium baseline cold: ${costShare('premium.baseline.cold')}`);
out(`Route split, free s7 cold: ${costShare('free.s7.cold')}`);

console.log(lines.join('\n'));
if (jsonPath) {
  writeFileSync(
    jsonPath,
    `${JSON.stringify({ results, mau, freeDay, premiumHeavyOther, prices: PRICES, profile: PROFILE }, null, 2)}\n`,
  );
}
