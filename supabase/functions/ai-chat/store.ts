import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Catalog,
  ClimateZone,
  GrowthRow,
  KnowledgeRpc,
  RecalledMemory,
  SensoryLite,
} from '@thuluth/ai-core';
import type { ActivityLevel, SexAtBirth } from '@thuluth/shared';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import { check, selectAll } from '../_shared/platform.ts';
import { supabasePlanStore } from '../_shared/plan/store.ts';
import type { BudgetProfileRow, MemberRecord, PlanHouseholdRow } from '../_shared/plan/store.ts';

/**
 * Data access for `ai-chat` (06 §4.1, 12 §6-§8). Service role: the handler checks membership,
 * consents and entitlement before any read, and every query is scoped to the household.
 */

export interface ChatHousehold extends PlanHouseholdRow {
  /** `regions.climate_zone` of the household region (hydration targets). */
  climate_zone: ClimateZone | null;
}

export interface ChatUser {
  locale: string | null;
  timezone: string | null;
  tradition_preference: 'shared' | 'sunni' | 'shia';
  ai_memory_enabled: boolean;
}

export interface ChatMember extends MemberRecord {
  sex_at_birth: SexAtBirth;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: ActivityLevel;
  pregnancy: { trimester: 1 | 2 | 3 | null; gestational_diabetes: boolean } | null;
}

export interface ChatSessionRow {
  id: string;
  household_id: string;
  user_id: string;
  title: string;
  context_snapshot: Record<string, unknown>;
  deleted_at: string | null;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
export type StoredFinish = 'complete' | 'escalated' | 'length' | 'cancelled' | 'error';

export interface ChatMessageRow {
  id: string;
  session_id: string;
  household_id: string;
  role: ChatRole;
  content: string;
  attachments: unknown[];
  /**
   * Server-only record of the turn (not granted to `authenticated`): tool calls, citations, the
   * safety event and follow-ups, so a replay can stream the same events.
   */
  tool_calls: unknown[];
  safety_flags: string[];
  client_message_id: string | null;
  finish_reason: StoredFinish | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export type ChatMessageInsert = Pick<ChatMessageRow, 'session_id' | 'household_id' | 'role'> &
  Partial<
    Pick<
      ChatMessageRow,
      | 'id'
      | 'content'
      | 'attachments'
      | 'tool_calls'
      | 'safety_flags'
      | 'client_message_id'
      | 'finish_reason'
      | 'model'
    >
  > & { tokens_in?: number | null; tokens_out?: number | null };

export type ChatMessagePatch = Partial<
  Pick<ChatMessageRow, 'content' | 'tool_calls' | 'safety_flags' | 'finish_reason' | 'model'>
> & { tokens_in?: number | null; tokens_out?: number | null };

export interface ActivePlanSummary {
  id: string;
  kind: string;
  title: string | null;
  start_date: string;
  end_date: string;
  version: number;
  todays_meals: Array<{ meal_type: string; title: string; time: string | null }>;
}

export interface GroceryEstimate {
  grocery_list_id: string;
  meal_plan_id: string | null;
  estimated_total_minor: number;
  currency: string;
  starts_on: string;
  ends_on: string;
}

export interface ChatSafetyEventInsert {
  household_id: string;
  family_member_id: string | null;
  user_id: string;
  source: 'chat';
  category: string;
  urgency: 'emergency_now' | 'same_day' | 'soon' | 'routine';
  evidence: string;
  chat_message_id: string | null;
}

export interface MemoryInsert {
  household_id: string;
  family_member_id: string | null;
  fact: string;
  kind: 'preference' | 'routine' | 'context' | 'goal_context';
  confidence: number;
  embedding: string;
  expires_at: string;
  source_message_id: string | null;
}

export interface MealLogSummary {
  id: string;
  family_member_id: string;
  meal_type: string;
  description: string;
  eaten_at: string;
}

export interface ChatStore {
  household(householdId: string): Promise<ChatHousehold | null>;
  user(userId: string): Promise<ChatUser | null>;
  activeConsents(userId: string, householdId: string): Promise<ConsentKind[]>;
  /** `feature_flags['ai.caps'].rules` (12 §17); {} when the flag is missing or off. */
  capsRules(): Promise<Record<string, unknown>>;
  /** `ai_quota_check(user, route)`: daily message cap and the monthly cost ceiling. */
  quotaCheck(
    userId: string,
    routeKey: string,
  ): Promise<{ allowed: boolean; remaining: number | null; degrade_to: string | null }>;
  /** Sum of `ai_usage.cost_usd_micros` since `since` for one user, or for everyone when null. */
  costSince(userId: string | null, since: string): Promise<number>;

