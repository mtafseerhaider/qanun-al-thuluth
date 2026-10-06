import type { SupabaseClient } from '@supabase/supabase-js';

import { check, selectAll, supabasePlatformStore } from '../_shared/platform.ts';
import type { PlatformStore } from '../_shared/platform.ts';

/** Data access for `account-delete` (06 §4.13, 16 §7.5); the RPCs live in the S6 account-rights migration. */

export interface ErasureResult {
  deleted_household_ids: string[];
  left_household_ids: string[];
  storage_prefixes: Array<{ bucket: string; prefix: string }>;
}

export interface AccountDeleteStore extends Pick<
  PlatformStore,
  'consumeRateLimit' | 'idempotencyBegin' | 'idempotencyComplete' | 'idempotencyFail'
> {
  /** `request_account_deletion`: returns `scheduled_for`. */
  requestDeletion(userId: string, reason: string | null, immediate: boolean): Promise<string>;
  /** `cancel_account_deletion`. */
  cancelDeletion(userId: string): Promise<void>;
  /** An auto-renewing App Store or Play subscription the user must cancel in the store (17). */
  activeStoreSubscription(userId: string): Promise<boolean>;
  /** Users whose `deletion_scheduled_for` has passed, oldest first. */
  dueUsers(now: string, limit: number): Promise<string[]>;
  /** `execute_account_erasure`. */
  erase(userId: string): Promise<ErasureResult>;
  /** `auth.admin.deleteUser` (cascades public.users and user-keyed rows). */
  deleteAuthUser(userId: string): Promise<void>;
  acquireLease(name: string, holder: string, ttlSeconds: number): Promise<boolean | null>;
  releaseLease(name: string, holder: string): Promise<void>;
  /** Orphan sweep: which of these ids still exist. */
  existing(
    table: 'households' | 'chat_sessions' | 'family_members',
    ids: string[],
  ): Promise<Set<string>>;
  /** `meal_logs.photo_path` values of these households. */
  referencedMealPhotos(householdIds: string[]): Promise<Set<string>>;
}

const MISSING_FUNCTION = 'PGRST202';

export function supabaseAccountDeleteStore(admin: SupabaseClient): AccountDeleteStore {
  const platform = supabasePlatformStore(admin);
  return {
    consumeRateLimit: platform.consumeRateLimit,
    idempotencyBegin: platform.idempotencyBegin,
    idempotencyComplete: platform.idempotencyComplete,
    idempotencyFail: platform.idempotencyFail,
    async requestDeletion(userId, reason, immediate) {
      return check(
        await admin.rpc('request_account_deletion', {
          p_user_id: userId,
          p_reason: reason,
          p_immediate: immediate,
        }),
      ) as string;
    },
    async cancelDeletion(userId) {
      check(await admin.rpc('cancel_account_deletion', { p_user_id: userId }));
    },
    async activeStoreSubscription(userId) {
      const rows = check(
        await admin
          .from('subscriptions')
          .select('id')
          .eq('user_id', userId)
          .in('store', ['app_store', 'play_store'])
          .in('status', ['active', 'in_grace', 'in_billing_retry'])
          .limit(1),
      ) as unknown[];
      return rows.length > 0;
    },
    async dueUsers(now, limit) {
      const rows = check(
        await admin
          .from('users')
          .select('id')
          .lte('deletion_scheduled_for', now)
          .order('deletion_scheduled_for')
          .limit(limit),
      ) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },
    async erase(userId) {
      return check(
        await admin.rpc('execute_account_erasure', { p_user_id: userId }),
      ) as ErasureResult;
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error && !/not found/i.test(error.message)) throw error;
    },
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
    async existing(table, ids) {
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const rows = check(
          await admin
            .from(table)
            .select('id')
            .in('id', ids.slice(i, i + 200)),
        ) as Array<{ id: string }>;
        for (const r of rows) out.add(r.id);
      }
      return out;
    },
    async referencedMealPhotos(householdIds) {
      if (!householdIds.length) return new Set();
      const rows = await selectAll<{ photo_path: string | null }>((a, b) =>
        admin
          .from('meal_logs')
          .select('photo_path')
          .in('household_id', householdIds)
          .not('photo_path', 'is', null)
          .order('id')
          .range(a, b),
      );
      return new Set(rows.map((r) => r.photo_path!).filter(Boolean));
    },
  };
}
