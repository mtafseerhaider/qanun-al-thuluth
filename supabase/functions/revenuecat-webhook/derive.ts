import type { RevenueCatEvent } from './schema.ts';

/**
 * RevenueCat state to `subscriptions` rows (06 §5.2, 17 §7.3). Pure functions, so every event
 * type is covered by fixtures without a database.
 *
 * Two sources:
 * - `deriveFromSubscriber`: the refetched subscriber (`GET /v1/subscribers/{id}`), the source of
 *   truth when `REVENUECAT_SECRET_API_KEY` is configured; out-of-order events cannot regress it.
 * - `deriveFromEvent`: the event payload alone, used when no RevenueCat REST key is configured.
 *   Stale events (older than the row's `last_event_at`) are skipped by the handler.
 */

export type SubStore = 'app_store' | 'play_store' | 'promotional';
export type SubStatus =
  'active' | 'in_grace' | 'in_billing_retry' | 'cancelled' | 'expired' | 'paused';
export type SubPeriodType = 'trial' | 'intro' | 'normal' | 'promotional';

/** A `subscriptions` row as written (05 §13.1 and §22.9 column names). */
export interface SubscriptionRow {
  user_id: string;
  tier: 'free' | 'premium';
  status: SubStatus;
  product_id: string;
  store: SubStore;
  entitlement: 'premium' | 'coach';
  rc_app_user_id: string;
  current_period_end: string | null;
  will_renew: boolean;
  period_type: SubPeriodType | null;
  grace_period_expires_at: string | null;
  original_transaction_id: string | null;
  environment: 'production' | 'sandbox';
  refunded_at: string | null;
  country_code: string | null;
  last_event_at: string;
  raw_event: Record<string, unknown>;
  /** Set only on the row the event is about (unique index `subscriptions_last_event_key`). */
  last_event_id?: string;
}

const PREMIUM_STATUSES = new Set<SubStatus>(['active', 'in_grace', 'cancelled']);

export function mapStore(store: string | undefined | null): SubStore | null {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return null; // Stripe, Amazon, RC Billing, Paddle, test store: no products there in v1
  }
}

export function mapPeriodType(p: string | undefined | null): SubPeriodType | null {
  switch ((p ?? '').toUpperCase()) {
    case 'TRIAL':
      return 'trial';
    case 'INTRO':
      return 'intro';
    case 'NORMAL':
    case 'PREPAID':
      return 'normal';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return null;
  }
}

/** `coach` only when the event names the coach entitlement and not premium (Phase 2). */
export function entitlementOf(ev: Pick<RevenueCatEvent, 'entitlement_ids'>): 'premium' | 'coach' {
  const ids = ev.entitlement_ids ?? [];
  return ids.includes('coach') && !ids.includes('premium') ? 'coach' : 'premium';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/**
 * The Thuluth user ids an event is about. App User ID is `users.id` (17 §2.2); anonymous
 * `$RCAnonymousID:` ids are ignored. TRANSFER: both sides, recomputed.
 */
export function userIdsOf(ev: RevenueCatEvent): { from: string[]; to: string[] } {
  if (ev.type === 'TRANSFER') {
    return {
      from: [...new Set((ev.transferred_from ?? []).filter(isUuid))],
      to: [...new Set((ev.transferred_to ?? []).filter(isUuid))],
    };
  }
  const candidates = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])];
  const id = candidates.find(isUuid);
  return { from: [], to: id ? [id.toLowerCase()] : [] };
}

/** The fields kept from an event (`raw_event`, `revenuecat_events.payload`): no subscriber attributes, emails or aliases. */
const KEPT = [
  'id',
  'type',
  'product_id',
  'new_product_id',
  'entitlement_ids',
  'period_type',
  'purchased_at_ms',
  'expiration_at_ms',
  'grace_period_expiration_at_ms',
  'store',
  'environment',
  'cancel_reason',
  'expiration_reason',
  'country_code',
  'event_timestamp_ms',
  'is_family_share',
  'offer_code',
] as const;

export function scrubEvent(ev: RevenueCatEvent): Record<string, unknown> {
  const raw = ev as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of KEPT) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

const iso = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export interface StateFacts {
  /** Null: no expiry (lifetime or unknown promotional); treated as current. */
  expiresMs: number | null;
  graceMs: number | null;
  unsubscribed: boolean;
  billingIssue: boolean;
  paused: boolean;
  refunded: boolean;
}

/** 17 §7.3 status precedence. */
export function statusFrom(
  f: StateFacts,
  now: number,
): { status: SubStatus; tier: 'free' | 'premium' } {
  let status: SubStatus;
  const current = f.expiresMs === null || f.expiresMs > now;
  if (f.refunded) status = 'expired';
  else if (f.billingIssue) {
    const graceEnd = f.graceMs ?? (current ? f.expiresMs : null);
    status = graceEnd === null || graceEnd > now ? 'in_grace' : 'in_billing_retry';
  } else if (current) status = f.paused ? 'paused' : f.unsubscribed ? 'cancelled' : 'active';
  else status = f.paused ? 'paused' : 'expired';
  return { status, tier: PREMIUM_STATUSES.has(status) ? 'premium' : 'free' };
}

