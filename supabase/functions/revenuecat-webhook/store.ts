import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../_shared/platform.ts';
import type { NotificationRow } from '../_shared/notifications/templates.ts';
import type { RcSubscriber, SubscriptionRow } from './derive.ts';

/** Data access for `revenuecat-webhook` (06 §4.14, §5; 17 §7), so it is testable without a database. */

export type RecordOutcome = 'new' | 'processed' | 'in_progress' | 'retry';

export interface RevenueCatEventInsert {
  event_id: string;
  type: string;
  app_user_id: string;
  event_timestamp: string;
  environment: 'PRODUCTION' | 'SANDBOX';
  payload: Record<string, unknown>;
}

export interface RevenueCatStore {
  /**
   * Inserts the `revenuecat_events` row (idempotency, 17 §7.2). A duplicate id returns
   * `processed` (replay: acknowledge), `in_progress` (another delivery is handling it right now)
   * or `retry` (an earlier attempt failed or was abandoned: process again).
   */
  recordEvent(row: RevenueCatEventInsert): Promise<RecordOutcome>;
  markProcessed(eventId: string, note: string | null): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
  /** Live `users` rows among the ids. */
  knownUsers(userIds: readonly string[]): Promise<string[]>;
  subscriptions(userId: string): Promise<Array<SubscriptionRow & { id: string }>>;
  /** Upsert on (user_id, store, entitlement); returns the row id. */
  upsertSubscription(row: SubscriptionRow): Promise<string>;
  userLocale(userId: string): Promise<string | null>;
  notify(row: NotificationRow): Promise<void>;
  analytics(e: {
    user_id: string;
    event: string;
    props: Record<string, string | boolean>;
    occurred_at: string;
  }): Promise<void>;
  audit(e: {
    actor: string | null;
    entityId: string | null;
    diff: Record<string, unknown>;
  }): Promise<void>;
  /** `has_premium(p_user_id)`. */
  userPremium(userId: string): Promise<boolean>;
  consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; reset_at: string }>;
}

/** RevenueCat REST (06 §7): the subscriber refetch. */
export interface SubscriberSource {
  /** False when `REVENUECAT_SECRET_API_KEY` is not configured: events are mapped on their own. */
  readonly configured: boolean;
  /** Throws on transport failure (the webhook answers 503 so RevenueCat retries). */
  get(appUserId: string): Promise<RcSubscriber>;
}

const UNIQUE = '23505';
/** An unprocessed duplicate younger than this is still being handled by another delivery. */
const IN_PROGRESS_MS = 2 * 60_000;

export function supabaseRevenueCatStore(admin: SupabaseClient): RevenueCatStore {
  return {
    async recordEvent(row) {
      const { error } = await admin.from('revenuecat_events').insert(row);
      if (!error) return 'new';
      if (error.code !== UNIQUE) throw error;
      const existing = check(
        await admin
          .from('revenuecat_events')
          .select('processed_at, error, updated_at')
          .eq('event_id', row.event_id)
          .maybeSingle(),
      ) as { processed_at: string | null; error: string | null; updated_at: string } | null;
      if (!existing) return 'retry';
      if (existing.processed_at) return 'processed';
      const young = Date.now() - Date.parse(existing.updated_at) < IN_PROGRESS_MS;
      if (young && !existing.error) return 'in_progress';
      // Claim the retry (updated_at moves, so a parallel retry sees it as in progress).
      check(
        await admin
          .from('revenuecat_events')
          .update({ error: null, payload: row.payload })
          .eq('event_id', row.event_id),
      );
      return 'retry';
    },
    async markProcessed(eventId, note) {
      check(
        await admin
          .from('revenuecat_events')
          .update({ processed_at: new Date().toISOString(), error: note })
          .eq('event_id', eventId),
      );
    },
    async markFailed(eventId, error) {
      check(
        await admin
          .from('revenuecat_events')
          .update({ error: error.slice(0, 500) })
          .eq('event_id', eventId),
      );
    },
    async knownUsers(userIds) {
      if (!userIds.length) return [];
      const rows = check(
        await admin
          .from('users')
          .select('id')
          .in('id', userIds as string[]),
      ) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },
    async subscriptions(userId) {
      return check(
        await admin
          .from('subscriptions')
          .select(
            'id, user_id, tier, status, product_id, store, entitlement, rc_app_user_id, current_period_end, will_renew, period_type, grace_period_expires_at, original_transaction_id, environment, refunded_at, country_code, last_event_at, raw_event',
          )
          .eq('user_id', userId),
      ) as Array<SubscriptionRow & { id: string }>;
    },
    async upsertSubscription(row) {
      const data = check(
        await admin
          .from('subscriptions')
          .upsert(row, { onConflict: 'user_id,store,entitlement' })
          .select('id')
          .single(),
      ) as { id: string };
      return data.id;
    },
    async userLocale(userId) {
      const row = check(await admin.from('users').select('locale').eq('id', userId).maybeSingle());
      return (row?.locale as string | undefined) ?? null;
    },
    async notify(row) {
      const { error } = await admin.from('notifications').insert(row);
      if (error && error.code !== UNIQUE) throw error;
    },
    async analytics(e) {
      check(
        await admin.from('analytics_events').insert({
          user_id: e.user_id,
          event: e.event,
          props: e.props,
          occurred_at: e.occurred_at,
          platform: 'server',
        }),
      );
    },
    async audit(e) {
      check(
        await admin.from('audit_log').insert({
          actor_user_id: e.actor,
          household_id: null,
          action: 'update',
          entity: 'subscriptions',
          entity_id: e.entityId,
          diff: e.diff,
        }),
      );
    },
    async userPremium(userId) {
      return check(await admin.rpc('has_premium', { p_user_id: userId })) === true;
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
  };
}

/**
 * `GET https://api.revenuecat.com/v1/subscribers/{id}` with the secret API key (06 §7: 5 s, 2
 * retries). Not configured without `REVENUECAT_SECRET_API_KEY`.
 */
export function revenueCatRest(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): SubscriberSource {
  return {
    configured: !!apiKey,
    async get(appUserId) {
      if (!apiKey) throw new Error('RevenueCat REST is not configured');
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetchImpl(
            `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
            {
              headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
              signal: AbortSignal.timeout(5000),
            },
          );
          if (res.ok) {
            const body = (await res.json()) as { subscriber?: RcSubscriber };
            return {
              entitlements: body.subscriber?.entitlements ?? {},
              subscriptions: body.subscriber?.subscriptions ?? {},
            };
          }
          last = new Error(`RevenueCat ${res.status}`);
          if (res.status < 500 && res.status !== 429) break;
        } catch (err) {
          last = err;
        }
      }
      throw last instanceof Error ? last : new Error('RevenueCat unavailable');
    },
  };
}
