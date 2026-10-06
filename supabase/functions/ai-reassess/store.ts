import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseIntakeStore } from '../ai-intake-assess/store.ts';
import type {
  HouseholdContext,
  MemberContext,
  RecommendationRow,
} from '../ai-intake-assess/store.ts';
import { check } from '../_shared/platform.ts';

/**
 * Data access for `ai-reassess` (S6-15, FR-AI-11). Service role, cron only. Member and household
 * reads reuse the `ai-intake-assess` store so both functions compute from the same inputs.
 */

/** The latest intake or periodic assessment of one member. */
export interface LatestAssessment {
  id: string;
  household_id: string;
  family_member_id: string;
  kind: 'intake' | 'periodic';
  created_at: string;
  energy_targets: Record<string, unknown>;
  macro_targets: Record<string, unknown>;
  hydration_targets: Record<string, unknown>;
  risk_flags: string[];
  input_snapshot: Record<string, unknown>;
}

export interface PeriodicAssessmentInsert {
  id: string;
  household_id: string;
  family_member_id: string;
  kind: 'periodic';
  summary: string;
  energy_targets: Record<string, unknown>;
  macro_targets: Record<string, unknown>;
  hydration_targets: Record<string, unknown>;
  risk_flags: string[];
  input_snapshot: Record<string, unknown>;
  model_route: string;
  model: null;
  prompt_version: string;
  created_by_user_id: null;
}

export interface ReassessSafetyEventInsert {
  household_id: string;
  family_member_id: string;
  user_id: null;
  source: 'intake';
  category: string;
  urgency: 'emergency_now' | 'same_day' | 'soon' | 'routine';
  evidence: string;
}

export interface ReassessStore {
  /** `acquire_job_lease`; null when the RPC is not deployed (the run proceeds unlocked). */
  acquireLease(name: string, holder: string, ttlSeconds: number): Promise<boolean | null>;
  releaseLease(name: string, holder: string): Promise<void>;
  /**
   * `due_reassessments`: the latest intake/periodic assessment of each live member whose latest one was
   * created at or before `before`, oldest first, at most `limit`; optionally only `householdIds`.
   */
  dueAssessments(args: {
    before: Date;
    limit: number;
    householdIds?: readonly string[] | undefined;
  }): Promise<LatestAssessment[]>;
  household(householdId: string): Promise<HouseholdContext | null>;
  /** The household owner's app locale ('en' | 'ur'), for the stored summary. */
  ownerLocale(householdId: string): Promise<string | null>;
  members(householdId: string, ids: readonly string[]): Promise<MemberContext[]>;
  verifiedRecommendations(): Promise<RecommendationRow[]>;
  insertAssessments(rows: PeriodicAssessmentInsert[]): Promise<void>;
  setHydrationTarget(args: {
    householdId: string;
    familyMemberId: string;
    dailyMl: number;
    schedule: unknown[];
    basis: Record<string, unknown>;
  }): Promise<void>;
  insertSafetyEvents(rows: ReassessSafetyEventInsert[]): Promise<void>;
  audit(entry: {
    householdId: string;
    entityId: string | null;
    diff: Record<string, unknown>;
  }): Promise<void>;
}

const MISSING_FUNCTION = 'PGRST202';

export function supabaseReassessStore(admin: SupabaseClient): ReassessStore {
  const intake = supabaseIntakeStore(admin);
  return {
    async acquireLease(name, holder, ttl) {
      const { data, error } = await admin.rpc('acquire_job_lease', {
        p_name: name,
        p_holder: holder,
        p_ttl_seconds: ttl,
      });
      if (error?.code === MISSING_FUNCTION) return null;
      if (error) throw error;
      return data === true;
    },
    async releaseLease(name, holder) {
      const { error } = await admin.rpc('release_job_lease', { p_name: name, p_holder: holder });
      if (error && error.code !== MISSING_FUNCTION) throw error;
    },
    async dueAssessments({ before, limit, householdIds }) {
      const { data, error } = await admin.rpc('due_reassessments', {
        p_before: before.toISOString(),
        p_limit: limit,
        p_household_ids: householdIds?.length ? [...householdIds] : null,
      });
      if (error) throw error;
      return ((data ?? []) as LatestAssessment[]).map((r) => ({
        ...r,
        risk_flags: r.risk_flags ?? [],
      }));
    },
    household: (id) => intake.household(id),
    async ownerLocale(householdId) {
      const row = check(
        await admin
          .from('households')
          .select('users!households_owner_user_id_fkey(locale)')
          .eq('id', householdId)
          .maybeSingle(),
      ) as unknown as { users: { locale: string | null } | null } | null;
      return row?.users?.locale ?? null;
    },
    members: (householdId, ids) => intake.members(householdId, ids),
    verifiedRecommendations: () => intake.verifiedRecommendations(),
    async insertAssessments(rows) {
      if (rows.length) check(await admin.from('ai_assessments').insert(rows));
    },
    setHydrationTarget: (a) => intake.setHydrationTarget(a),
    async insertSafetyEvents(rows) {
      if (rows.length) check(await admin.from('safety_events').insert(rows));
    },
    async audit(e) {
      check(
        await admin.from('audit_log').insert({
          actor_user_id: null,
          household_id: e.householdId,
          action: 'insert',
          entity: 'ai_assessments',
          entity_id: e.entityId,
          diff: e.diff,
        }),
      );
    },
  };
}
