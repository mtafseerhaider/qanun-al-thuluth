import { detectYoungChildFastingRequest } from '../guardrails/child-fasting.ts';
import { mentionsChild } from '../guardrails/child-restriction.ts';
import {
  classifyInput,
  classifyInputRules,
  classifyOutputWithModel,
} from '../guardrails/classify.ts';
import type { Classified, ClassifyDeps } from '../guardrails/classify.ts';
import { DISCLAIMER_TEXT, hasDisclaimer } from '../guardrails/disclaimer.ts';
import { guardOutput, instructionFor } from '../guardrails/guard.ts';
import { nameMatcher } from '../guardrails/names.ts';
import { findUngroundedNumbers } from '../guardrails/numeric-grounding.ts';
import { escalationFor } from '../guardrails/red-flags.ts';
import type {
  EscalationOut,
  EscalationReason,
  Recommend,
  RiskFlag,
} from '../guardrails/red-flags.ts';
import { RED_FLAG_REFERRAL, SCHOLAR_REFERRAL } from '../guardrails/templates.ts';
import { sentences } from '../guardrails/text.ts';
import type { Locale } from '../guardrails/text.ts';
import { chatMetered } from '../router/metered.ts';
import type { MeteredDeps, MeteredResult } from '../router/metered.ts';
import type {
  ChatMessage,
  ContentPart,
  RequestMetadata,
  RouteKey,
  ToolDefinition,
  Usage,
} from '../types.ts';
import { CitationRegistry, resolveCitations } from './citations.ts';
import type { ResolvedCitation } from './citations.ts';
import { contactsFor, crisisKindOf, crisisTemplate } from './crisis.ts';
import type { EmergencyContact } from './crisis.ts';
import { followUps, followUpTopic } from './follow-ups.ts';
import { intentRules, routeIntent, trimHistory } from './intent.ts';
import type { IntentDecision, IntentInput, TurnBudget } from './intent.ts';
import { CHAT_SYSTEM_PROMPT_KEY, CHAT_SYSTEM_PROMPT_VERSION } from './prompt.ts';
import { isAgentTool, TOOL_INPUTS, toolMeta } from './tools.ts';
import type { AgentToolName, ToolResult } from './tools.ts';

/**
 * The `ai-chat` agent turn (12 §10). Store-free and transport-free: the Edge Function supplies the
 * context, the tool executor and the persistence callbacks, and turns `TurnEvent`s into SSE.
 *
 * Order (12 §10, §13): input rules + `classify.safety` → emergencies and hard red flags answer
 * with fixed templates and never reach the main model → up to N model steps with tools → output
 * validators (citations, numeric grounding, child restriction, fiqh, cure claims, disclaimer,
 * optional `classify.output`) → the validated text is released sentence by sentence.
 *
 * The whole reply is validated before the first `delta` leaves the server: a model reply cannot be
 * shown and then retracted, and provider fallback stays possible for the entire step (12 §5.3).
 */

export type TurnEvent =
  | { type: 'tool.call'; toolCallId: string; name: AgentToolName; display: string }
  | {
      type: 'tool.result';
      toolCallId: string;
      name: AgentToolName;
      ok: boolean;
      summary?: string | undefined;
      card?: Record<string, unknown> | undefined;
    }
  | { type: 'delta'; text: string }
  | { type: 'citation'; citation: ResolvedCitation }
  | {
      type: 'safety';
      action: 'notice' | 'escalate';
      escalation?: EscalationOut | undefined;
      noticeKey?: string | undefined;
    }
  | { type: 'follow_up'; suggestions: string[] }
  /**
   * The route the turn will be served on, emitted once, after safety classification and intent
   * routing and before any other event. ai-chat sends `message.start` on it so the announced
   * `model_route` is the one actually used (a light turn reports `chat.free`).
   */
  | { type: 'route'; routeKey: RouteKey; intent: IntentDecision['intent'] | null };

export type FinishReason = 'complete' | 'escalated' | 'length' | 'cancelled';

export interface ToolContext {
  locale: Locale;
  citations: CitationRegistry;
  /** Kcal values computed for minors; any appearance in the reply is a violation. */
  internalKcal: number[];
  signal?: AbortSignal | undefined;
}

