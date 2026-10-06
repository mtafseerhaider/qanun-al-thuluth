import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';
import type { HouseholdRole } from '@thuluth/shared';

import { fromPostgrestError } from '../_shared/errors.ts';
import type { PgErrorLike } from '../_shared/errors.ts';

/** Intake data for one member, read with the column names of 05 §6.5 and §8 (S2-02 migration). */
export interface MemberContext {
  id: string;
  name: string;
  date_of_birth: string | null;
  sex_at_birth: 'female' | 'male' | 'unspecified';
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  special_modules: string[];
  sleep_schedule: { bed?: string; wake?: string };
  lifestyle: {
    meal_pattern?: Array<{ meal: string; time?: string }>;
    fasting_practice?: string[];
  };
  conditions: Array<{
    label: string;
    condition_code: string | null;
    on_insulin_or_sulfonylurea: boolean;
  }>;
  allergies: Array<{ kind: string; severity: string; allergen_code: string | null }>;
  medications: Array<{ name: string; food_interaction_flags: string[] }>;
  goals: Array<{
    goal_type: string;
    is_primary: boolean;
    target_value: number | null;
    target_unit: string | null;
  }>;
  pregnancy: { trimester: number | null; gestational_diabetes: boolean } | null;
  has_sensory_profile: boolean;
  safe_food_count: number;
}

export interface HouseholdContext {
  id: string;
  country_code: string;
  timezone: string;
  climate_zone: string | null;
}

export interface RecommendationRow {
  id: string;
  code: string;
  applies_to: Record<string, unknown>;
  contraindications: Record<string, unknown>;
}

export type IdempotencyBegin =
  | { state: 'new'; id: string }
  | { state: 'replay'; status: number; body: unknown }
  | { state: 'in_progress' }
  | { state: 'mismatch' };

export interface AssessmentInsert {
  id: string;
  household_id: string;
  family_member_id: string;
  kind: 'intake' | 'periodic';
  summary: string;
  energy_targets: Record<string, unknown>;
  macro_targets: Record<string, unknown>;
  hydration_targets: Record<string, unknown>;
  risk_flags: string[];
  input_snapshot: Record<string, unknown>;
  model_route: string;
  model: string | null;
  prompt_version: string;
  created_by_user_id: string;
}

export interface SafetyEventInsert {
  household_id: string;
  family_member_id: string;
  user_id: string;
  source: 'intake';
  category: string;
  urgency: 'emergency_now' | 'same_day' | 'soon' | 'routine';
  evidence: string;
}

/** Data access for `ai-intake-assess`, so the handler can be tested without a database. */
export interface IntakeStore {
  household(householdId: string): Promise<HouseholdContext | null>;
  membership(householdId: string, userId: string): Promise<HouseholdRole | null>;
  userProfile(userId: string): Promise<{ locale: string } | null>;
  hasPremium(userId: string): Promise<boolean>;
  /** Live consent kinds for the user: global ones plus those scoped to this household. */
  activeConsents(userId: string, householdId: string): Promise<ConsentKind[]>;
  consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; reset_at: string }>;
  idempotencyBegin(
    scope: string,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyBegin>;
  idempotencyComplete(id: string, status: number, body: unknown): Promise<void>;
  idempotencyFail(id: string): Promise<void>;
  /** Active (not soft-deleted) members, optionally limited to `ids`. */
  members(householdId: string, ids?: readonly string[]): Promise<MemberContext[]>;
  verifiedRecommendations(): Promise<RecommendationRow[]>;
  insertAssessments(rows: AssessmentInsert[]): Promise<void>;
  setHydrationTarget(args: {
    householdId: string;
    familyMemberId: string;
    dailyMl: number;
    schedule: unknown[];
    basis: Record<string, unknown>;
  }): Promise<void>;
  insertSafetyEvents(rows: SafetyEventInsert[]): Promise<void>;
  audit(entry: {
    actor: string;
    householdId: string;
    action: string;
    entity: string;
    entityId: string | null;
    diff: Record<string, unknown>;
  }): Promise<void>;
}

function check<T>(result: { data: T; error: PgErrorLike | null }): T {
  if (result.error) throw fromPostgrestError(result.error);
  return result.data;
}

const live = <T extends { deleted_at?: string | null }>(rows: T[] | null | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deleted_at);

