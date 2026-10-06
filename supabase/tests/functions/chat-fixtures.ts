import { AIError, FakeProvider, RouteResolver } from '@thuluth/ai-core';
import type {
  AiModelRouteRow,
  AiUsageInsert,
  ChatRequest,
  ChatResponse,
  KnowledgeMatch,
  SourceHit,
} from '@thuluth/ai-core';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import type {
  ChatMember,
  ChatMessageRow,
  ChatSafetyEventInsert,
  ChatSessionRow,
  ChatStore,
  MemoryInsert,
} from '../../functions/ai-chat/store.ts';
import { fromPostgrestError } from '../../functions/_shared/errors.ts';
import { FAMILY, HH, uuidCatalog } from './plan-fixtures.ts';

/**
 * In-memory `ChatStore`, the Usman family with body data, and a scripted provider for the chat
 * routes. The fake provider serves every route; `script` sees the model name to tell them apart.
 */

export const PLAN_ID = '00000000-0000-4000-8000-0000000000a1';
export const GROCERY_ID = '00000000-0000-4000-8000-0000000000b1';
export const SOURCE_VERIFIED = '00000000-0000-4000-8000-0000000000c1';
export const SOURCE_UNVERIFIED = '00000000-0000-4000-8000-0000000000c2';
export const REC_VERIFIED = '00000000-0000-4000-8000-0000000000d1';

export const CHAT_FAMILY: ChatMember[] = FAMILY.map((m) => ({
  ...m,
  sex_at_birth: m.name === 'Usman' || m.name === 'Ibrahim' ? 'male' : 'female',
  height_cm: m.name === 'Usman' ? 178 : m.name === 'Hina' ? 160 : m.name === 'Ibrahim' ? 128 : 98,
  weight_kg: m.name === 'Usman' ? 92 : m.name === 'Hina' ? 62 : m.name === 'Ibrahim' ? 26 : 15,
  activity_level: 'moderate',
  pregnancy: null,
}));

export interface ChatMemoryOptions {
  consents?: ConsentKind[];
  members?: ChatMember[];
  quota?: { allowed: boolean; remaining: number | null; degrade_to: string | null };
  costToday?: { user?: number; global?: number };
  rules?: Record<string, unknown>;
  memoryEnabled?: boolean;
  locale?: string;
}

export function memoryChatStore(opts: ChatMemoryOptions = {}) {
  const state = {
    sessions: [] as ChatSessionRow[],
    messages: [] as ChatMessageRow[],
    safety: [] as ChatSafetyEventInsert[],
    memories: [] as MemoryInsert[],
    quota: opts.quota ?? { allowed: true, remaining: 15, degrade_to: null },
    costToday: { user: opts.costToday?.user ?? 0, global: opts.costToday?.global ?? 0 },
    rules: opts.rules ?? {},
    consents: opts.consents ?? (['ai_processing', 'health_data', 'child_data'] as ConsentKind[]),
    members: opts.members ?? CHAT_FAMILY,
    sourceRpcCalls: 0,
  };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 6, 8, 0, clock++)).toISOString();
  const catalog = uuidCatalog();

  const store: ChatStore = {
    household: async (id) =>
      id === HH
        ? {
            id: HH,
            owner_user_id: 'owner',
            country_code: 'PK',
            timezone: 'Asia/Karachi',
            currency: 'PKR',
            region_id: null,
            preferences: {},
            climate_zone: 'hot_semi_arid',
          }
        : null,
    user: async () => ({
      locale: opts.locale ?? 'en',
      timezone: 'Asia/Karachi',
      tradition_preference: 'shared',
      ai_memory_enabled: opts.memoryEnabled ?? true,
    }),
    activeConsents: async () => state.consents,
    capsRules: async () => state.rules,
    quotaCheck: async () => state.quota,
    costSince: async (userId) => (userId ? state.costToday.user : state.costToday.global),

    session: async (id) => state.sessions.find((s) => s.id === id) ?? null,
    createSession: async (row) => {
      const s: ChatSessionRow = {
        id: crypto.randomUUID(),
        context_snapshot: {},
        deleted_at: null,
        ...row,
      };
      state.sessions.push(s);
      return s;
    },
    updateSession: async () => {},
    turnByClientId: async (householdId, userId, cmid) => {
      const user = state.messages.find(
        (m) => m.household_id === householdId && m.role === 'user' && m.client_message_id === cmid,
      );
      if (!user) return null;
      const session = state.sessions.find((s) => s.id === user.session_id && s.user_id === userId);
      if (!session) return null;
      const assistant =
        state.messages.find(
          (m) =>
            m.session_id === session.id && m.role === 'assistant' && m.client_message_id === cmid,
        ) ?? null;
      return { session, user, assistant };
    },
    recentMessages: async (sessionId, limit) =>
      state.messages
        .filter((m) => m.session_id === sessionId && (m.role === 'user' || m.role === 'assistant'))
        .slice(-limit),
    insertMessage: async (row) => {
      const dup = state.messages.find(
        (m) =>
          m.session_id === row.session_id &&
          m.role === row.role &&
          row.client_message_id &&
          m.client_message_id === row.client_message_id,
      );
      if (dup) throw fromPostgrestError({ code: '23505' });
      const at = stamp();
      const msg: ChatMessageRow = {
        id: row.id ?? crypto.randomUUID(),
        content: '',
        attachments: [],
        tool_calls: [],
        safety_flags: [],
        client_message_id: null,
        finish_reason: null,
        model: null,
        created_at: at,
        updated_at: at,
        ...row,
      };
      state.messages.push(msg);
      return msg;
    },
    updateMessage: async (id, patch) => {
      const m = state.messages.find((x) => x.id === id);
      if (m) {
        const { tokens_in: _i, tokens_out: _o, ...rest } = patch;
        Object.assign(m, rest, { updated_at: stamp() });
      }
    },

    members: async () => state.members,
    activePlan: async () => ({
      id: PLAN_ID,
      kind: 'standard',
      title: 'Week plan',
      start_date: '2026-10-05',
      end_date: '2026-10-11',
      version: 1,
      todays_meals: [
        { meal_type: 'breakfast', title: 'Paratha and egg', time: '08:00' },
        { meal_type: 'dinner', title: 'Chicken karahi', time: '20:00' },
      ],
    }),
    budget: async () => ({
      id: 'b1',
      monthly_amount_minor: 4_000_000,
      currency: 'PKR',
      strictness: 'target',
    }),
    catalog: async () => ({ catalog, includeInReview: false }),
    groceryEstimate: async (_h, target) =>
      'mealPlanId' in target && target.mealPlanId === PLAN_ID
        ? {
            grocery_list_id: GROCERY_ID,
            meal_plan_id: PLAN_ID,
            estimated_total_minor: 1_250_000,
            currency: 'PKR',
            starts_on: '2026-10-05',
            ends_on: '2026-10-11',
          }
        : null,
    mealLog: async () => null,

    knowledge: {
      matchKnowledge: async (): Promise<KnowledgeMatch[]> => [
        {
          item_kind: 'recommendation',
          item_id: REC_VERIFIED,
          code: 'rec-water-before-meals',
          traditions: ['shared'],
          label: 'Water before meals',
          similarity: 0.8,
        },
      ],
      searchIslamicSources: async (): Promise<SourceHit[]> => {
        state.sourceRpcCalls++;
        return [
          {
            islamic_source_id: SOURCE_VERIFIED,
            code: 'tirmidhi-2380',
            kind: 'hadith',
            tradition: 'shared',
            citation_text: 'Tirmidhi 2380; Ibn Majah 3349 (sahih)',
            score: 0.9,
          },
          {
            // Returned by a misbehaving RPC but not citable: must never be cited.
            islamic_source_id: SOURCE_UNVERIFIED,
            code: 'unverified-1',
            kind: 'hadith',
            tradition: 'shared',
            citation_text: 'Unverified narration',
            score: 0.8,
          },
        ];
      },
    },
    citable: async (sourceIds, recIds) => ({
      sources: new Set(sourceIds.filter((id) => id === SOURCE_VERIFIED)),
      recommendations: new Set(recIds.filter((id) => id === REC_VERIFIED)),
    }),
    insertSafetyEvent: async (row) => {
      state.safety.push(row);
    },
    recallMemories: async () =>
      state.memories.map((m) => ({
        fact: m.fact,
        familyMemberId: m.family_member_id,
        kind: m.kind,
        score: 0.9,
      })),
    memoryFacts: async () => state.memories.map((m) => m.fact),
    insertMemories: async (rows) => {
      state.memories.push(...rows);
    },
    downloadAttachment: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2]),
  };
  return { store, state };
}

