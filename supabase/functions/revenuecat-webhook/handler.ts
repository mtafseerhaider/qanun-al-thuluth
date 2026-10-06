import { requireRevenueCat, requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier, InternalSecrets } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import type { AppEnv } from '../_shared/env.ts';
import { errorResponse, HttpError } from '../_shared/errors.ts';
import { readBodyText, requestIdOf } from '../_shared/http.ts';
import { notificationRow, routeFor } from '../_shared/notifications/templates.ts';
import {
  analyticsFor,
  deriveFromEvent,
  deriveFromSubscriber,
  entitlementOf,
  mapStore,
  scrubEvent,
  userIdsOf,
} from './derive.ts';
import type { SubscriptionRow } from './derive.ts';
import { RevenueCatWebhook } from './schema.ts';
import type { RevenueCatEvent } from './schema.ts';
import type { RevenueCatStore, SubscriberSource } from './store.ts';

/** 17 §7.5: the authenticated sync route is limited to 6 per hour per user. */
export const SYNC_PER_HOUR = 6;
/** 06 §2.8: JSON bodies over 256 KB are refused. */
const MAX_BODY_BYTES = 256 * 1024;

export interface RevenueCatWebhookDeps {
  secrets: InternalSecrets;
  verify: ClaimsVerifier;
  store: RevenueCatStore;
  rc: SubscriberSource;
  appEnv: () => AppEnv;
  now?: () => Date;
}

type Stored = SubscriptionRow & { id?: string };

/**
 * `revenuecat-webhook` (06 §4.14 and §5, 17 §7). The webhook answers 200 quickly for anything
 * handled or deliberately ignored, and non-2xx only when a retry can help (RevenueCat retries
 * with backoff): 401 bad secret, 409 duplicate delivery still running, 5xx transient failure.
 */