  session(sessionId: string): Promise<ChatSessionRow | null>;
  createSession(row: {
    household_id: string;
    user_id: string;
    title: string;
  }): Promise<ChatSessionRow>;
  updateSession(
    sessionId: string,
    patch: { context_snapshot?: Record<string, unknown> },
  ): Promise<void>;
  /**
   * An earlier turn with this `client_message_id` by this user in this household (any session):
   * the user row, and the assistant row when one was started.
   */
  turnByClientId(
    householdId: string,
    userId: string,
    clientMessageId: string,
  ): Promise<{
    session: ChatSessionRow;
    user: ChatMessageRow;
    assistant: ChatMessageRow | null;
  } | null>;
  /** The newest `limit` user and assistant messages, returned oldest first. */
  recentMessages(sessionId: string, limit: number): Promise<ChatMessageRow[]>;
  insertMessage(row: ChatMessageInsert): Promise<ChatMessageRow>;
  updateMessage(id: string, patch: ChatMessagePatch): Promise<void>;

  members(householdId: string): Promise<ChatMember[]>;
  activePlan(householdId: string, today: string): Promise<ActivePlanSummary | null>;
  budget(householdId: string): Promise<BudgetProfileRow | null>;
  catalog(householdId: string): Promise<{ catalog: Catalog; includeInReview: boolean }>;
  /** Latest grocery list of a plan, or the list itself. */
  groceryEstimate(
    householdId: string,
    target: { mealPlanId: string } | { groceryListId: string },
  ): Promise<GroceryEstimate | null>;
  mealLog(householdId: string, mealLogId: string): Promise<MealLogSummary | null>;
  /** `growth_tracking` rows of one member, newest first (computed values; S6). */
  growthRows(householdId: string, familyMemberId: string, limit: number): Promise<GrowthRow[]>;
  /** The member's live `sensory_profiles` row (autism module), or null. */
  sensoryProfile(householdId: string, familyMemberId: string): Promise<SensoryLite | null>;

  /** Retrieval RPCs (`search_islamic_sources`, `match_knowledge`): citable rows only. */
  knowledge: KnowledgeRpc;
  /**
   * Defence in depth for citations: which of the ids are citable right now (verified with two
   * approvals and not retracted; verified recommendations).
   */
  citable(
    sourceIds: readonly string[],
    recommendationIds: readonly string[],
  ): Promise<{ sources: Set<string>; recommendations: Set<string> }>;
  insertSafetyEvent(row: ChatSafetyEventInsert): Promise<void>;

  recallMemories(
    householdId: string,
    embedding: string,
    familyMemberId: string | null,
    limit: number,
  ): Promise<RecalledMemory[]>;
  memoryFacts(householdId: string): Promise<string[]>;
  insertMemories(rows: MemoryInsert[]): Promise<void>;