const route = (route_key: string, model: string): AiModelRouteRow => ({
  route_key,
  provider: 'anthropic',
  model,
  params: {},
  priority: 1,
  enabled: true,
});

export const CHAT_ROUTES: AiModelRouteRow[] = [
  route('chat.default', 'chat-premium'),
  route('chat.free', 'chat-free'),
  route('classify.safety', 'claude-haiku-4-5'),
  route('chat.summarize', 'summarize'),
  route('embed.knowledge', 'embed'),
  route('vision.meal_analysis', 'vision'),
  route('speech.transcribe', 'transcribe'),
];

export const textOut = (t: string): Partial<ChatResponse> => ({
  content: [{ type: 'text', text: t }],
});
export const toolOut = (name: string, input: unknown, id = 'tc_1'): Partial<ChatResponse> => ({
  content: [{ type: 'tool_call', id, name, input }],
  stopReason: 'tool_use',
});

export type ChatScript = (
  req: ChatRequest,
  model: string,
  step: number,
) => Partial<ChatResponse> | AIError | undefined;

/** Fake deps. Classifier calls default to "ok"; main chat steps are counted per model. */
export function chatDeps(script: ChatScript = () => textOut('Here is a simple idea.')) {
  const usage: AiUsageInsert[] = [];
  const steps = new Map<string, number>();
  const provider = new FakeProvider({
    id: 'anthropic',
    script: (req, model) => {
      if (model === 'claude-haiku-4-5') {
        const sys = req.system[0]?.type === 'text' ? req.system[0].text : '';
        return textOut(
          sys.includes('"pass"')
            ? JSON.stringify({ pass: true, categories: [] })
            : JSON.stringify({ safety: 'ok', categories: [] }),
        );
      }
      const n = steps.get(model) ?? 0;
      steps.set(model, n + 1);
      const out = script(req, model, n);
      if (out instanceof AIError) return out;
      return out ?? textOut('{"facts":[]}');
    },
  });
  return {
    usage,
    provider,
    steps,
    fallback: {
      resolver: new RouteResolver(async (key) => CHAT_ROUTES.filter((r) => r.route_key === key)),
      providers: { anthropic: provider },
      sleep: async () => {},
    },
    writeUsage: async (row: AiUsageInsert) => {
      usage.push(row);
    },
  };
}

export interface SseEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
}

/** Parses an SSE body into events (comments such as `: ping` are skipped). */
export async function readSse(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  const out: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter((l) => l && !l.startsWith(':'));
    if (!lines.length) continue;
    const get = (k: string) => lines.find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2) ?? '';
    out.push({ id: Number(get('id')), event: get('event'), data: JSON.parse(get('data')) });
  }
  return out;
}

export { AIError };