export type ToolExecutor = (
  name: AgentToolName,
  input: unknown,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** A safety event the caller persists (`safety_events`, source `chat`). */
export interface EscalationRecord {
  category: string;
  urgency: 'emergency_now' | 'same_day' | 'soon' | 'routine';
  evidence: string;
  familyMemberId: string | null;
  escalation: EscalationOut;
}

export interface TurnArgs {
  text: string;
  /** The user's content parts (text plus any images); defaults to the text. */
  userContent?: ContentPart[] | undefined;
  locale: Locale;
  countryCode: string | null;
  /** Seeded emergency contacts for the country (null: built-in fallback). */
  emergencyContacts?: readonly EmergencyContact[] | null | undefined;
  tier: 'free' | 'premium';
  routeKey: RouteKey;
  maxSteps: number;
  maxOutputTokens: number;
  /** Rendered `chat.system` prompt (cached block). */
  system: string;
  /** Snapshot, summary and memory blocks after the system prompt. */
  contextBlocks: string[];
  history: ChatMessage[];
  tools: ToolDefinition[];
  executeTool: ToolExecutor;
  /** Numbers already shown to the user (snapshot, plan) that the reply may restate. */
  groundedNumbers?: readonly number[] | undefined;
  /** Names of members under 18 (child-restriction scope). */
  minorNames?: readonly string[] | undefined;
  /** The chat is focused on a member under 18. */
  focusIsMinor?: boolean | undefined;
  /** Names of members under 7 (no fasting at all, S7-10). */
  youngChildNames?: readonly string[] | undefined;
  /** Every household member's name (intent routing: naming a member makes a turn full). */
  memberNames?: readonly string[] | undefined;
  isRamadan?: boolean | undefined;
  onEscalation?: ((e: EscalationRecord) => Promise<void>) | undefined;
  metadata: RequestMetadata;
  deps: MeteredDeps;
  /** Run `classify.safety` on the input (otherwise rules only). */
  classifyWithModel?: boolean | undefined;
  /** Run `classify.output` on drafts that pass the deterministic validators. */
  modelOutputCheck?: boolean | undefined;
  signal?: AbortSignal | undefined;
  overallDeadlineMs?: number | undefined;
  /**
   * S7-02 intent routing. When set, a `light` turn (greeting, thanks, short general question with
   * no safety, child, fiqh, Islamic, household or numeric signal) runs on `budget.lightRoute` with
   * no tools, one step and `budget.lightMaxOutputTokens`. `withModel` consults `classify.intent`
   * for ambiguous messages (in parallel with `classify.safety`).
   */
  intentRouting?: { budget: TurnBudget; withModel?: boolean | undefined } | undefined;
  /** Token budget for prior history on a full turn (default: no trimming). */
  historyTokenBudget?: number | undefined;
  /**
   * Start the first model step on the rules verdict while `classify.safety` runs; the response is
   * used only when the model classifier agrees, otherwise it is aborted and the step re-runs.
   */
  speculativeFirstStep?: boolean | undefined;
}

export interface TurnToolCall {
  id: string;
  name: string;
  input: unknown;
  ok: boolean;
  summary?: string | undefined;
}

export interface TurnOutcome {
  text: string;
  finishReason: FinishReason;
  citations: ResolvedCitation[];
  safetyFlags: string[];
  toolCalls: TurnToolCall[];
  usage: Usage;
  model: string | null;
  classification: Classified;
  aboutMinor: boolean;
  escalation: EscalationOut | null;
  followUps: string[];
  /** The main model was not called (crisis or red-flag template). */
  bypassedModel: boolean;
  /** S7-02 routing verdict (null when intent routing is off). */
  intent: IntentDecision | null;
  /** The route the main model steps used. */
  routeKey: RouteKey;
  /** Whether a speculative first step was used, discarded, or not attempted. */
  speculation: 'used' | 'discarded' | 'none';
}

/** The per-turn execution plan derived from the classification and intent. */
interface TurnPlan {
  routeKey: RouteKey;
  maxSteps: number;
  maxOutputTokens: number;
  tools: ToolDefinition[];
  history: ChatMessage[];
  instruction: string | null;
}

interface Speculation {
  plan: TurnPlan;
  messages: ChatMessage[];
  promise: Promise<MeteredResult>;
  abort: AbortController;
  key: string;
  intent: IntentDecision['intent'] | null;
}

/** The parts of a classification that change how the turn runs. */
function decisionKey(c: Classified): string {
  return `${c.safety}|${c.child_weight_request}|${c.fiqh_question}`;
}

function planFor(
  args: TurnArgs,
  c: Classified,
  intent: Pick<IntentDecision, 'intent'> | null,
  locale: Locale,
): TurnPlan {
  const budget = args.intentRouting?.budget;
  const light = !!budget && intent?.intent === 'light';
  const historyBudget = light ? budget.lightHistoryTokens : args.historyTokenBudget;
  return {
    routeKey: light ? budget.lightRoute : args.routeKey,
    maxSteps: light ? 1 : args.maxSteps,
    maxOutputTokens: light
      ? Math.min(args.maxOutputTokens, budget.lightMaxOutputTokens)
      : args.maxOutputTokens,
    tools: light ? [] : args.tools,
    history: historyBudget === undefined ? args.history : trimHistory(args.history, historyBudget),
    instruction: instructionFor(c, locale, {
      youngChildFasting: detectYoungChildFastingRequest(args.text, {
        youngNames: args.youngChildNames,
      }),
    }),
  };
}

/**
 * System blocks ordered for prompt caching (12 §5.7): the rendered `chat.system` prompt and the
 * household snapshot carry cache markers; memories and the per-turn instruction come after them.
 */
function buildSystem(args: TurnArgs, plan: TurnPlan): ContentPart[] {
  return [
    { type: 'text', text: args.system, cache: true },
    ...args.contextBlocks.map((t, i) => ({
      type: 'text' as const,
      text: t,
      ...(i === 0 ? { cache: true } : {}),
    })),
    ...(plan.instruction ? [{ type: 'text' as const, text: plan.instruction }] : []),
  ];
}

function firstMessages(args: TurnArgs, plan: TurnPlan): ChatMessage[] {
  return [
    ...plan.history,
    { role: 'user', content: args.userContent ?? [{ type: 'text', text: args.text }] },
  ];
}

function callStep(
  args: TurnArgs,
  plan: TurnPlan,
  system: ContentPart[],
  messages: ChatMessage[],
  last: boolean,
  escalated: boolean,
  signal: AbortSignal | undefined,
  metadata: RequestMetadata,
): Promise<MeteredResult> {
  return chatMetered(
    plan.routeKey,
    (route) => ({
      system,
      messages,
      tools: plan.tools,
      toolChoice: last || escalated ? 'none' : 'auto',
      maxOutputTokens: Math.min(
        route.params.maxOutputTokens ?? plan.maxOutputTokens,
        plan.maxOutputTokens,
      ),
      ...(route.params.temperature !== undefined ? { temperature: route.params.temperature } : {}),
      // The conversation prefix is cached for the next step of the loop and the next turn.
      cacheTail: true,
      ...(signal ? { signal } : {}),
    }),
    metadata,
    { overallDeadlineMs: args.overallDeadlineMs ?? 60_000 },
    args.deps,
  );
}

/** `AbortSignal.any` where available; a manual fan-in otherwise. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) c.abort();
    else s.addEventListener('abort', () => c.abort(), { once: true });
  }
  return c.signal;
}

const MAX_TOOL_CALLS_PER_STEP = 4;

const CATEGORY_REASON: Record<string, EscalationReason> = {
  eating_disorder_signals: 'eating_disorder_signals',
  rapid_child_weight_loss: 'rapid_child_weight_loss',
  dehydration_signs: 'dehydration_signs',
  pregnancy_complication: 'pregnancy_complication',
  severe_allergy_reaction: 'severe_allergy_reaction',
  insulin_or_sulfonylurea_fasting: 'insulin_or_sulfonylurea_fasting',
};

const REASON_RECOMMEND: Record<EscalationReason, Recommend> = {
  eating_disorder_signals: 'see_gp',
  rapid_child_weight_loss: 'see_pediatrician',
  faltering_growth: 'see_pediatrician',
  dehydration_signs: 'urgent_care',
  pregnancy_complication: 'urgent_care',
  severe_allergy_reaction: 'emergency',
  insulin_or_sulfonylurea_fasting: 'see_gp',
  other_clinical: 'see_gp',
};

/** `escalate_to_clinician.category` vocabulary for `safety_events.category`. */
const REASON_CATEGORY: Record<EscalationReason, string> = {
  eating_disorder_signals: 'eating_disorder',
  rapid_child_weight_loss: 'child_weight_loss',
  faltering_growth: 'faltering_growth',
  dehydration_signs: 'dehydration',
  pregnancy_complication: 'pregnancy_complication',
  severe_allergy_reaction: 'severe_allergy',
  insulin_or_sulfonylurea_fasting: 'diabetes_fasting_risk',
  other_clinical: 'other_medical',
};

const TOOL_CATEGORY_REASON: Record<string, EscalationReason> = {
  eating_disorder: 'eating_disorder_signals',
  child_weight_loss: 'rapid_child_weight_loss',
  faltering_growth: 'faltering_growth',
  dehydration: 'dehydration_signs',
  pregnancy_complication: 'pregnancy_complication',
  severe_allergy: 'severe_allergy_reaction',
  diabetes_fasting_risk: 'insulin_or_sulfonylurea_fasting',
  self_harm: 'other_clinical',
  other_medical: 'other_clinical',
};

const CLINICIAN_RECOMMEND: Record<string, Recommend> = {
  emergency_services: 'emergency',
  gp: 'see_gp',
  paediatrician: 'see_pediatrician',
  obstetrician_midwife: 'urgent_care',
  dietitian: 'see_dietitian',
  endocrinologist: 'see_gp',
  mental_health: 'see_gp',
  allergist: 'see_gp',
};

function hardFlag(reason: EscalationReason): RiskFlag {
  return {
    code: reason,
    hard: true,
    severity: 'see_clinician',
    stops: 'all',
    reason,
    recommend: REASON_RECOMMEND[reason],
    evidence: {},
  };
}

function urgencyFor(reason: EscalationReason): EscalationRecord['urgency'] {
  if (reason === 'severe_allergy_reaction') return 'emergency_now';
  if (reason === 'pregnancy_complication' || reason === 'dehydration_signs') return 'same_day';
  return 'soon';
}

/** Short evidence for `safety_events.evidence`: the classifier categories, never the message. */
function evidenceOf(c: Classified): string {
  return `chat input classified: ${c.categories.join(', ') || c.safety}`.slice(0, 500);
}

/** Splits text into sentence chunks, keeping line breaks, for streaming. */
export function deltaChunks(text: string): string[] {
  return text.match(/[^.!?۔؟\n]+(?:[.!?۔؟]+|$)\s*|\n+/gu) ?? (text ? [text] : []);
}

/** Drops sentences matching `drop`, keeping paragraph and line structure. */
function filterSentences(
  text: string,
  drop: (s: string) => boolean,
): { text: string; removed: number } {
  let removed = 0;
  const paragraphs: string[] = [];
  for (const paragraph of text.split(/\n{2,}/u)) {
    const lines: string[] = [];
    for (const line of paragraph.split('\n')) {
      const kept = sentences(line).filter((s) => {
        const bad = drop(s);
        if (bad) removed++;
        return !bad;
      });
      if (kept.length) lines.push(kept.join(' '));
    }
    if (lines.length) paragraphs.push(lines.join('\n'));
  }
  return { text: paragraphs.join('\n\n'), removed };
}

/** Every number in a tool result (and numeric strings), for numeric grounding. */
export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))
    out.push(Number(value));
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbers(v, out);
  return out;
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TOOL_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const NO_TEXT: Record<Locale, string> = {
  en: "I'm sorry, I couldn't put together a safe answer to that. Could you ask it another way?",
  ur: 'معذرت، میں اس کا محفوظ جواب نہیں بنا سکا۔ کیا آپ دوسرے انداز میں پوچھ سکتے ہیں؟',
};

