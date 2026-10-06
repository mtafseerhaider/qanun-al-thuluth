import type { SupabaseClient } from '@supabase/supabase-js';
import type { GrowthIndicatorKey, GrowthReferenceKey, LmsRow } from '@thuluth/ai-core';

import type { NotificationRow } from '../_shared/notifications/templates.ts';
import { check, supabasePlatformStore } from '../_shared/platform.ts';
import type { PlatformStore } from '../_shared/platform.ts';

/** Data access for `growth-compute` (06 §4.8, 15 §2), so the handler is testable without a database. */

export interface GrowthRow {
  id: string;
  household_id: string;
  family_member_id: string;
  measured_on: string;
  height_cm: number | null;
  weight_kg: number | null;
  head_circumference_cm: number | null;
  measurement_position: 'recumbent' | 'standing' | null;
  height_for_age_z: number | null;
  weight_for_age_z: number | null;
  bmi_for_age_z: number | null;
  head_circumference_for_age_z: number | null;
  height_for_age_percentile: number | null;
  weight_for_age_percentile: number | null;
  flags: string[];
  computed_at: string | null;
}

export interface GrowthMember {
  id: string;
  household_id: string;
  date_of_birth: string | null;
  sex_at_birth: 'female' | 'male' | 'unspecified';
}

/** Computed columns written with the service role (column grants keep them off clients). */
export interface GrowthComputed {
  age_months: number;
  reference: GrowthReferenceKey;
  height_for_age_z: number | null;
  weight_for_age_z: number | null;
  bmi_for_age_z: number | null;
  head_circumference_for_age_z: number | null;
  height_for_age_percentile: number | null;
  weight_for_age_percentile: number | null;
  bmi_for_age_percentile: number | null;
  head_circumference_for_age_percentile: number | null;
  flags: string[];
  computed_at: string;
}

export interface GrowthRawInput {
  household_id: string;
  family_member_id: string;
  measured_on: string;
  height_cm: number;
  weight_kg: number;
  head_circumference_cm: number | null;
  measurement_position: 'recumbent' | 'standing' | null;
  entered_by: string;
}

export interface AssessmentCarry {
  energy_targets: Record<string, unknown>;
  macro_targets: Record<string, unknown>;
  hydration_targets: Record<string, unknown>;
  risk_flags: string[];
}

export interface GrowthSafetyEvent {
  household_id: string;
  family_member_id: string;
  user_id: string;
  source: 'growth';
  category: string;
  urgency: 'soon' | 'same_day';
  evidence: string;
}

export interface GrowthStore extends Pick<
  PlatformStore,
  'membership' | 'featureEnabled' | 'consumeRateLimit' | 'audit'
> {
  row(id: string): Promise<GrowthRow | null>;
  rowByDate(memberId: string, measuredOn: string): Promise<GrowthRow | null>;
  member(memberId: string): Promise<GrowthMember | null>;
  /** `households.preferences.growth_reference = 'cdc_2000'` opts in to CDC 2000 (06 §4.8). */
  prefersCdc(householdId: string): Promise<boolean>;
  /** LMS rows of one reference and sex for the given indicators between two ages (months). */
  lms(
    reference: GrowthReferenceKey,
    sex: 'female' | 'male',
    indicators: readonly GrowthIndicatorKey[],
    fromMonths: number,
    toMonths: number,
  ): Promise<Map<GrowthIndicatorKey, LmsRow[]>>;
  /** All other measurements of the member, oldest first. */
  history(memberId: string, excludeId: string | null): Promise<GrowthRow[]>;
  /** Inserts a measurement (insert path) or replaces raw values of the same-day row, with computed columns. */
  saveMeasurement(
    existingId: string | null,
    raw: GrowthRawInput,
    computed: GrowthComputed,
  ): Promise<string>;
  /** Computed columns only (offline path). `computed_at` changes in the same update, so no reset. */
  saveComputed(id: string, computed: GrowthComputed): Promise<void>;
  latestAssessment(memberId: string): Promise<AssessmentCarry | null>;
  insertAssessment(row: {
    household_id: string;
    family_member_id: string;
    created_by_user_id: string;
    summary: string;
    carry: AssessmentCarry;
  }): Promise<void>;
  insertSafetyEvents(rows: GrowthSafetyEvent[]): Promise<void>;
  /** Owners and caregivers of the household with their locale (growth_alert recipients). */
  caregivers(householdId: string): Promise<Array<{ user_id: string; locale: string | null }>>;
  notify(rows: NotificationRow[]): Promise<void>;
  userLocale(userId: string): Promise<string | null>;
}

const COLS =
  'id, household_id, family_member_id, measured_on, height_cm, weight_kg, head_circumference_cm, measurement_position, height_for_age_z, weight_for_age_z, bmi_for_age_z, head_circumference_for_age_z, height_for_age_percentile, weight_for_age_percentile, flags, computed_at';

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toRow(r: Record<string, unknown>): GrowthRow {
  return {
    id: String(r.id),
    household_id: String(r.household_id),
    family_member_id: String(r.family_member_id),
    measured_on: String(r.measured_on),
    height_cm: num(r.height_cm),
    weight_kg: num(r.weight_kg),
    head_circumference_cm: num(r.head_circumference_cm),
    measurement_position: (r.measurement_position as GrowthRow['measurement_position']) ?? null,
    height_for_age_z: num(r.height_for_age_z),
    weight_for_age_z: num(r.weight_for_age_z),
    bmi_for_age_z: num(r.bmi_for_age_z),
    head_circumference_for_age_z: num(r.head_circumference_for_age_z),
    height_for_age_percentile: num(r.height_for_age_percentile),
    weight_for_age_percentile: num(r.weight_for_age_percentile),
    flags: (r.flags as string[] | null) ?? [],
    computed_at: (r.computed_at as string | null) ?? null,
  };
}

