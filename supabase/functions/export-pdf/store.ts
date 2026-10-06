import type { SupabaseClient } from '@supabase/supabase-js';

import { check, selectAll, supabasePlatformStore } from '../_shared/platform.ts';
import type { PlatformStore } from '../_shared/platform.ts';
import type { NotificationRow } from '../_shared/notifications/templates.ts';
import type { GroceryView, GrowthReportView, MealPlanView } from './templates.ts';

/** Data access for `export-pdf` (06 §4.10, 18 Part A); a fake implements it in tests. */

export const EXPORTS_BUCKET = 'exports';

export interface ExportRow {
  id: string;
  household_id: string | null;
  user_id: string;
  kind: string;
  status: 'processing' | 'ready' | 'failed' | 'expired';
  storage_path: string | null;
  expires_at: string;
  created_at: string;
  params: Record<string, unknown> | null;
}

export type MealPlanData = Omit<
  MealPlanView,
  'includeRecipes' | 'includeSources' | 'householdName'
>;
export type GroceryData = Omit<GroceryView, 'groupBy' | 'householdName'>;
export type GrowthData = Omit<GrowthReportView, 'includeNotesForClinician' | 'householdName'>;

/** Objects in the private `exports` bucket (service role; storage RLS lets members read). */
export interface ExportStorage {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Absolute signed URL valid for `ttlSeconds`. */
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
  remove(paths: string[]): Promise<void>;
}

export interface ExportStore extends Pick<
  PlatformStore,
  | 'membership'
  | 'featureEnabled'
  | 'consumeRateLimit'
  | 'idempotencyBegin'
  | 'idempotencyComplete'
  | 'idempotencyFail'
  | 'audit'
> {
  householdName(householdId: string): Promise<string | null>;
  /** Plan dates limited to `weekIndex` (0-based) when given. Null when missing or another household's. */
  mealPlan(
    householdId: string,
    planId: string,
    weekIndex: number | undefined,
    locale: string,
  ): Promise<MealPlanData | null>;
  groceryList(householdId: string, listId: string): Promise<GroceryData | null>;
  growth(householdId: string, memberId: string): Promise<GrowthData | null>;
  insertExport(row: {
    household_id: string | null;
    user_id: string;
    kind: string;
    params: Record<string, unknown>;
  }): Promise<string>;
  updateExport(
    id: string,
    patch: Partial<Pick<ExportRow, 'status' | 'storage_path' | 'expires_at'>> & {
      error?: string | null;
      params?: Record<string, unknown>;
    },
  ): Promise<void>;
  exportRow(id: string): Promise<ExportRow | null>;
  /** Ready rows past `expires_at`, oldest first. */
  expiredExports(now: string, limit: number): Promise<ExportRow[]>;
  /** `processing` rows older than `before` (a crashed render): marked failed. */
  failStale(before: string): Promise<number>;
  analytics(userId: string, event: string, props: Record<string, unknown>): Promise<void>;
  notify(rows: NotificationRow[]): Promise<void>;
}

export function supabaseExportStorage(admin: SupabaseClient): ExportStorage {
  const bucket = () => admin.storage.from(EXPORTS_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
    async signedUrl(path, ttl) {
      const { data, error } = await bucket().createSignedUrl(path, ttl);
      if (error || !data?.signedUrl) throw error ?? new Error('no signed url');
      return data.signedUrl;
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await bucket().remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
    },
  };
}