export async function runChatTurn(
  args: TurnArgs,
  emit: (e: TurnEvent) => void | Promise<void>,
): Promise<TurnOutcome> {
  const { locale } = args;
  const flags = new Set<string>();
  const metadata: RequestMetadata = {
    ...args.metadata,
    promptKey: CHAT_SYSTEM_PROMPT_KEY,
    promptVersion: CHAT_SYSTEM_PROMPT_VERSION,
  };
  const classifyDeps: ClassifyDeps = { ...args.deps, metadata: args.metadata };
  const contacts = contactsFor(args.countryCode, args.emergencyContacts);

  // Script-aware: Urdu-script names and nicknames, spelling variants, diacritics (names.ts).
  const minorMentioned = nameMatcher(args.minorNames);
  const aboutMinorOf = (c: Classified) =>
    !!args.focusIsMinor ||
    c.child_weight_request ||
    minorMentioned(args.text) ||
    mentionsChild(args.text);
  const hasImages = (args.userContent ?? []).some((p) => p.type === 'image');
  const intentInput = (c: Classified): IntentInput => ({
    text: args.text,
    classification: c,
    aboutMinor: aboutMinorOf(c),
    hasImages,
    hasHistory: args.history.length > 0,
    memberNames: [...(args.memberNames ?? []), ...(args.minorNames ?? [])],
  });

  // 0. Rules first (instant); classify.safety and the optional classify.intent run in parallel.
  //    With speculation on, the first model step starts now on the rules verdict and is kept only
  //    if the model classifier reaches the same decision (S7-02 latency: hides the classifier).
  const rules = classifyInputRules(args.text);
  const routing = args.intentRouting;
  const rulesIntent = routing ? intentRules(intentInput(rules)) : null;
  // A bare greeting or thanks (strict whole-message match) needs no model classifier (S7-02).
  const classifyModel =
    !!args.classifyWithModel &&
    !(rulesIntent?.intent === 'light' && rulesIntent.reason === 'smalltalk');
  let spec: Speculation | null = null;
  if (
    args.speculativeFirstStep &&
    classifyModel &&
    rules.safety === 'ok' &&
    !(rulesIntent?.ambiguous && routing?.withModel)
  ) {
    const plan = planFor(args, rules, rulesIntent, locale);
    const abort = new AbortController();
    const signal = args.signal ? anySignal([args.signal, abort.signal]) : abort.signal;
    const messages = firstMessages(args, plan);
    const promise = callStep(
      args,
      plan,
      buildSystem(args, plan),
      messages,
      plan.maxSteps === 1,
      false,
      signal,
      metadata,
    );
    promise.catch(() => {}); // a discarded speculation must not surface as unhandled
    spec = {
      plan,
      messages,
      promise,
      abort,
      key: decisionKey(rules),
      intent: rulesIntent?.intent ?? null,
    };
  }
  const [classification, routed] = await Promise.all([
    classifyModel ? classifyInput(args.text, classifyDeps) : Promise.resolve(rules),
    routing
      ? routeIntent(intentInput(rules), routing.withModel ? classifyDeps : undefined)
      : Promise.resolve(null),
  ]);
  let intent: IntentDecision | null = routed;
  if (routing && decisionKey(classification) !== decisionKey(rules)) {
    // The model raised a flag the rules did not: re-decide on the merged verdict (always full).
    const { ambiguous: _a, ...d } = intentRules(intentInput(classification));
    intent = d;
  }
  let speculation: TurnOutcome['speculation'] = 'none';
  if (spec) {
    if (spec.key === decisionKey(classification) && spec.intent === (intent?.intent ?? null)) {
      speculation = 'used';
    } else {
      spec.abort.abort();
      spec = null;
      speculation = 'discarded';
    }
  }
  const plan = spec?.plan ?? planFor(args, classification, intent, locale);
  const aboutMinorInput = aboutMinorOf(classification);
  await emit({ type: 'route', routeKey: plan.routeKey, intent: intent?.intent ?? null });

  const base = {
    classification,
    toolCalls: [] as TurnToolCall[],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    model: null as string | null,
    intent,
    routeKey: plan.routeKey,
    speculation,
  };

  const finishTemplate = async (
    text: string,
    escalation: EscalationOut,
    record: EscalationRecord,
    flag: string,
  ): Promise<TurnOutcome> => {
    spec?.abort.abort();
    base.speculation = spec ? 'discarded' : base.speculation;
    await args.onEscalation?.(record);
    for (const chunk of deltaChunks(text)) await emit({ type: 'delta', text: chunk });
    await emit({ type: 'safety', action: 'escalate', escalation });
    return {
      ...base,
      text,
      finishReason: 'escalated',
      citations: [],
      safetyFlags: [flag],
      aboutMinor: aboutMinorInput,
      escalation,
      followUps: [],
      bypassedModel: true,
    };
  };

  // 1. Emergencies: fixed crisis template with the country's numbers; no model call.
  if (classification.safety === 'emergency') {
    const kind = crisisKindOf(args.text);
    const text = crisisTemplate(kind, locale, contacts);
    const reason: EscalationReason =
      kind === 'self_harm'
        ? 'other_clinical'
        : (classification.categories.map((c) => CATEGORY_REASON[c]).find(Boolean) ??
          'other_clinical');
    const escalation: EscalationOut = {
      reason,
      family_member_id: null,
      message: text,
      recommend: 'emergency',
    };
    return finishTemplate(
      text,
      escalation,
      {
        category: kind === 'self_harm' ? 'self_harm' : REASON_CATEGORY[reason],
        urgency: 'emergency_now',
        evidence: evidenceOf(classification),
        familyMemberId: null,
        escalation,
      },
      'emergency_template',
    );
  }

  // 2. Hard red flags: stop planning, explain, recommend a clinician; no model call.
  //    A request to restrict a child normally gets the growth-first reply instead, but a known red
  //    flag (an eating-disorder sign, rapid weight loss in a child) still escalates (S7-10).
  const hardReason = classification.categories.map((c) => CATEGORY_REASON[c]).find(Boolean);
  if (
    classification.safety === 'red_flag' &&
    (!classification.child_weight_request || hardReason)
  ) {
    const reason = hardReason ?? 'other_clinical';
    const escalation = escalationFor([hardFlag(reason)], null, locale) ?? {
      reason,
      family_member_id: null,
      message: RED_FLAG_REFERRAL[locale],
      recommend: REASON_RECOMMEND[reason],
    };
    const text = classification.fiqh_question
      ? `${escalation.message}\n\n${SCHOLAR_REFERRAL[locale]}`
      : escalation.message;
    return finishTemplate(
      text,
      escalation,
      {
        category: REASON_CATEGORY[reason],
        urgency: urgencyFor(reason),
        evidence: evidenceOf(classification),
        familyMemberId: null,
        escalation,
      },
      'red_flag_referral',
    );
  }

  // 3. Agent loop.
  const system = buildSystem(args, plan);
  const messages: ChatMessage[] = spec?.messages ?? firstMessages(args, plan);
  const registry = new CitationRegistry();
  const ctx: ToolContext = {
    locale,
    citations: registry,
    internalKcal: [],
    signal: args.signal,
  };
  const grounded: number[] = [...(args.groundedNumbers ?? [])];
  const toolsUsed: string[] = [];
  let toolEscalation: EscalationRecord | null = null;
  let draft = '';
  let finishReason: FinishReason = 'complete';

  for (let step = 0; step < plan.maxSteps; step++) {
    if (args.signal?.aborted) {
      finishReason = 'cancelled';
      break;
    }
    const last = step === plan.maxSteps - 1;
    let response;
    try {
      ({ response } = await (step === 0 && spec
        ? spec.promise
        : callStep(args, plan, system, messages, last, !!toolEscalation, args.signal, metadata)));
    } catch (err) {
      if (args.signal?.aborted) {
        finishReason = 'cancelled';
        break;
      }
      throw err;
    }
    base.usage = addUsage(base.usage, response.usage);
    base.model = response.model;
    const calls = response.content.filter(
      (p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call',
    );
    const text = response.content
      .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('');
    if (!calls.length || last) {
      draft = text;
      if (response.stopReason === 'max_tokens') finishReason = 'length';
      break;
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: ContentPart[] = [];
    for (const [i, call] of calls.entries()) {
      if (i >= MAX_TOOL_CALLS_PER_STEP || !isAgentTool(call.name)) {
        results.push({
          type: 'tool_result',
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            error: { code: 'TOOL_REJECTED', message: 'Unknown tool or too many calls.' },
          }),
          isError: true,
        });
        continue;
      }
      const name = call.name;
      if (!plan.tools.some((t) => t.name === name)) {
        // Not offered this turn (tier, contract or availability): answered to the model only, so
        // no event names a tool the client contract does not know.
        results.push({
          type: 'tool_result',
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            error: { code: 'TOOL_NOT_AVAILABLE', message: 'This tool is not available here.' },
          }),
          isError: true,
        });
        continue;
      }
      await emit({
        type: 'tool.call',
        toolCallId: call.id,
        name,
        display: toolMeta(name).label[locale].replace('{name}', ''),
      });
      let result: ToolResult;
      const parsed = TOOL_INPUTS[name].safeParse(call.input);
      if (!parsed.success) {
        result = {
          ok: false,
          error: {
            code: 'INVALID_ARGUMENTS',
            message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
          },
        };
      } else if (name === 'escalate_to_clinician') {
        const input = parsed.data as {
          familyMemberId?: string | null;
          category: string;
          urgency: EscalationRecord['urgency'];
          evidence: string;
          recommendedClinician: string;
        };
        const reason = TOOL_CATEGORY_REASON[input.category] ?? 'other_clinical';
        const escalation: EscalationOut = escalationFor(
          [
            {
              ...hardFlag(reason),
              recommend: CLINICIAN_RECOMMEND[input.recommendedClinician] ?? 'see_gp',
            },
          ],
          input.familyMemberId ?? null,
          locale,
        ) ?? {
          reason,
          family_member_id: input.familyMemberId ?? null,
          message: RED_FLAG_REFERRAL[locale],
          recommend: 'see_gp',
        };
        if (input.urgency === 'emergency_now') escalation.recommend = 'emergency';
        toolEscalation = {
          category: input.category,
          urgency: input.urgency,
          evidence: input.evidence,
          familyMemberId: input.familyMemberId ?? null,
          escalation,
        };
        await args.onEscalation?.(toolEscalation);
        result = {
          ok: true,
          data: {
            recorded: true,
            emergencyContacts: input.urgency === 'emergency_now' ? contacts : [],
            instruction:
              'Write a short, kind message recommending the clinician; for emergency_now lead with the emergency numbers. Do not continue planning for this person.',
          },
          summary: locale === 'ur' ? 'حفاظتی رہنمائی دی گئی' : 'Safety guidance shown',
        };
      } else {
        try {
          result = await withTimeout(
            args.executeTool(name, parsed.data, ctx),
            toolMeta(name).timeoutMs,
          );
        } catch (err) {
          result = {
            ok: false,
            error: {
              code: String(err).includes('TOOL_TIMEOUT') ? 'TIMEOUT' : 'TOOL_FAILED',
              message: 'The tool could not finish. Continue without it.',
            },
          };
        }
      }
      toolsUsed.push(name);
      if (result.ok) collectNumbers(result.data, grounded);
      base.toolCalls.push({
        id: call.id,
        name,
        input: call.input,
        ok: result.ok,
        summary: result.ok ? result.summary : result.error.code,
      });
      await emit({
        type: 'tool.result',
        toolCallId: call.id,
        name,
        ok: result.ok,
        summary: result.ok ? result.summary : undefined,
        card: result.ok ? result.card : undefined,
      });
      results.push({
        type: 'tool_result',
        toolCallId: call.id,
        content: JSON.stringify(result.ok ? { ok: true, data: result.data } : result),
        ...(result.ok ? {} : { isError: true }),
      });
    }
    messages.push({ role: 'tool', content: results });
  }

  if (finishReason === 'cancelled') {
    return {
      ...base,
      text: '',
      finishReason,
      citations: [],
      safetyFlags: ['incomplete'],
      aboutMinor: aboutMinorInput,
      escalation: toolEscalation?.escalation ?? null,
      followUps: [],
      bypassedModel: false,
    };
  }

  // 4. Output validators.
  const cited = resolveCitations(draft, registry);
  for (const f of cited.safetyFlags) flags.add(f);
  let text = cited.text;

  const grounding = filterSentences(
    text,
    (s) =>
      findUngroundedNumbers(s.replace(/\[\d{1,3}\]/gu, ''), {
        kcal: grounded,
        g: grounded,
        mg: grounded,
        ml: grounded,
        kg: grounded,
        cm: grounded,
        percent: grounded,
      }).length > 0,
  );
  if (grounding.removed) flags.add('ungrounded_numbers_removed');
  text = grounding.text;

  const aboutMinor = aboutMinorInput || minorMentioned(text);
  // The disclaimer is appended after the citation markers are settled.
  const guarded = guardOutput(text, {
    locale,
    aboutMinor,
    fiqhQuestion: classification.fiqh_question,
    disclaimer: false,
    internalKcalValues: ctx.internalKcal,
    youngNames: args.youngChildNames,
  });
  for (const f of guarded.safetyFlags) flags.add(f);
  text = guarded.text;

  if (args.modelOutputCheck && !guarded.replaced && text) {
    const review = await classifyOutputWithModel(text, classifyDeps);
    if (review && !review.pass) {
      flags.add('output_classifier_blocked');
      text = guardOutput(
        classification.fiqh_question ? SCHOLAR_REFERRAL[locale] : NO_TEXT[locale],
        { locale, aboutMinor, disclaimer: false },
      ).text;
    }
  }
  if (!text.trim()) {
    flags.add('empty_after_guardrails');
    text = NO_TEXT[locale];
  }

  // Citations whose marker did not survive are dropped; stray markers are stripped.
  const markers = new Set([...text.matchAll(/\[(\d{1,3})\]/gu)].map((m) => Number(m[1])));
  const citations = cited.citations.filter((c) => markers.has(c.marker));
  const valid = new Set(citations.map((c) => c.marker));
  text = text.replace(/\s?\[(\d{1,3})\]/gu, (m, n: string) => (valid.has(Number(n)) ? m : ''));

  const healthDisclaimer =
    !hasDisclaimer(text) &&
    /\b(kcal|calorie|protein|portion|diabetes|blood sugar|pregnan|breastfeed|allerg|medicine|medication|fasting|doctor|paediatrician|pediatrician|growth)\b|(کیلوری|ذیابیطس|حمل|الرجی|دوا|روزہ|ڈاکٹر)/iu.test(
      text,
    );
  if (healthDisclaimer && !guarded.replaced)
    text = `${text.trimEnd()}\n\n${DISCLAIMER_TEXT[locale]}`;

  // 5. Release.
  for (const chunk of deltaChunks(text)) await emit({ type: 'delta', text: chunk });
  for (const c of citations) await emit({ type: 'citation', citation: c });
  if (toolEscalation) {
    finishReason = 'escalated';
    await emit({ type: 'safety', action: 'escalate', escalation: toolEscalation.escalation });
  } else if (
    aboutMinor &&
    (classification.child_weight_request ||
      flags.has('child_restriction_blocked') ||
      ctx.internalKcal.length > 0)
  ) {
    await emit({
      type: 'safety',
      action: 'notice',
      noticeKey: 'safety.notice.child_no_restriction',
    });
  } else if (classification.fiqh_question) {
    await emit({ type: 'safety', action: 'notice', noticeKey: 'safety.notice.ask_a_scholar' });
  } else if (healthDisclaimer) {
    await emit({ type: 'safety', action: 'notice', noticeKey: 'safety.notice.not_medical_advice' });
  }
  const suggestions =
    finishReason === 'complete'
      ? followUps(followUpTopic({ toolsUsed, aboutMinor, isRamadan: args.isRamadan }), locale)
      : [];
  if (suggestions.length) await emit({ type: 'follow_up', suggestions });

  return {
    ...base,
    text,
    finishReason,
    citations,
    safetyFlags: [...flags],
    aboutMinor,
    escalation: toolEscalation?.escalation ?? null,
    followUps: suggestions,
    bypassedModel: false,
  };
}
