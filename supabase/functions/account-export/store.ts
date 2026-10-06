import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from '../_shared/env.ts';
import type { NotificationRow } from '../_shared/notifications/templates.ts';
import { check, supabasePlatformStore } from '../_shared/platform.ts';
import type { PlatformStore } from '../_shared/platform.ts';

/** Data access for `account-export` (06 §4.12, 16 §7.4). */

/** Household tables in the bundle, read with the caller's JWT so RLS decides what is theirs to take. */
export const HOUSEHOLD_TABLES = [
  'households',
  'household_members',
  'family_members',
  'food_preferences',
  'allergies',
  'medical_conditions',
  'medications',
  'pregnancy_profiles',
  'sensory_profiles',
  'nutrition_goals',
  'ai_assessments',
  'meal_plans',
  'daily_meals',
  'daily_meal_servings',
  'grocery_lists',
  'shopping_items',
  'budget_profiles',
  'budget_entries',
  'pantry_items',
  'hydration_targets',
  'hydration_logs',
  'fasting_logs',
  'ramadan_plans',
  'growth_tracking',
  'weight_tracking',
  'nutrition_journal',
  'meal_logs',
  'food_exposures',
  'exposure_ladders',
  'exposure_ladder_steps',
  'safety_events',
  'exports',
] as const;

/** Columns never exported: ciphertext, vectors and internal hashes. */
export const isRedactedColumn = (c: string) =>
  c.endsWith('_enc') ||
  c.endsWith('_key_version') ||
  c === 'embedding' ||
  c === 'token_hash' ||
  c === 'ip_hash';

export interface AccountExportStore extends Pick<
  PlatformStore,
  'consumeRateLimit' | 'idempotencyBegin' | 'idempotencyComplete' | 'idempotencyFail'
> {
  /** Live memberships of the user. */
  memberships(userId: string): Promise<string[]>;
  insertExport(row: { user_id: string; params: Record<string, unknown> }): Promise<string>;
  updateExport(
    id: string,
    patch: {
      status?: string;
      storage_path?: string;
      expires_at?: string;
      error?: string;
      params?: Record<string, unknown>;
    },
  ): Promise<void>;
  /** `account_export_user_data(user)`: the user's own non-household rows. */
  userData(userId: string): Promise<Record<string, unknown>>;
  /** Rows of one household table visible to the caller under RLS (null when the table is absent). */
  householdRows(
    jwt: string,
    table: string,
    householdId: string,
  ): Promise<Record<string, unknown>[] | null>;
  notify(row: NotificationRow): Promise<void>;
  userLocale(userId: string): Promise<string | null>;
  /** Address, locale and zone for the "data ready" email; null when the user has no email. */
  contact(
    userId: string,
  ): Promise<{ email: string; locale: string | null; timezone: string | null } | null>;
  audit(userId: string, exportId: string, diff: Record<string, unknown>): Promise<void>;
}

const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST200']);

export function supabaseAccountExportStore(admin: SupabaseClient): AccountExportStore {
  const platform = supabasePlatformStore(admin);
  const asUser = (jwt: string) =>
    createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { authorization: `Bearer ${jwt}` } },
    });
  return {
    consumeRateLimit: platform.consumeRateLimit,
    idempotencyBegin: platform.idempotencyBegin,
    idempotencyComplete: platform.idempotencyComplete,
    idempotencyFail: platform.idempotencyFail,
    async memberships(userId) {
      const rows = check(
        await admin
          .from('household_members')
          .select('household_id')
          .eq('user_id', userId)
          .is('deleted_at', null),
      ) as Array<{ household_id: string }>;
      return rows.map((r) => r.household_id);
    },
    async insertExport(row) {
      const r = check(
        await admin
          .from('exports')
          .insert({
            household_id: null,
            user_id: row.user_id,
            kind: 'account_data',
            status: 'processing',
            params: row.params,
          })
          .select('id')
          .single(),
      ) as { id: string };
      return r.id;
    },
    async updateExport(id, patch) {
      check(await admin.from('exports').update(patch).eq('id', id));
    },
    async userData(userId) {
      return check(await admin.rpc('account_export_user_data', { p_user_id: userId })) as Record<
        string,
        unknown
      >;
    },
    async householdRows(jwt, table, householdId) {
      const client = asUser(jwt);
      const out: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const q = client
          .from(table)
          .select('*')
          .eq(table === 'households' ? 'id' : 'household_id', householdId)
          .range(from, from + 999);
        const { data, error } = await q;
        if (error) {
          if (MISSING_TABLE.has(error.code ?? '')) return null;
          throw error;
        }
        out.push(...((data ?? []) as Record<string, unknown>[]));
        if ((data?.length ?? 0) < 1000) return out;
      }
    },
    async notify(row) {
      const { error } = await admin.from('notifications').insert(row);
      if (error && error.code !== '23505') throw error;
    },
    async userLocale(userId) {
      const r = check(
        await admin.from('users').select('locale').eq('id', userId).maybeSingle(),
      ) as {
        locale: string | null;
      } | null;
      return r?.locale ?? null;
    },
    async contact(userId) {
      const r = check(
        await admin.from('users').select('email, locale, timezone').eq('id', userId).maybeSingle(),
      ) as { email: string | null; locale: string | null; timezone: string | null } | null;
      return r?.email ? { email: r.email, locale: r.locale, timezone: r.timezone } : null;
    },
    async audit(userId, exportId, diff) {
      check(
        await admin.from('audit_log').insert({
          actor_user_id: userId,
          household_id: null,
          action: 'export',
          entity: 'exports',
          entity_id: exportId,
          diff,
        }),
      );
    },
  };
}
