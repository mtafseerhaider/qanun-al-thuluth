import type { SupabaseClient } from '@supabase/supabase-js';
import type { HouseholdRole } from '@thuluth/shared';

import { fromPostgrestError } from './errors.ts';
import type { PgErrorLike } from './errors.ts';

/**
 * The common pipeline pieces every user-facing function needs (04 §5.2): membership, entitlement,
 * kill switches, rate limits and idempotency. Same behaviour as the plan store (S3), extracted so
 * the Sprint 4 functions do not copy it again.
 */

export type IdempotencyBegin =
  | { state: 'new'; id: string }
  | { state: 'replay'; status: number; body: unknown }
  | { state: 'in_progress' }
  | { state: 'mismatch' };

export interface PlatformStore {
  membership(householdId: string, userId: string): Promise<HouseholdRole | null>;
  /** Household features follow the owner's entitlement (00 §11). */
  householdPremium(householdId: string): Promise<boolean>;
  /** Kill switches; a missing flag counts as on. */
  featureEnabled(key: string): Promise<boolean>;
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
  audit(entry: {
    actor: string | null;
    householdId: string;
    action: string;
    entity: string;
    entityId: string | null;
    diff: Record<string, unknown>;
  }): Promise<void>;
}

export function check<T>(result: { data: T; error: PgErrorLike | null }): T {
  if (result.error) throw fromPostgrestError(result.error);
  return result.data;
}

const PAGE = 1000;

/** Reads every row of a query in pages (PostgREST caps responses at `max_rows`). */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PgErrorLike | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await page(from, from + PAGE - 1)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Service-role implementation (RLS bypassed; callers check membership first). */
export function supabasePlatformStore(admin: SupabaseClient): PlatformStore {
  return {
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
    async householdPremium(householdId) {
      return (
        check(await admin.rpc('household_has_premium', { p_household_id: householdId })) === true
      );
    },
    async featureEnabled(key) {
      const row = check(
        await admin.from('feature_flags').select('enabled').eq('key', key).maybeSingle(),
      );
      return row ? row.enabled === true : true;
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