const i18nTitle = (title: string, i18n: unknown, locale: string) => {
  const v = i18n && typeof i18n === 'object' ? (i18n as Record<string, unknown>)[locale] : null;
  return typeof v === 'string' && v.trim() ? v : title;
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function supabaseExportStore(admin: SupabaseClient): ExportStore {
  const platform = supabasePlatformStore(admin);
  return {
    membership: platform.membership,
    featureEnabled: platform.featureEnabled,
    consumeRateLimit: platform.consumeRateLimit,
    idempotencyBegin: platform.idempotencyBegin,
    idempotencyComplete: platform.idempotencyComplete,
    idempotencyFail: platform.idempotencyFail,
    audit: platform.audit,
    async householdName(householdId) {
      const r = check(
        await admin
          .from('households')
          .select('name')
          .eq('id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as { name: string } | null;
      return r?.name ?? null;
    },
    async mealPlan(householdId, planId, weekIndex, locale) {
      const plan = check(
        await admin
          .from('meal_plans')
          .select('id, title, start_date, end_date')
          .eq('id', planId)
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as { id: string; title: string | null; start_date: string; end_date: string } | null;
      if (!plan) return null;
      let start = plan.start_date;
      let end = plan.end_date;
      if (weekIndex !== undefined) {
        start = addDays(plan.start_date, weekIndex * 7);
        const weekEnd = addDays(start, 6);
        end = weekEnd < plan.end_date ? weekEnd : plan.end_date;
        if (start > plan.end_date)
          return { title: plan.title, startDate: start, endDate: start, members: [], meals: [] };
      }
      const [members, meals] = await Promise.all([
        admin
          .from('family_members')
          .select('id, name, sort_order')
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .order('sort_order'),
        selectAll<Record<string, unknown>>((a, b) =>
          admin
            .from('daily_meals')
            .select(
              'id, plan_date, meal_type, slot, scheduled_time, notes, meals(title, title_i18n), daily_meal_servings(family_member_id, adaptation)',
            )
            .eq('meal_plan_id', planId)
            .eq('household_id', householdId)
            .gte('plan_date', start)
            .lte('plan_date', end)
            .order('plan_date')
            .order('slot')
            .range(a, b),
        ),
      ]);
      return {
        title: plan.title,
        startDate: start,
        endDate: end,
        members: (check(members) as Array<{ id: string; name: string }>).map((m) => ({
          id: m.id,
          name: m.name,
        })),
        meals: meals.map((m) => {
          const meal = (m.meals ?? {}) as { title?: string; title_i18n?: unknown };
          return {
            plan_date: String(m.plan_date),
            meal_type: String(m.meal_type),
            slot: Number(m.slot ?? 0),
            scheduled_time: (m.scheduled_time as string | null) ?? null,
            title: i18nTitle(meal.title ?? '', meal.title_i18n, locale),
            notes: (m.notes as string | null) ?? null,
            servings: (
              (m.daily_meal_servings ?? []) as Array<{
                family_member_id: string;
                adaptation: string;
              }>
            ).map((s) => ({ family_member_id: s.family_member_id, adaptation: s.adaptation })),
          };
        }),
      };
    },
    async groceryList(householdId, listId) {
      const list = check(
        await admin
          .from('grocery_lists')
          .select('id, starts_on, ends_on, currency, estimated_total_minor')
          .eq('id', listId)
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as {
        starts_on: string;
        ends_on: string;
        currency: string;
        estimated_total_minor: number;
      } | null;
      if (!list) return null;
      const items = await selectAll<Record<string, unknown>>((a, b) =>
        admin
          .from('shopping_items')
          .select(
            'label, quantity, unit, aisle, estimated_minor, is_fresh, sort_order, ingredients(category)',
          )
          .eq('grocery_list_id', listId)
          .eq('household_id', householdId)
          .is('substitution_for_item_id', null)
          .order('sort_order')
          .range(a, b),
      );
      return {
        startsOn: list.starts_on,
        endsOn: list.ends_on,
        currency: list.currency,
        estimatedTotalMinor: Number(list.estimated_total_minor),
        items: items.map((i) => ({
          label: String(i.label),
          quantity: Number(i.quantity),
          unit: String(i.unit),
          aisle: (i.aisle as string | null) ?? null,
          category:
            ((i.ingredients as { category?: string } | null)?.category as string | undefined) ??
            null,
          estimated_minor: i.estimated_minor == null ? null : Number(i.estimated_minor),
          is_fresh: i.is_fresh === true,
          sort_order: Number(i.sort_order ?? 0),
        })),
      };
    },
    async growth(householdId, memberId) {
      const member = check(
        await admin
          .from('family_members')
          .select('name, date_of_birth')
          .eq('id', memberId)
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as { name: string; date_of_birth: string | null } | null;
      if (!member?.date_of_birth) return null;
      const rows = check(
        await admin
          .from('growth_tracking')
          .select(
            'measured_on, age_months, height_cm, weight_kg, bmi, height_for_age_z, weight_for_age_z, bmi_for_age_z, height_for_age_percentile, weight_for_age_percentile, bmi_for_age_percentile, flags, reference, computed_at',
          )
          .eq('family_member_id', memberId)
          .eq('household_id', householdId)
          .order('measured_on')
          .limit(500),
      ) as Array<Record<string, unknown>>;
      const n = (v: unknown) => (v == null ? null : Number(v));
      return {
        memberName: member.name,
        dateOfBirth: member.date_of_birth,
        reference: (rows.at(-1)?.reference as string | undefined) ?? null,
        rows: rows.map((r) => ({
          measured_on: String(r.measured_on),
          age_months: n(r.age_months),
          height_cm: n(r.height_cm),
          weight_kg: n(r.weight_kg),
          bmi: n(r.bmi),
          height_for_age_z: n(r.height_for_age_z),
          weight_for_age_z: n(r.weight_for_age_z),
          bmi_for_age_z: n(r.bmi_for_age_z),
          height_for_age_percentile: n(r.height_for_age_percentile),
          weight_for_age_percentile: n(r.weight_for_age_percentile),
          bmi_for_age_percentile: n(r.bmi_for_age_percentile),
          flags: (r.flags as string[] | null) ?? [],
        })),
      };
    },
    async insertExport(row) {
      const r = check(
        await admin
          .from('exports')
          .insert({ ...row, status: 'processing' })
          .select('id')
          .single(),
      ) as { id: string };
      return r.id;
    },
    async updateExport(id, patch) {
      check(await admin.from('exports').update(patch).eq('id', id));
    },
    async exportRow(id) {
      return check(
        await admin
          .from('exports')
          .select(
            'id, household_id, user_id, kind, status, storage_path, expires_at, created_at, params',
          )
          .eq('id', id)
          .maybeSingle(),
      ) as ExportRow | null;
    },
    async expiredExports(now, limit) {
      return check(
        await admin
          .from('exports')
          .select(
            'id, household_id, user_id, kind, status, storage_path, expires_at, created_at, params',
          )
          .eq('status', 'ready')
          .lt('expires_at', now)
          .order('expires_at')
          .limit(limit),
      ) as ExportRow[];
    },
    async failStale(before) {
      const rows = check(
        await admin
          .from('exports')
          .update({ status: 'failed', error: 'render_abandoned' })
          .eq('status', 'processing')
          .lt('created_at', before)
          .select('id'),
      ) as Array<{ id: string }>;
      return rows.length;
    },
    async notify(rows) {
      for (const row of rows) {
        const { error } = await admin.from('notifications').insert(row);
        if (error && error.code !== '23505') throw error;
      }
    },
    async analytics(userId, event, props) {
      const { error } = await admin.from('analytics_events').insert({
        user_id: userId,
        event,
        props,
        occurred_at: new Date().toISOString(),
        platform: 'server',
      });
      if (error)
        console.warn(
          JSON.stringify({ level: 'warn', scope: 'export-pdf', msg: 'analytics_failed' }),
        );
    },
  };
}