export function createRevenueCatWebhookHandler(deps: RevenueCatWebhookDeps) {
  const now = () => (deps.now ?? (() => new Date()))().getTime();

  const json = (body: unknown, requestId: string, status = 200) =>
    Response.json(body, { status, headers: { ...corsHeaders, 'x-request-id': requestId } });

  async function webhook(req: Request, requestId: string): Promise<Response> {
    requireRevenueCat(req, deps.secrets);
    const text = await readBodyText(req, MAX_BODY_BYTES);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError('VALIDATION_FAILED', 'Body must be JSON');
    }
    const parsed = RevenueCatWebhook.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError('VALIDATION_FAILED', 'Webhook payload is invalid', {
        issues: parsed.error.issues.slice(0, 10),
      });
    }
    const ev = parsed.data.event;

    // Sandbox purchases never touch production entitlements (06 §5.2).
    if (ev.environment === 'SANDBOX' && deps.appEnv() === 'production') {
      return json({ ok: true, ignored: 'sandbox' }, requestId);
    }

    const outcome = await deps.store.recordEvent({
      event_id: ev.id,
      type: ev.type,
      app_user_id: ev.app_user_id.slice(0, 200),
      event_timestamp: new Date(ev.event_timestamp_ms).toISOString(),
      environment: ev.environment,
      payload: { api_version: parsed.data.api_version, event: scrubEvent(ev) },
    });
    if (outcome === 'processed') return json({ ok: true, duplicate: true }, requestId);
    if (outcome === 'in_progress') {
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This event is being processed.', {
        retry_after_seconds: 60,
      });
    }

    try {
      const note = await process(ev);
      await deps.store.markProcessed(ev.id, note);
      return json({ ok: true, ...(note ? { note } : {}) }, requestId);
    } catch (err) {
      await deps.store.markFailed(ev.id, String(err)).catch(() => {});
      if (err instanceof HttpError) throw err;
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'revenuecat-webhook',
          event_id: ev.id,
          error: String(err),
        }),
      );
      throw new HttpError('INTERNAL', 'Webhook processing failed; it will be retried.');
    }
  }

  /** Applies one event. Returns a note stored on `revenuecat_events.error` for skipped events. */
  async function process(ev: RevenueCatEvent): Promise<string | null> {
    if (ev.type === 'TEST') return 'test_event';
    const ids = userIdsOf(ev);
    const known = new Set(await deps.store.knownUsers([...ids.from, ...ids.to]));
    const from = ids.from.filter((id) => known.has(id));
    const to = ids.to.filter((id) => known.has(id));
    if (!from.length && !to.length) return 'no_known_user';

    if (deps.rc.configured) {
      for (const userId of [...from, ...to])
        await refetch(userId, ev, ev.type !== 'TRANSFER' && userId === to[0]);
      if (ev.type !== 'TRANSFER' && to[0]) await sideEffects(ev, to[0], null);
      return null;
    }

    if (ev.type === 'TRANSFER') return transfer(ev, from, to);

    const userId = to[0]!;
    const rows = await deps.store.subscriptions(userId);
    const store = mapStore(ev.store);
    const entitlement = entitlementOf(ev);
    const existing =
      rows.find((r) => r.store === store && r.entitlement === entitlement) ??
      // No store on the event (rare types): the user's row for the entitlement. An unsupported
      // store (Stripe, Amazon) never borrows another store's row.
      (ev.store === undefined ? (rows.find((r) => r.entitlement === entitlement) ?? null) : null);
    // 17 §7.4: an event older than what the row already reflects never regresses it.
    if (existing?.last_event_at && Date.parse(existing.last_event_at) > ev.event_timestamp_ms) {
      return 'stale_event';
    }
    const derived = deriveFromEvent(ev, userId, existing, now());
    if (derived.kind === 'skip') return derived.reason;
    const id = await deps.store.upsertSubscription({ ...derived.row, last_event_id: ev.id });
    await auditRow(ev, id, derived.row);
    await sideEffects(ev, userId, existing, derived.row);
    return null;
  }

  /** Subscriber refetch (source of truth): every store row of the user is recomputed. */
  async function refetch(userId: string, ev: RevenueCatEvent, primary: boolean): Promise<void> {
    let subscriber;
    try {
      subscriber = await deps.rc.get(userId);
    } catch {
      throw new HttpError('UPSTREAM_UNAVAILABLE', 'RevenueCat is unavailable; retry later.');
    }
    const rows = deriveFromSubscriber(userId, subscriber, ev, now());
    const existing = await deps.store.subscriptions(userId);
    // A store row the subscriber no longer has (transferred away) is expired, never deleted.
    for (const old of existing) {
      if (old.entitlement !== 'premium' || rows.some((r) => r.store === old.store)) continue;
      if (old.status === 'expired') continue;
      rows.push(expiredCopy(old, ev));
    }
    const eventStore = mapStore(ev.store);
    for (const row of rows) {
      const tagged = primary && row.store === eventStore ? { ...row, last_event_id: ev.id } : row;
      const id = await deps.store.upsertSubscription(tagged);
      await auditRow(ev, id, row);
    }
  }

  function expiredCopy(old: Stored, ev: RevenueCatEvent): SubscriptionRow {
    const { id: _id, last_event_id: _l, ...rest } = old;
    const end =
      old.current_period_end && Date.parse(old.current_period_end) < now()
        ? old.current_period_end
        : new Date(Math.min(now(), ev.event_timestamp_ms)).toISOString();
    return {
      ...rest,
      tier: 'free',
      status: 'expired',
      will_renew: false,
      current_period_end: end,
      grace_period_expires_at: null,
      last_event_at: new Date(ev.event_timestamp_ms).toISOString(),
      raw_event: scrubEvent(ev),
    };
  }

  /**
   * TRANSFER without the REST key (17 §7.3: "recompute both"): the source users' rows expire and
   * each target gets a copy of the freshest source row per store.
   */
  async function transfer(
    ev: RevenueCatEvent,
    from: string[],
    to: string[],
  ): Promise<string | null> {
    const moved: Stored[] = [];
    for (const userId of from) {
      for (const old of await deps.store.subscriptions(userId)) {
        if (old.entitlement !== 'premium') continue;
        if (Date.parse(old.last_event_at ?? '1970-01-01') > ev.event_timestamp_ms) continue;
        if (old.status !== 'expired') moved.push(old);
        const id = await deps.store.upsertSubscription(expiredCopy(old, ev));
        await auditRow(ev, id, expiredCopy(old, ev));
      }
    }
    const best = new Map<string, Stored>();
    for (const r of moved) {
      const prev = best.get(r.store);
      if (!prev || (r.current_period_end ?? '') > (prev.current_period_end ?? ''))
        best.set(r.store, r);
    }
    for (const userId of to) {
      for (const src of best.values()) {
        const { id: _id, last_event_id: _l, ...rest } = src;
        const row: SubscriptionRow = {
          ...rest,
          user_id: userId,
          rc_app_user_id: userId,
          last_event_at: new Date(ev.event_timestamp_ms).toISOString(),
          raw_event: scrubEvent(ev),
        };
        const id = await deps.store.upsertSubscription(row);
        await auditRow(ev, id, row);
      }
    }
    return moved.length ? null : 'nothing_to_transfer';
  }

  async function auditRow(ev: RevenueCatEvent, id: string, row: SubscriptionRow): Promise<void> {
    await deps.store.audit({
      actor: null,
      entityId: id,
      diff: {
        type: ev.type,
        event_id: ev.id,
        store: row.store,
        status: row.status,
        tier: row.tier,
        product: row.product_id,
        period_end: row.current_period_end,
      },
    });
  }

  /** Analytics (18) and the `billing_issue` push (06 §4.15). Never fail the event for these. */
  async function sideEffects(
    ev: RevenueCatEvent,
    userId: string,
    previous: SubscriptionRow | null,
    row: SubscriptionRow | null = null,
  ): Promise<void> {
    const a = analyticsFor(ev, previous, row);
    try {
      if (a) {
        await deps.store.analytics({
          user_id: userId,
          event: a.event,
          props: a.props,
          occurred_at: new Date(ev.event_timestamp_ms).toISOString(),
        });
      }
      if (ev.type === 'BILLING_ISSUE') {
        await deps.store.notify(
          notificationRow({
            key: 'billing_issue',
            user_id: userId,
            household_id: null,
            locale: await deps.store.userLocale(userId),
            scheduled_for: new Date(now()),
            dedupe_key: `billing_issue:${ev.id}`,
            route: routeFor('billing_issue'),
            data: { status: row?.status ?? null },
          }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'warn',
          scope: 'revenuecat-webhook',
          event_id: ev.id,
          side_effect_error: String(err),
        }),
      );
    }
  }

  /** `POST /revenuecat-webhook/sync` (17 §7.5): the caller's own entitlement, refetched. */
  async function sync(req: Request, requestId: string): Promise<Response> {
    const user = await requireUser(req, deps.verify);
    const limit = await deps.store.consumeRateLimit(
      `revenuecat-sync:${user.userId}:hour`,
      SYNC_PER_HOUR,
      3600,
    );
    if (!limit.allowed) {
      throw new HttpError('RATE_LIMITED', 'Please wait before syncing again.', {
        reset_at: limit.reset_at,
      });
    }
    let synced = false;
    if (deps.rc.configured) {
      const ev: RevenueCatEvent = {
        id: `sync:${requestId}`,
        type: 'SYNC',
        app_user_id: user.userId,
        environment: deps.appEnv() === 'production' ? 'PRODUCTION' : 'SANDBOX',
        event_timestamp_ms: now(),
      };
      await refetch(user.userId, ev, false);
      synced = true;
    }
    const rows = (await deps.store.subscriptions(user.userId)).filter(
      (r) => r.entitlement === 'premium',
    );
    const latest = [...rows].sort((a, b) =>
      (b.current_period_end ?? '').localeCompare(a.current_period_end ?? ''),
    )[0];
    return json(
      {
        premium: await deps.store.userPremium(user.userId),
        status: latest?.status ?? null,
        current_period_end: latest?.current_period_end ?? null,
        synced,
      },
      requestId,
    );
  }

  return async (req: Request): Promise<Response> => {
    const requestId = requestIdOf(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      if (req.method !== 'POST') throw new HttpError('NOT_FOUND', 'Not found');
      const path = new URL(req.url).pathname.replace(/\/+$/, '');
      return path.endsWith('/sync') ? await sync(req, requestId) : await webhook(req, requestId);
    } catch (err) {
      if (err instanceof HttpError) {
        const headers: Record<string, string> =
          err.code === 'IDEMPOTENCY_IN_PROGRESS' ? { 'retry-after': '60' } : {};
        return errorResponse(err, requestId, headers);
      }
      console.error(JSON.stringify({ level: 'error', request_id: requestId, error: String(err) }));
      return errorResponse(new HttpError('INTERNAL', 'Something went wrong.'), requestId);
    }
  };
}