export function supabaseGrowthStore(admin: SupabaseClient): GrowthStore {
  const platform = supabasePlatformStore(admin);
  return {
    membership: platform.membership,
    featureEnabled: platform.featureEnabled,
    consumeRateLimit: platform.consumeRateLimit,
    audit: platform.audit,
    async row(id) {
      const r = check(await admin.from('growth_tracking').select(COLS).eq('id', id).maybeSingle());
      return r ? toRow(r as Record<string, unknown>) : null;
    },
    async rowByDate(memberId, measuredOn) {
      const r = check(
        await admin
          .from('growth_tracking')
          .select(COLS)
          .eq('family_member_id', memberId)
          .eq('measured_on', measuredOn)
          .maybeSingle(),
      );
      return r ? toRow(r as Record<string, unknown>) : null;
    },
    async member(memberId) {
      const r = check(
        await admin
          .from('family_members')
          .select('id, household_id, date_of_birth, sex_at_birth')
          .eq('id', memberId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as GrowthMember | null;
      return r;
    },
    async prefersCdc(householdId) {
      const r = check(
        await admin.from('households').select('preferences').eq('id', householdId).maybeSingle(),
      ) as { preferences: Record<string, unknown> | null } | null;
      return r?.preferences?.growth_reference === 'cdc_2000';
    },
    async lms(reference, sex, indicators, fromMonths, toMonths) {
      const rows = check(
        await admin
          .from('growth_reference_lms')
          .select('indicator, age_months, age_days, l, m, s')
          .eq('reference', reference)
          .eq('sex', sex)
          .in('indicator', indicators as string[])
          .gte('age_months', fromMonths)
          .lte('age_months', toMonths)
          .order('age_months')
          .limit(1000),
      ) as Array<Record<string, unknown>>;
      const out = new Map<GrowthIndicatorKey, LmsRow[]>();
      for (const r of rows) {
        const k = r.indicator as GrowthIndicatorKey;
        const list = out.get(k) ?? [];
        list.push({
          ageMonths: Number(r.age_months),
          ageDays: r.age_days == null ? null : Number(r.age_days),
          l: Number(r.l),
          m: Number(r.m),
          s: Number(r.s),
        });
        out.set(k, list);
      }
      return out;
    },
    async history(memberId, excludeId) {
      let q = admin
        .from('growth_tracking')
        .select(COLS)
        .eq('family_member_id', memberId)
        .order('measured_on')
        .limit(500);
      if (excludeId) q = q.neq('id', excludeId);
      return (check(await q) as Array<Record<string, unknown>>).map(toRow);
    },
    async saveMeasurement(existingId, raw, computed) {
      const { entered_by, ...values } = raw;
      if (existingId) {
        check(
          await admin
            .from('growth_tracking')
            .update({ ...values, ...computed })
            .eq('id', existingId),
        );
        return existingId;
      }
      const r = check(
        await admin
          .from('growth_tracking')
          .insert({ ...values, entered_by, ...computed })
          .select('id')
          .single(),
      ) as { id: string };
      return r.id;
    },
    async saveComputed(id, computed) {
      check(await admin.from('growth_tracking').update(computed).eq('id', id));
    },
    async latestAssessment(memberId) {
      const r = check(
        await admin
          .from('ai_assessments')
          .select('energy_targets, macro_targets, hydration_targets, risk_flags')
          .eq('family_member_id', memberId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as AssessmentCarry | null;
      return r;
    },
    async insertAssessment(row) {
      check(
        await admin.from('ai_assessments').insert({
          household_id: row.household_id,
          family_member_id: row.family_member_id,
          kind: 'periodic',
          summary: row.summary,
          energy_targets: row.carry.energy_targets,
          macro_targets: row.carry.macro_targets,
          hydration_targets: row.carry.hydration_targets,
          risk_flags: row.carry.risk_flags,
          model_route: 'growth.compute',
          model: null,
          prompt_version: 'growth_compute@1',
          created_by_user_id: row.created_by_user_id,
        }),
      );
    },
    async insertSafetyEvents(rows) {
      if (rows.length) check(await admin.from('safety_events').insert(rows));
    },
    async caregivers(householdId) {
      const members = check(
        await admin
          .from('household_members')
          .select('user_id')
          .eq('household_id', householdId)
          .in('role', ['owner', 'caregiver'])
          .is('deleted_at', null),
      ) as Array<{ user_id: string }>;
      if (!members.length) return [];
      const users = check(
        await admin
          .from('users')
          .select('id, locale')
          .in(
            'id',
            members.map((m) => m.user_id),
          ),
      ) as Array<{ id: string; locale: string | null }>;
      const locale = new Map(users.map((u) => [u.id, u.locale]));
      return members.map((m) => ({ user_id: m.user_id, locale: locale.get(m.user_id) ?? null }));
    },
    async notify(rows) {
      for (const row of rows) {
        const { error } = await admin.from('notifications').insert(row);
        if (error && error.code !== '23505') throw error;
      }
    },
    async userLocale(userId) {
      const r = check(
        await admin.from('users').select('locale').eq('id', userId).maybeSingle(),
      ) as { locale: string | null } | null;
      return r?.locale ?? null;
    },
  };
}