const ACTIVE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
]);

/** Refunds arrive as CANCELLATION with `cancel_reason = 'CUSTOMER_SUPPORT'` (17 §7.3, §13). */
export const isRefund = (ev: Pick<RevenueCatEvent, 'type' | 'cancel_reason'>): boolean =>
  ev.type === 'CANCELLATION' && ev.cancel_reason === 'CUSTOMER_SUPPORT';

export type DeriveResult =
  | { kind: 'row'; row: SubscriptionRow }
  | { kind: 'skip'; reason: 'unsupported_store' | 'not_a_subscription' | 'unknown_type' };

/**
 * One row for `userId` from the event alone (17 §7.3 table). `existing` is the current row for
 * (user, store, entitlement), used for fields the event does not carry.
 */
export function deriveFromEvent(
  ev: RevenueCatEvent,
  userId: string,
  existing: SubscriptionRow | null,
  now: number,
): DeriveResult {
  const store = mapStore(ev.store) ?? existing?.store ?? null;
  if (!store) return { kind: 'skip', reason: 'unsupported_store' };
  if (ev.type === 'NON_RENEWING_PURCHASE') return { kind: 'skip', reason: 'not_a_subscription' };
  const refund = isRefund(ev);
  const known =
    ACTIVE_TYPES.has(ev.type) ||
    ['CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'EXPIRATION'].includes(ev.type);
  if (!known) return { kind: 'skip', reason: 'unknown_type' };

  const prevExpires = ms(existing?.current_period_end);
  let expiresMs =
    typeof ev.expiration_at_ms === 'number' ? ev.expiration_at_ms : (prevExpires ?? null);
  if (ev.type === 'EXPIRATION' || refund) expiresMs = Math.min(expiresMs ?? now, now);
  const extended = ev.type === 'SUBSCRIPTION_EXTENDED';
  const facts: StateFacts = {
    expiresMs,
    graceMs:
      ev.type === 'BILLING_ISSUE'
        ? (ev.grace_period_expiration_at_ms ?? null)
        : ACTIVE_TYPES.has(ev.type)
          ? null
          : ms(existing?.grace_period_expires_at),
    unsubscribed:
      (ev.type === 'CANCELLATION' && !refund) ||
      (extended && existing?.status === 'cancelled') ||
      store === 'promotional',
    billingIssue:
      ev.type === 'BILLING_ISSUE' ||
      (ev.type === 'CANCELLATION' && ev.cancel_reason === 'BILLING_ERROR'),
    paused: ev.type === 'SUBSCRIPTION_PAUSED',
    refunded: refund,
  };
  // A promotional grant never renews but is not "cancelled" either: it is active to its end.
  const { status, tier } = statusFrom(
    store === 'promotional' ? { ...facts, unsubscribed: false } : facts,
    now,
  );
  const willRenew =
    store === 'promotional'
      ? false
      : extended
        ? (existing?.will_renew ?? true)
        : !(facts.unsubscribed || refund || ev.type === 'EXPIRATION');
  const grace =
    status === 'in_grace'
      ? (facts.graceMs ?? expiresMs)
      : status === 'in_billing_retry'
        ? facts.graceMs
        : null;
  const cc = (ev.country_code ?? '').toUpperCase();
  return {
    kind: 'row',
    row: {
      user_id: userId,
      tier,
      status,
      product_id: ev.product_id ?? existing?.product_id ?? 'unknown',
      store,
      entitlement: entitlementOf(ev),
      rc_app_user_id: userId,
      current_period_end: iso(expiresMs),
      will_renew: willRenew,
      period_type: mapPeriodType(ev.period_type) ?? existing?.period_type ?? null,
      grace_period_expires_at: iso(grace),
      original_transaction_id:
        ev.original_transaction_id ?? existing?.original_transaction_id ?? null,
      environment: ev.environment === 'SANDBOX' ? 'sandbox' : 'production',
      refunded_at: refund
        ? new Date(ev.event_timestamp_ms).toISOString()
        : ACTIVE_TYPES.has(ev.type)
          ? null
          : (existing?.refunded_at ?? null),
      country_code: /^[A-Z]{2}$/.test(cc) ? cc : (existing?.country_code ?? null),
      last_event_at: new Date(ev.event_timestamp_ms).toISOString(),
      raw_event: scrubEvent(ev),
    },
  };
}

// ---- subscriber refetch -------------------------------------------------------------------------

/** The `GET /v1/subscribers/{id}` fields we read. */
export interface RcSubscriber {
  original_app_user_id?: string;
  entitlements: Record<
    string,
    {
      expires_date: string | null;
      grace_period_expires_date?: string | null;
      product_identifier: string;
      purchase_date?: string | null;
    }
  >;
  subscriptions: Record<
    string,
    {
      expires_date: string | null;
      grace_period_expires_date?: string | null;
      billing_issues_detected_at?: string | null;
      unsubscribe_detected_at?: string | null;
      refunded_at?: string | null;
      period_type?: string | null;
      store?: string | null;
      is_sandbox?: boolean;
      original_purchase_date?: string | null;
      store_transaction_id?: string | null;
    }
  >;
}

/**
 * One row per store for the `premium` entitlement (17 §7.3): the subscription of that store
 * with the latest expiry. A store without any subscription yields no row (nothing to update).
 */
export function deriveFromSubscriber(
  userId: string,
  subscriber: RcSubscriber,
  ev: RevenueCatEvent | null,
  now: number,
): SubscriptionRow[] {
  const byStore = new Map<
    SubStore,
    { product: string; sub: RcSubscriber['subscriptions'][string] }
  >();
  for (const [product, sub] of Object.entries(subscriber.subscriptions ?? {})) {
    const store = mapStore(sub.store === 'promotional' ? 'PROMOTIONAL' : sub.store?.toUpperCase());
    if (!store) continue;
    const prev = byStore.get(store);
    const exp = ms(sub.expires_date) ?? Number.POSITIVE_INFINITY;
    const prevExp = prev ? (ms(prev.sub.expires_date) ?? Number.POSITIVE_INFINITY) : -1;
    if (!prev || exp > prevExp) byStore.set(store, { product, sub });
  }
  const eventAt = new Date(ev?.event_timestamp_ms ?? now).toISOString();
  const eventStore = mapStore(ev?.store);
  const rows: SubscriptionRow[] = [];
  for (const [store, { product, sub }] of byStore) {
    const facts: StateFacts = {
      expiresMs: ms(sub.expires_date),
      graceMs: ms(sub.grace_period_expires_date),
      unsubscribed: !!sub.unsubscribe_detected_at && store !== 'promotional',
      billingIssue: !!sub.billing_issues_detected_at,
      paused: false,
      refunded: !!sub.refunded_at,
    };
    if (ev?.type === 'SUBSCRIPTION_PAUSED' && eventStore === store) facts.paused = true;
    const { status, tier } = statusFrom(facts, now);
    rows.push({
      user_id: userId,
      tier,
      status,
      product_id: product,
      store,
      entitlement: 'premium',
      rc_app_user_id: userId,
      current_period_end: sub.expires_date ?? null,
      will_renew:
        store !== 'promotional' && !facts.unsubscribed && !facts.refunded && status !== 'expired',
      period_type: mapPeriodType(sub.period_type),
      grace_period_expires_at:
        status === 'in_grace' || status === 'in_billing_retry'
          ? (sub.grace_period_expires_date ??
            (status === 'in_grace' ? sub.expires_date : null) ??
            null)
          : null,
      original_transaction_id: sub.store_transaction_id ?? null,
      environment: sub.is_sandbox ? 'sandbox' : 'production',
      refunded_at: sub.refunded_at ?? null,
      country_code: null,
      last_event_at: eventAt,
      raw_event: ev ? scrubEvent(ev) : { source: 'sync' },
    });
  }
  return rows;
}

/** 18 analytics events from webhook types; props are allowlisted scalars only. */
export function analyticsFor(
  ev: RevenueCatEvent,
  previous: SubscriptionRow | null,
  row: SubscriptionRow | null,
): { event: string; props: Record<string, string | boolean> } | null {
  const product = ev.product_id ?? row?.product_id ?? 'unknown';
  switch (ev.type) {
    case 'INITIAL_PURCHASE':
      return {
        event: 'subscription_started',
        props: {
          product_id: product,
          period_type: row?.period_type ?? 'normal',
          store: row?.store ?? 'unknown',
          country_code: row?.country_code ?? 'unknown',
        },
      };
    case 'RENEWAL':
      return {
        event: 'subscription_renewed',
        props: { product_id: product, was_trial: previous?.period_type === 'trial' },
      };
    case 'CANCELLATION':
      return isRefund(ev)
        ? { event: 'subscription_refunded', props: { product_id: product } }
        : {
            event: 'subscription_cancelled',
            props: {
              product_id: product,
              cancel_reason: (ev.cancel_reason ?? 'unknown').slice(0, 40),
            },
          };
    case 'EXPIRATION':
      return { event: 'subscription_expired', props: { product_id: product } };
    case 'BILLING_ISSUE':
      return {
        event: 'subscription_billing_issue',
        props: { in_grace: row?.status === 'in_grace' },
      };
    default:
      return null;
  }
}
