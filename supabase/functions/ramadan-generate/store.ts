import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../_shared/platform.ts';
import type { MemberSafety } from './participation.ts';

/** Ramadan-specific data access (05 §12.5 `ramadan_plans`, 15 §5.1); plan rows use `PlanStore`. */

export interface RamadanPlanUpsert {
  household_id: string;
  hijri_year: number;
  start_date: string;
  end_date: string;
  meal_plan_id: string;
  suhoor_time_strategy: string;
  child_participation: Record<string, unknown>;
  pregnancy_adjustments: Record<string, unknown>;
  city_prayer_times_source: string;
  prayer_times: unknown[];
  calc_params: Record<string, unknown>;
}

export interface RamadanStore {
  /** `households.hijri_offset_days` (local moon sighting, -2..2). */
  hijriOffset(householdId: string): Promise<number>;
  /** `users.tradition_preference`. */
  tradition(userId: string): Promise<'shared' | 'sunni' | 'shia'>;
  /** Gestational diabetes and insulin or sulfonylurea flags per member (15 §5.6-5.7). */
  memberSafety(householdId: string): Promise<Map<string, Omit<MemberSafety, 'risk_flags'>>>;
  /**
   * Inserts the household's plan for the Hijri year, or updates the live one (unique
   * `ramadan_plans_one_per_year`). Returns its id.
   */
  upsertRamadanPlan(row: RamadanPlanUpsert): Promise<string>;
}

export function supabaseRamadanStore(admin: SupabaseClient): RamadanStore {
  return {
    async hijriOffset(householdId) {
      const row = check(
        await admin
          .from('households')
          .select('hijri_offset_days')
          .eq('id', householdId)
          .maybeSingle(),
      ) as { hijri_offset_days: number | null } | null;
      return Number(row?.hijri_offset_days ?? 0);
    },
    async tradition(userId) {
      const row = check(
        await admin.from('users').select('tradition_preference').eq('id', userId).maybeSingle(),
      ) as { tradition_preference: string } | null;
      const t = row?.tradition_preference;
      return t === 'sunni' || t === 'shia' ? t : 'shared';
    },
    async memberSafety(householdId) {
      const [conditions, pregnancies] = await Promise.all([
        admin
          .from('medical_conditions')
          .select('family_member_id, on_insulin_or_sulfonylurea')
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .eq('on_insulin_or_sulfonylurea', true),
        admin
          .from('pregnancy_profiles')
          .select('family_member_id, gestational_diabetes')
          .eq('household_id', householdId)
          .is('deleted_at', null),
      ]);
      const out = new Map<string, Omit<MemberSafety, 'risk_flags'>>();
      const get = (id: string) => {
        const v = out.get(id) ?? { gestational_diabetes: false, on_insulin_or_sulfonylurea: false };
        out.set(id, v);
        return v;
      };
      for (const c of check(conditions) as Array<{ family_member_id: string }>)
        get(c.family_member_id).on_insulin_or_sulfonylurea = true;
      for (const p of check(pregnancies) as Array<{
        family_member_id: string;
        gestational_diabetes: boolean;
      }>)
        get(p.family_member_id).gestational_diabetes = p.gestational_diabetes === true;
      return out;
    },
    async upsertRamadanPlan(row) {
      const existing = check(
        await admin
          .from('ramadan_plans')
          .select('id')
          .eq('household_id', row.household_id)
          .eq('hijri_year', row.hijri_year)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as { id: string } | null;
      if (existing) {
        check(await admin.from('ramadan_plans').update(row).eq('id', existing.id));
        return existing.id;
      }
      const inserted = check(
        await admin.from('ramadan_plans').insert(row).select('id').single(),
      ) as { id: string };
      return inserted.id;
    },
  };
}