const MEMBER_SELECT = `id, name, date_of_birth, sex_at_birth, height_cm, weight_kg, activity_level,
  special_modules, sleep_schedule, lifestyle,
  medical_conditions(label, condition_code, on_insulin_or_sulfonylurea, deleted_at),
  allergies(kind, severity, deleted_at, allergens(code)),
  medications(name, food_interaction_flags, deleted_at),
  nutrition_goals(goal_type, is_primary, target_value, target_unit, deleted_at),
  pregnancy_profiles(trimester, gestational_diabetes, deleted_at),
  sensory_profiles(id, deleted_at),
  food_preferences(is_safe_food, deleted_at)`;

interface MemberRow {
  id: string;
  name: string;
  date_of_birth: string | null;
  sex_at_birth: MemberContext['sex_at_birth'];
  height_cm: number | string | null;
  weight_kg: number | string | null;
  activity_level: MemberContext['activity_level'];
  special_modules: string[] | null;
  sleep_schedule: MemberContext['sleep_schedule'] | null;
  lifestyle: MemberContext['lifestyle'] | null;
  medical_conditions: Array<MemberContext['conditions'][number] & { deleted_at: string | null }>;
  allergies: Array<{
    kind: string;
    severity: string;
    deleted_at: string | null;
    allergens: { code: string } | null;
  }>;
  medications: Array<MemberContext['medications'][number] & { deleted_at: string | null }>;
  nutrition_goals: Array<{
    goal_type: string;
    is_primary: boolean;
    target_value: number | string | null;
    target_unit: string | null;
    deleted_at: string | null;
  }>;
  pregnancy_profiles: Array<{
    trimester: number | null;
    gestational_diabetes: boolean;
    deleted_at: string | null;
  }>;
  sensory_profiles: Array<{ id: string; deleted_at: string | null }>;
  food_preferences: Array<{ is_safe_food: boolean; deleted_at: string | null }>;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

function toMember(r: MemberRow): MemberContext {
  return {
    id: r.id,
    name: r.name,
    date_of_birth: r.date_of_birth,
    sex_at_birth: r.sex_at_birth,
    height_cm: num(r.height_cm),
    weight_kg: num(r.weight_kg),
    activity_level: r.activity_level,
    special_modules: r.special_modules ?? [],
    sleep_schedule: r.sleep_schedule ?? {},
    lifestyle: r.lifestyle ?? {},
    conditions: live(r.medical_conditions).map((c) => ({
      label: c.label,
      condition_code: c.condition_code,
      on_insulin_or_sulfonylurea: c.on_insulin_or_sulfonylurea,
    })),
    allergies: live(r.allergies).map((a) => ({
      kind: a.kind,
      severity: a.severity,
      allergen_code: a.allergens?.code ?? null,
    })),
    medications: live(r.medications).map((m) => ({
      name: m.name,
      food_interaction_flags: m.food_interaction_flags ?? [],
    })),
    goals: live(r.nutrition_goals).map((g) => ({
      goal_type: g.goal_type,
      is_primary: g.is_primary,
      target_value: num(g.target_value),
      target_unit: g.target_unit,
    })),
    pregnancy: live(r.pregnancy_profiles)[0] ?? null,
    has_sensory_profile: live(r.sensory_profiles).length > 0,
    safe_food_count: live(r.food_preferences).filter((p) => p.is_safe_food).length,
  };
}

/** Service-role implementation. Every write sets `household_id` explicitly (06 §2.2). */
export function supabaseIntakeStore(admin: SupabaseClient): IntakeStore {
  return {
    async household(householdId) {
      const row = check(
        await admin
          .from('households')
          .select('id, country_code, timezone, regions(climate_zone)')
          .eq('id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as {
        id: string;
        country_code: string;
        timezone: string;
        regions: { climate_zone: string } | null;
      } | null;
      if (!row) return null;
      return {
        id: row.id,
        country_code: row.country_code,
        timezone: row.timezone,
        climate_zone: row.regions?.climate_zone ?? null,
      };
    },
    async membership(householdId, userId) {
      const data = check(
        await admin
          .from('household_members')
          .select('role')
          .eq('household_id', householdId)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .maybeSingle(),
      );
      return (data?.role as HouseholdRole | undefined) ?? null;
    },
    async userProfile(userId) {
      return check(await admin.from('users').select('locale').eq('id', userId).maybeSingle());
    },
    async hasPremium(userId) {
      return check(await admin.rpc('has_premium', { p_user_id: userId })) === true;
    },
    async activeConsents(userId, householdId) {
      const rows = check(
        await admin
          .from('consents')
          .select('kind, household_id')
          .eq('user_id', userId)
          .is('withdrawn_at', null),
      ) as { kind: ConsentKind; household_id: string | null }[];
      return rows
        .filter((r) => r.household_id === null || r.household_id === householdId)
        .map((r) => r.kind);
    },
    async consumeRateLimit(key, limit, windowSeconds) {
      const rows = check(
        await admin.rpc('consume_rate_limit', {
          p_key: key,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        }),
      ) as { allowed: boolean; remaining: number; reset_at: string }[];
      const row = rows[0];
      if (!row) throw new Error('consume_rate_limit returned no row');
      return row;
    },
    async idempotencyBegin(scope, userId, key, requestHash) {
      const inserted = await admin
        .from('idempotency_keys')
        .insert({ scope, user_id: userId, key, request_hash: requestHash, status: 'in_progress' })
        .select('id')
        .maybeSingle();
      if (!inserted.error && inserted.data) return { state: 'new', id: inserted.data.id as string };
      if (inserted.error && inserted.error.code !== '23505')
        throw fromPostgrestError(inserted.error);

      const existing = check(
        await admin
          .from('idempotency_keys')
          .select('id, request_hash, status, response_code, response_body, updated_at, expires_at')
          .eq('scope', scope)
          .eq('user_id', userId)
          .eq('key', key)
          .maybeSingle(),
      ) as {
        id: string;
        request_hash: string;
        status: 'in_progress' | 'completed' | 'failed';
        response_code: number | null;
        response_body: unknown;
        updated_at: string;
        expires_at: string;
      } | null;
      if (!existing) return { state: 'in_progress' };
      const expired = new Date(existing.expires_at).getTime() < Date.now();
      if (!expired && existing.request_hash !== requestHash) return { state: 'mismatch' };
      if (!expired && existing.status === 'completed') {
        return {
          state: 'replay',
          status: existing.response_code ?? 200,
          body: existing.response_body,
        };
      }
      // Failed, expired, or in progress for more than 5 minutes (abandoned): take it over (06 §2.4).
      const abandoned = Date.now() - new Date(existing.updated_at).getTime() > 5 * 60_000;
      if (existing.status === 'in_progress' && !abandoned && !expired)
        return { state: 'in_progress' };
      const taken = check(
        await admin
          .from('idempotency_keys')
          .update({
            status: 'in_progress',
            request_hash: requestHash,
            response_code: null,
            response_body: null,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          })
          .eq('id', existing.id)
          .eq('updated_at', existing.updated_at)
          .select('id'),
      ) as { id: string }[];
      return taken.length ? { state: 'new', id: existing.id } : { state: 'in_progress' };
    },
    async idempotencyComplete(id, status, body) {
      check(
        await admin
          .from('idempotency_keys')
          .update({ status: 'completed', response_code: status, response_body: body })
          .eq('id', id),
      );
    },
    async idempotencyFail(id) {
      check(await admin.from('idempotency_keys').update({ status: 'failed' }).eq('id', id));
    },
    async members(householdId, ids) {
      let q = admin
        .from('family_members')
        .select(MEMBER_SELECT)
        .eq('household_id', householdId)
        .is('deleted_at', null)
        .order('sort_order');
      if (ids?.length) q = q.in('id', ids as string[]);
      return (check(await q) as unknown as MemberRow[]).map(toMember);
    },
    async verifiedRecommendations() {
      return check(
        await admin
          .from('recommendations')
          .select('id, code, applies_to, contraindications')
          .eq('review_status', 'verified')
          .order('code'),
      ) as RecommendationRow[];
    },
    async insertAssessments(rows) {
      check(await admin.from('ai_assessments').insert(rows));
    },
    async setHydrationTarget(a) {
      check(
        await admin.rpc('set_hydration_target', {
          p_household_id: a.householdId,
          p_family_member_id: a.familyMemberId,
          p_daily_ml: a.dailyMl,
          p_schedule: a.schedule,
          p_basis: a.basis,
        }),
      );
    },
    async insertSafetyEvents(rows) {
      if (rows.length) check(await admin.from('safety_events').insert(rows));
    },
    async audit(e) {
      check(
        await admin.from('audit_log').insert({
          actor_user_id: e.actor,
          household_id: e.householdId,
          action: e.action,
          entity: e.entity,
          entity_id: e.entityId,
          diff: e.diff,
        }),
      );
    },
  };
}