  /** Downloads `chat-attachments/{path}`; null when missing. */
  downloadAttachment(path: string): Promise<Uint8Array | null>;
}

// ---- Supabase implementation ---------------------------------------------------------------------

const MESSAGE_COLUMNS =
  'id, session_id, household_id, role, content, attachments, tool_calls, safety_flags, client_message_id, finish_reason, model, created_at, updated_at';

export function supabaseChatStore(admin: SupabaseClient): ChatStore {
  const plan = supabasePlanStore(admin);
  return {
    async household(householdId) {
      const row = await plan.household(householdId);
      if (!row) return null;
      let climate: ClimateZone | null = null;
      if (row.region_id) {
        const region = check(
          await admin.from('regions').select('climate_zone').eq('id', row.region_id).maybeSingle(),
        ) as { climate_zone: ClimateZone } | null;
        climate = region?.climate_zone ?? null;
      }
      return { ...row, climate_zone: climate };
    },
    async user(userId) {
      return check(
        await admin
          .from('users')
          .select('locale, timezone, tradition_preference, ai_memory_enabled')
          .eq('id', userId)
          .maybeSingle(),
      ) as ChatUser | null;
    },
    activeConsents: (u, h) => plan.activeConsents(u, h),
    async capsRules() {
      const row = check(
        await admin
          .from('feature_flags')
          .select('enabled, rules')
          .eq('key', 'ai.caps')
          .maybeSingle(),
      ) as { enabled: boolean; rules: Record<string, unknown> | null } | null;
      return row?.enabled ? (row.rules ?? {}) : {};
    },
    async quotaCheck(userId, routeKey) {
      const rows = check(
        await admin.rpc('ai_quota_check', { p_user_id: userId, p_route_key: routeKey }),
      ) as Array<{ allowed: boolean; remaining: number | null; degrade_to: string | null }>;
      return rows[0] ?? { allowed: false, remaining: 0, degrade_to: null };
    },
    async costSince(userId, since) {
      const rows = await selectAll<{ cost_usd_micros: number }>((from, to) => {
        let q = admin.from('ai_usage').select('cost_usd_micros').gte('created_at', since);
        if (userId) q = q.eq('user_id', userId);
        return q.order('created_at').range(from, to);
      });
      return rows.reduce((s, r) => s + Number(r.cost_usd_micros ?? 0), 0);
    },

    async session(sessionId) {
      return check(
        await admin
          .from('chat_sessions')
          .select('id, household_id, user_id, title, context_snapshot, deleted_at')
          .eq('id', sessionId)
          .maybeSingle(),
      ) as ChatSessionRow | null;
    },
    async createSession(row) {
      return check(
        await admin
          .from('chat_sessions')
          .insert(row)
          .select('id, household_id, user_id, title, context_snapshot, deleted_at')
          .single(),
      ) as ChatSessionRow;
    },
    async updateSession(sessionId, patch) {
      check(await admin.from('chat_sessions').update(patch).eq('id', sessionId));
    },
    async turnByClientId(householdId, userId, clientMessageId) {
      const rows = check(
        await admin
          .from('chat_messages')
          .select(MESSAGE_COLUMNS)
          .eq('household_id', householdId)
          .eq('client_message_id', clientMessageId)
          .in('role', ['user', 'assistant']),
      ) as ChatMessageRow[];
      const user = rows.find((r) => r.role === 'user');
      if (!user) return null;
      const session = check(
        await admin
          .from('chat_sessions')
          .select('id, household_id, user_id, title, context_snapshot, deleted_at')
          .eq('id', user.session_id)
          .eq('user_id', userId)
          .maybeSingle(),
      ) as ChatSessionRow | null;
      if (!session) return null;
      const assistant = rows.find(
        (r) => r.role === 'assistant' && r.session_id === user.session_id,
      );
      return { session, user, assistant: assistant ?? null };
    },
    async recentMessages(sessionId, limit) {
      const rows = check(
        await admin
          .from('chat_messages')
          .select(MESSAGE_COLUMNS)
          .eq('session_id', sessionId)
          .in('role', ['user', 'assistant'])
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as ChatMessageRow[];
      return rows.reverse();
    },
    async insertMessage(row) {
      return check(
        await admin.from('chat_messages').insert(row).select(MESSAGE_COLUMNS).single(),
      ) as ChatMessageRow;
    },
    async updateMessage(id, patch) {
      check(await admin.from('chat_messages').update(patch).eq('id', id));
    },

    async members(householdId) {
      const records = await plan.members(householdId);
      if (!records.length) return [];
      const ids = records.map((r) => r.id);
      const body = check(
        await admin
          .from('family_members')
          .select('id, sex_at_birth, height_cm, weight_kg, activity_level')
          .in('id', ids),
      ) as Array<{
        id: string;
        sex_at_birth: SexAtBirth;
        height_cm: number | string | null;
        weight_kg: number | string | null;
        activity_level: ActivityLevel;
      }>;
      const pregnancies = check(
        await admin
          .from('pregnancy_profiles')
          .select('family_member_id, trimester, gestational_diabetes')
          .eq('household_id', householdId)
          .is('deleted_at', null),
      ) as Array<{
        family_member_id: string;
        trimester: 1 | 2 | 3 | null;
        gestational_diabetes: boolean;
      }>;
      const byId = new Map(body.map((b) => [b.id, b]));
      const preg = new Map(pregnancies.map((p) => [p.family_member_id, p]));
      return records.map((r) => {
        const b = byId.get(r.id);
        const p = preg.get(r.id);
        return {
          ...r,
          sex_at_birth: b?.sex_at_birth ?? 'unspecified',
          height_cm: b?.height_cm == null ? null : Number(b.height_cm),
          weight_kg: b?.weight_kg == null ? null : Number(b.weight_kg),
          activity_level: b?.activity_level ?? 'moderate',
          pregnancy: p
            ? { trimester: p.trimester, gestational_diabetes: p.gestational_diabetes }
            : null,
        };
      });
    },
    async activePlan(householdId, today) {
      const row = check(
        await admin
          .from('meal_plans')
          .select('id, kind, title, start_date, end_date, version')
          .eq('household_id', householdId)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as Omit<ActivePlanSummary, 'todays_meals'> | null;
      if (!row) return null;
      const meals = check(
        await admin
          .from('daily_meals')
          .select('meal_type, slot, scheduled_time, meals!daily_meals_meal_id_fkey(title)')
          .eq('meal_plan_id', row.id)
          .eq('plan_date', today)
          .order('meal_type')
          .order('slot'),
      ) as unknown as Array<{
        meal_type: string;
        scheduled_time: string | null;
        meals: { title: string } | null;
      }>;
      return {
        ...row,
        todays_meals: meals.map((m) => ({
          meal_type: m.meal_type,
          title: m.meals?.title ?? '',
          time: m.scheduled_time,
        })),
      };
    },
    budget: (h) => plan.budgetProfile(h),
    catalog: (h) => plan.catalog(h),
    async groceryEstimate(householdId, target) {
      let q = admin
        .from('grocery_lists')
        .select('id, meal_plan_id, estimated_total_minor, currency, starts_on, ends_on')
        .eq('household_id', householdId)
        .is('deleted_at', null);
      q =
        'mealPlanId' in target
          ? q.eq('meal_plan_id', target.mealPlanId)
          : q.eq('id', target.groceryListId);
      const row = check(
        await q.order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ) as {
        id: string;
        meal_plan_id: string | null;
        estimated_total_minor: number;
        currency: string;
        starts_on: string;
        ends_on: string;
      } | null;
      return row
        ? {
            grocery_list_id: row.id,
            meal_plan_id: row.meal_plan_id,
            estimated_total_minor: Number(row.estimated_total_minor),
            currency: row.currency,
            starts_on: row.starts_on,
            ends_on: row.ends_on,
          }
        : null;
    },
    async mealLog(householdId, mealLogId) {
      return check(
        await admin
          .from('meal_logs')
          .select('id, family_member_id, meal_type, description, eaten_at')
          .eq('household_id', householdId)
          .eq('id', mealLogId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as MealLogSummary | null;
    },

    async growthRows(householdId, familyMemberId, limit) {
      const rows = check(
        await admin
          .from('growth_tracking')
          .select(
            'measured_on, reference, age_months, height_for_age_percentile, weight_for_age_percentile, bmi_for_age_percentile, head_circumference_for_age_percentile, weight_for_age_z, height_for_age_z, flags, computed_at',
          )
          .eq('household_id', householdId)
          .eq('family_member_id', familyMemberId)
          .not('computed_at', 'is', null)
          .order('measured_on', { ascending: false })
          .limit(limit),
      ) as Array<Record<string, unknown>>;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return rows.map((r) => ({
        measured_on: String(r.measured_on),
        reference: String(r.reference),
        age_months: n(r.age_months),
        height_for_age_percentile: n(r.height_for_age_percentile),
        weight_for_age_percentile: n(r.weight_for_age_percentile),
        bmi_for_age_percentile: n(r.bmi_for_age_percentile),
        head_circumference_for_age_percentile: n(r.head_circumference_for_age_percentile),
        weight_for_age_z: n(r.weight_for_age_z),
        height_for_age_z: n(r.height_for_age_z),
        flags: (r.flags as string[] | null) ?? [],
        computed_at: (r.computed_at as string | null) ?? null,
      }));
    },
    async sensoryProfile(householdId, familyMemberId) {
      const row = check(
        await admin
          .from('sensory_profiles')
          .select('texture_likes, texture_avoids, color_sensitivities, temperature_prefs')
          .eq('household_id', householdId)
          .eq('family_member_id', familyMemberId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as {
        texture_likes: string[];
        texture_avoids: string[];
        color_sensitivities: string[];
        temperature_prefs: string[];
      } | null;
      return row
        ? {
            textureLikes: row.texture_likes ?? [],
            textureAvoids: row.texture_avoids ?? [],
            colorSensitivities: row.color_sensitivities ?? [],
            temperaturePrefs: row.temperature_prefs ?? [],
          }
        : null;
    },

    knowledge: {
      async matchKnowledge(args) {
        return (check(await admin.rpc('match_knowledge', args)) ?? []) as Awaited<
          ReturnType<KnowledgeRpc['matchKnowledge']>
        >;
      },
      async searchIslamicSources(args) {
        return (check(await admin.rpc('search_islamic_sources', args)) ?? []) as Awaited<
          ReturnType<KnowledgeRpc['searchIslamicSources']>
        >;
      },
    },
    async citable(sourceIds, recommendationIds) {
      const sources = sourceIds.length
        ? (check(
            await admin
              .from('citable_islamic_sources')
              .select('id')
              .in('id', [...sourceIds]),
          ) as { id: string }[])
        : [];
      const recs = recommendationIds.length
        ? (check(
            await admin
              .from('recommendations')
              .select('id')
              .in('id', [...recommendationIds])
              .eq('review_status', 'verified'),
          ) as { id: string }[])
        : [];
      return {
        sources: new Set(sources.map((r) => r.id)),
        recommendations: new Set(recs.map((r) => r.id)),
      };
    },
    async insertSafetyEvent(row) {
      check(await admin.from('safety_events').insert(row));
    },

    async recallMemories(householdId, embedding, familyMemberId, limit) {
      const rows = check(
        await admin.rpc('match_ai_memories', {
          p_household_id: householdId,
          p_query_embedding: embedding,
          p_limit: limit,
          p_family_member_id: familyMemberId,
        }),
      ) as Array<{ family_member_id: string | null; fact: string; kind: string; score: number }>;
      return (rows ?? []).map((r) => ({
        fact: r.fact,
        familyMemberId: r.family_member_id,
        kind: r.kind,
        score: Number(r.score),
      }));
    },
    async memoryFacts(householdId) {
      const rows = check(
        await admin
          .from('ai_memories')
          .select('fact')
          .eq('household_id', householdId)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as { fact: string }[];
      return rows.map((r) => r.fact);
    },
    async insertMemories(rows) {
      if (rows.length) check(await admin.from('ai_memories').insert(rows));
    },

    async downloadAttachment(path) {
      const { data, error } = await admin.storage.from('chat-attachments').download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
