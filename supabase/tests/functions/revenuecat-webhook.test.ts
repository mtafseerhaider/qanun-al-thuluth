import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';

import { createRevenueCatWebhookHandler } from '../../functions/revenuecat-webhook/handler.ts';
import {
  deriveFromEvent,
  deriveFromSubscriber,
  statusFrom,
  userIdsOf,
} from '../../functions/revenuecat-webhook/derive.ts';
import type { RcSubscriber, SubscriptionRow } from '../../functions/revenuecat-webhook/derive.ts';
import { RevenueCatWebhook } from '../../functions/revenuecat-webhook/schema.ts';
import type { RevenueCatEvent } from '../../functions/revenuecat-webhook/schema.ts';
import type {
  RecordOutcome,
  RevenueCatStore,
  SubscriberSource,
} from '../../functions/revenuecat-webhook/store.ts';
import type { AppEnv } from '../../functions/_shared/env.ts';
import type { NotificationRow } from '../../functions/_shared/notifications/templates.ts';

const SECRET = 'rc-webhook-test-secret-0001';
const USER = '4b1d2c3e-1111-4a4a-8b8b-000000000001';
const OTHER = '4b1d2c3e-2222-4a4a-8b8b-000000000002';
const NOW = new Date('2026-12-22T10:00:00Z');
const DAY = 86_400_000;
const T = NOW.getTime();

interface MemState {
  events: Map<string, { processed: boolean; error: string | null; fresh: boolean }>;
  subs: Map<string, SubscriptionRow & { id: string }>;
  audits: Array<Record<string, unknown>>;
  analytics: Array<{ event: string; props: Record<string, unknown> }>;
  notifications: NotificationRow[];
  counters: Map<string, number>;
  failUpserts: number;
}

function memory(users: string[] = [USER, OTHER]) {
  const state: MemState = {
    events: new Map(),
    subs: new Map(),
    audits: [],
    analytics: [],
    notifications: [],
    counters: new Map(),
    failUpserts: 0,
  };
  const key = (r: Pick<SubscriptionRow, 'user_id' | 'store' | 'entitlement'>) =>
    `${r.user_id}:${r.store}:${r.entitlement}`;
  const store: RevenueCatStore = {
    async recordEvent(row): Promise<RecordOutcome> {
      const e = state.events.get(row.event_id);
      if (!e) {
        state.events.set(row.event_id, { processed: false, error: null, fresh: true });
        return 'new';
      }
      if (e.processed) return 'processed';
      if (e.fresh && !e.error) return 'in_progress';
      e.error = null;
      return 'retry';
    },
    async markProcessed(id, note) {
      const e = state.events.get(id)!;
      e.processed = true;
      e.error = note;
    },
    async markFailed(id, error) {
      state.events.get(id)!.error = error;
    },
    knownUsers: async (ids) => ids.filter((id) => users.includes(id)),
    subscriptions: async (userId) => [...state.subs.values()].filter((s) => s.user_id === userId),
    async upsertSubscription(row) {
      if (state.failUpserts > 0) {
        state.failUpserts--;
        throw new Error('db down');
      }
      const k = key(row);
      const prev = state.subs.get(k);
      const id = prev?.id ?? crypto.randomUUID();
      state.subs.set(k, { ...prev, ...row, id });
      return id;
    },
    userLocale: async () => 'ur',
    notify: async (row) => {
      if (!state.notifications.some((n) => n.dedupe_key === row.dedupe_key))
        state.notifications.push(row);
    },
    analytics: async (e) => {
      state.analytics.push({ event: e.event, props: e.props });
    },
    audit: async (e) => {
      state.audits.push(e.diff);
    },
    userPremium: async (userId) =>
      [...state.subs.values()].some(
        (s) =>
          s.user_id === userId &&
          s.tier === 'premium' &&
          ['active', 'in_grace', 'cancelled'].includes(s.status),
      ),
    consumeRateLimit: async (k, limit) => {
      const c = (state.counters.get(k) ?? 0) + 1;
      state.counters.set(k, c);
      return {
        allowed: c <= limit,
        remaining: Math.max(0, limit - c),
        reset_at: NOW.toISOString(),
      };
    },
  };
  return { store, state, key };
}

function setup(
  opts: {
    secrets?: string[];
    env?: AppEnv;
    subscriber?: (id: string) => RcSubscriber;
    users?: string[];
  } = {},
) {
  const mem = memory(opts.users);
  const rc: SubscriberSource = opts.subscriber
    ? { configured: true, get: async (id) => opts.subscriber!(id) }
    : {
        configured: false,
        get: () => Promise.reject(new Error('not configured')),
      };
  const handler = createRevenueCatWebhookHandler({
    secrets: () => opts.secrets ?? [SECRET],
    verify: async (jwt) => (jwt === 'user' ? { sub: USER } : null),
    store: mem.store,
    rc,
    appEnv: () => opts.env ?? 'staging',
    now: () => NOW,
  });
  return { handler, ...mem };
}

let n = 0;
function event(type: string, extra: Partial<RevenueCatEvent> = {}): RevenueCatEvent {
  return {
    id: `evt-${++n}`,
    type,
    app_user_id: USER,
    product_id: 'thuluth_premium_annual',
    entitlement_ids: ['premium'],
    period_type: 'NORMAL',
    purchased_at_ms: T - DAY,
    expiration_at_ms: T + 364 * DAY,
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    country_code: 'PK',
    event_timestamp_ms: T - 60_000,
    ...extra,
  };
}

function post(
  ev: RevenueCatEvent | Record<string, unknown>,
  auth: string | null = `Bearer ${SECRET}`,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== null) headers.authorization = auth;
  return new Request('http://localhost/functions/v1/revenuecat-webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify({ api_version: '1.0', event: ev }),
  });
}

const row = (s: MemState, user = USER, store = 'app_store') =>
  s.subs.get(`${user}:${store}:premium`);

// ---- auth -----------------------------------------------------------------------------------------

Deno.test('refuses everything when no webhook secret is configured', async () => {
  const { handler, state } = setup({ secrets: [] });
  const res = await handler(post(event('INITIAL_PURCHASE')));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.code, 'WEBHOOK_UNAUTHORIZED');
  assertEquals(state.events.size, 0);
});

Deno.test('rejects a missing or wrong authorization header before reading the body', async () => {
  const { handler, state } = setup();
  for (const auth of [null, `Bearer ${SECRET}x`, SECRET, 'Bearer ']) {
    const res = await handler(post(event('INITIAL_PURCHASE'), auth));
    assertEquals(res.status, 401);
    await res.body?.cancel();
  }
  const junk = await handler(
    new Request('http://localhost/functions/v1/revenuecat-webhook', {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
      body: 'not json',
    }),
  );
  assertEquals(junk.status, 401);
  await junk.body?.cancel();
  assertEquals(state.events.size, 0);
});

Deno.test('accepts the next secret during rotation; invalid payload is 400', async () => {
  const { handler } = setup({ secrets: ['old-secret-value-000000', SECRET] });
  const ok = await handler(post(event('TEST')));
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { ok: true, note: 'test_event' });
  const bad = await handler(post({ id: 'x', type: 'RENEWAL' }));
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).error.code, 'VALIDATION_FAILED');
});

// ---- event mapping --------------------------------------------------------------------------------

Deno.test('INITIAL_PURCHASE: active premium row, analytics, audit, event processed', async () => {
  const { handler, state } = setup();
  const ev = event('INITIAL_PURCHASE', { period_type: 'TRIAL' });
  const res = await handler(post(ev));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  const r = row(state);
  assertExists(r);
  assertEquals(r.tier, 'premium');
  assertEquals(r.status, 'active');
  assertEquals(r.will_renew, true);
  assertEquals(r.period_type, 'trial');
  assertEquals(r.environment, 'production');
  assertEquals(r.country_code, 'PK');
  assertEquals(r.last_event_id, ev.id);
  assertEquals(r.current_period_end, new Date(T + 364 * DAY).toISOString());
  assertEquals(state.events.get(ev.id)?.processed, true);
  assertEquals(state.analytics[0]?.event, 'subscription_started');
  assertEquals(state.audits.length, 1);
  // raw_event is scrubbed: no app user id or subscriber attributes.
  assertEquals(r.raw_event.app_user_id, undefined);
});

Deno.test('AC-SUB2: replaying the same event id writes nothing twice', async () => {
  const { handler, state } = setup();
  const ev = event('INITIAL_PURCHASE');
  assertEquals((await handler(post(ev))).status, 200);
  const res = await handler(post(ev));
  assertEquals(await res.json(), { ok: true, duplicate: true });
  assertEquals(state.audits.length, 1);
  assertEquals(state.analytics.length, 1);
  assertEquals(state.subs.size, 1);
});

Deno.test('CANCELLATION keeps premium to period end; UNCANCELLATION restores renewal', async () => {
  const { handler, state } = setup();
  await handler(post(event('INITIAL_PURCHASE')));
  await handler(
    post(event('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: T - 30_000 })),
  );
  assertEquals(row(state)?.status, 'cancelled');
  assertEquals(row(state)?.tier, 'premium');
  assertEquals(row(state)?.will_renew, false);
  assertEquals(state.analytics.at(-1)?.event, 'subscription_cancelled');
  await handler(post(event('UNCANCELLATION', { event_timestamp_ms: T - 20_000 })));
  assertEquals(row(state)?.status, 'active');
  assertEquals(row(state)?.will_renew, true);
});

Deno.test('AC-SUB4: a refund revokes premium immediately and records refunded_at', async () => {
  const { handler, state } = setup();
  await handler(post(event('INITIAL_PURCHASE')));
  await handler(
    post(
      event('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', event_timestamp_ms: T - 10_000 }),
    ),
  );
  const r = row(state);
  assertEquals(r?.status, 'expired');
  assertEquals(r?.tier, 'free');
  assertEquals(r?.will_renew, false);
  assertEquals(r?.refunded_at, new Date(T - 10_000).toISOString());
  assert(Date.parse(r?.current_period_end ?? '') <= T);
  assertEquals(state.analytics.at(-1)?.event, 'subscription_refunded');
});

Deno.test(
  'AC-SUB7: BILLING_ISSUE in grace keeps premium and pushes billing_issue once',
  async () => {
    const { handler, state } = setup();
    await handler(post(event('INITIAL_PURCHASE', { expiration_at_ms: T - DAY })));
    const ev = event('BILLING_ISSUE', {
      expiration_at_ms: T - DAY,
      grace_period_expiration_at_ms: T + 15 * DAY,
      event_timestamp_ms: T - 5_000,
    });
    await handler(post(ev));
    const r = row(state);
    assertEquals(r?.status, 'in_grace');
    assertEquals(r?.tier, 'premium');
    assertEquals(r?.grace_period_expires_at, new Date(T + 15 * DAY).toISOString());
    assertEquals(state.notifications.length, 1);
    const push = state.notifications[0]!;
    assertEquals(push.kind, 'billing_issue');
    assertEquals(push.dedupe_key, `billing_issue:${ev.id}`);
    assertEquals(push.data.route, 'thuluth://settings/subscription');
    assertEquals(state.analytics.at(-1), {
      event: 'subscription_billing_issue',
      props: { in_grace: true },
    });
  },
);

Deno.test('AC-SUB7: BILLING_ISSUE after grace is in_billing_retry without premium', async () => {
  const { handler, state } = setup();
  await handler(
    post(
      event('BILLING_ISSUE', {
        expiration_at_ms: T - 20 * DAY,
        grace_period_expiration_at_ms: T - DAY,
      }),
    ),
  );
  assertEquals(row(state)?.status, 'in_billing_retry');
  assertEquals(row(state)?.tier, 'free');
  assertEquals(row(state)?.will_renew, true);
});

Deno.test('EXPIRATION, PAUSED and NON_RENEWING_PURCHASE', async () => {
  const { handler, state } = setup();
  await handler(post(event('INITIAL_PURCHASE')));
  await handler(
    post(event('EXPIRATION', { expiration_reason: 'UNSUBSCRIBE', event_timestamp_ms: T - 1000 })),
  );
  assertEquals(row(state)?.status, 'expired');
  assertEquals(row(state)?.tier, 'free');
  assertEquals(state.analytics.at(-1)?.event, 'subscription_expired');

  const play = setup();
  await play.handler(post(event('SUBSCRIPTION_PAUSED', { store: 'PLAY_STORE' })));
  assertEquals(row(play.state, USER, 'play_store')?.status, 'paused');
  assertEquals(row(play.state, USER, 'play_store')?.tier, 'free');

  const once = setup();
  const res = await once.handler(post(event('NON_RENEWING_PURCHASE')));
  assertEquals(await res.json(), { ok: true, note: 'not_a_subscription' });
  assertEquals(once.state.subs.size, 0);
});

Deno.test(
  'promotional grants are active, never renew; unknown types and stores are acknowledged',
  async () => {
    const { handler, state } = setup();
    await handler(
      post(event('INITIAL_PURCHASE', { store: 'PROMOTIONAL', period_type: 'PROMOTIONAL' })),
    );
    const promo = row(state, USER, 'promotional');
    assertEquals(promo?.status, 'active');
    assertEquals(promo?.will_renew, false);
    assertEquals(promo?.period_type, 'promotional');

    const res = await handler(post(event('SOMETHING_NEW')));
    assertEquals(await res.json(), { ok: true, note: 'unknown_type' });
    const stripe = await handler(post(event('INITIAL_PURCHASE', { store: 'STRIPE' })));
    assertEquals(await stripe.json(), { ok: true, note: 'unsupported_store' });
  },
);

Deno.test('AC-SUB3 (event mode): an older event never regresses a newer row', async () => {
  const { handler, state } = setup();
  await handler(post(event('RENEWAL', { event_timestamp_ms: T - 1000 })));
  const res = await handler(post(event('EXPIRATION', { event_timestamp_ms: T - 50 * DAY })));
  assertEquals(await res.json(), { ok: true, note: 'stale_event' });
  assertEquals(row(state)?.status, 'active');
});

Deno.test('anonymous and unknown app user ids are ignored with 200', async () => {
  const { handler, state } = setup();
  const anon = await handler(
    post(event('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:abc' })),
  );
  assertEquals(await anon.json(), { ok: true, note: 'no_known_user' });
  const ghost = await handler(
    post(event('INITIAL_PURCHASE', { app_user_id: '4b1d2c3e-9999-4a4a-8b8b-000000000009' })),
  );
  assertEquals(await ghost.json(), { ok: true, note: 'no_known_user' });
  // An alias that is a known user id is used when app_user_id is anonymous.
  await handler(
    post(event('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:x', aliases: [USER] })),
  );
  assertEquals(row(state)?.status, 'active');
});

Deno.test('TRANSFER: source rows expire, target gets the subscription', async () => {
  const { handler, state } = setup();
  await handler(post(event('INITIAL_PURCHASE', { event_timestamp_ms: T - DAY })));
  const res = await handler(
    post(
      event('TRANSFER', {
        app_user_id: OTHER,
        transferred_from: [USER],
        transferred_to: [OTHER],
        product_id: undefined,
        expiration_at_ms: undefined,
      }),
    ),
  );
  assertEquals(await res.json(), { ok: true });
  assertEquals(row(state, USER)?.status, 'expired');
  assertEquals(row(state, USER)?.tier, 'free');
  const moved = row(state, OTHER);
  assertEquals(moved?.status, 'active');
  assertEquals(moved?.tier, 'premium');
  assertEquals(moved?.product_id, 'thuluth_premium_annual');
  assertEquals(moved?.rc_app_user_id, OTHER);
});

Deno.test('sandbox events are ignored in production and applied elsewhere', async () => {
  const prod = setup({ env: 'production' });
  const res = await prod.handler(post(event('INITIAL_PURCHASE', { environment: 'SANDBOX' })));
  assertEquals(await res.json(), { ok: true, ignored: 'sandbox' });
  assertEquals(prod.state.subs.size, 0);
  const staging = setup({ env: 'staging' });
  await staging.handler(post(event('INITIAL_PURCHASE', { environment: 'SANDBOX' })));
  assertEquals(row(staging.state)?.environment, 'sandbox');
});

Deno.test(
  'a failed write returns 500 so RevenueCat retries; the retry processes the event',
  async () => {
    const { handler, state } = setup();
    state.failUpserts = 1;
    const ev = event('INITIAL_PURCHASE');
    const first = await handler(post(ev));
    assertEquals(first.status, 500);
    await first.body?.cancel();
    assertEquals(state.events.get(ev.id)?.processed, false);
    assert(state.events.get(ev.id)?.error?.includes('db down'));
    const retry = await handler(post(ev));
    assertEquals(retry.status, 200);
    await retry.body?.cancel();
    assertEquals(row(state)?.status, 'active');
  },
);

Deno.test(
  'a duplicate delivery while the first is still running gets 409 with Retry-After',
  async () => {
    const { handler, state } = setup();
    const ev = event('INITIAL_PURCHASE');
    state.events.set(ev.id, { processed: false, error: null, fresh: true });
    const res = await handler(post(ev));
    assertEquals(res.status, 409);
    assertEquals(res.headers.get('retry-after'), '60');
    assertEquals((await res.json()).error.code, 'IDEMPOTENCY_IN_PROGRESS');
  },
);

// ---- subscriber refetch -----------------------------------------------------------------------------

const subscriber = (sub: Partial<RcSubscriber['subscriptions'][string]>): RcSubscriber => ({
  entitlements: {
    premium: {
      expires_date: sub.expires_date ?? null,
      product_identifier: 'thuluth_premium_annual',
    },
  },
  subscriptions: {
    thuluth_premium_annual: {
      expires_date: new Date(T + 300 * DAY).toISOString(),
      store: 'app_store',
      period_type: 'normal',
      ...sub,
    },
  },
});

Deno.test('AC-SUB3 (refetch mode): a late EXPIRATION cannot undo a renewal', async () => {
  const { handler, state } = setup({ subscriber: () => subscriber({}) });
  const res = await handler(post(event('EXPIRATION', { expiration_at_ms: T - DAY })));
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(row(state)?.status, 'active');
  assertEquals(row(state)?.tier, 'premium');
});

Deno.test('refetch mode: RevenueCat down is a 503 for retry', async () => {
  const { handler } = setup({
    subscriber: () => {
      throw new Error('timeout');
    },
  });
  const res = await handler(post(event('RENEWAL')));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, 'UPSTREAM_UNAVAILABLE');
});

Deno.test(
  'refetch mode: a store the subscriber no longer has is expired (transfer away)',
  async () => {
    const { handler, state } = setup({
      subscriber: (id) => (id === USER ? { entitlements: {}, subscriptions: {} } : subscriber({})),
    });
    await handler(post(event('INITIAL_PURCHASE', { app_user_id: OTHER })));
    // seed USER's old row, then transfer
    await state.subs.set(`${USER}:app_store:premium`, {
      ...row(state, OTHER)!,
      user_id: USER,
      rc_app_user_id: USER,
      id: 'old',
    });
    await handler(post(event('TRANSFER', { transferred_from: [USER], transferred_to: [OTHER] })));
    assertEquals(row(state, USER)?.status, 'expired');
    assertEquals(row(state, OTHER)?.status, 'active');
  },
);

// ---- sync route ------------------------------------------------------------------------------------

function sync(jwt = 'user') {
  return new Request('http://localhost/functions/v1/revenuecat-webhook/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: '{}',
  });
}

Deno.test('sync: JWT required, refetches when configured, 6 per hour', async () => {
  const { handler } = setup({ subscriber: () => subscriber({}) });
  const anon = await handler(sync('bad'));
  assertEquals(anon.status, 401);
  await anon.body?.cancel();
  const res = await handler(sync());
  assertEquals(await res.json(), {
    premium: true,
    status: 'active',
    current_period_end: new Date(T + 300 * DAY).toISOString(),
    synced: true,
  });
  for (let i = 0; i < 5; i++) await (await handler(sync())).body?.cancel();
  const limited = await handler(sync());
  assertEquals(limited.status, 429);
  await limited.body?.cancel();

  const offline = setup();
  const r2 = await offline.handler(sync());
  assertEquals((await r2.json()).synced, false);
});

// ---- pure mapping ------------------------------------------------------------------------------------

Deno.test('statusFrom follows the 17 §7.3 precedence', () => {
  const base = {
    expiresMs: T + DAY,
    graceMs: null,
    unsubscribed: false,
    billingIssue: false,
    paused: false,
    refunded: false,
  };
  assertEquals(statusFrom(base, T), { status: 'active', tier: 'premium' });
  assertEquals(statusFrom({ ...base, unsubscribed: true }, T).status, 'cancelled');
  assertEquals(statusFrom({ ...base, refunded: true }, T), { status: 'expired', tier: 'free' });
  assertEquals(statusFrom({ ...base, expiresMs: T - DAY }, T).status, 'expired');
  assertEquals(
    statusFrom({ ...base, expiresMs: T - DAY, unsubscribed: true }, T).status,
    'expired',
  );
  assertEquals(
    statusFrom({ ...base, expiresMs: T - DAY, billingIssue: true, graceMs: T + DAY }, T).status,
    'in_grace',
  );
  assertEquals(
    statusFrom({ ...base, expiresMs: T - DAY, billingIssue: true, graceMs: T - 1 }, T).status,
    'in_billing_retry',
  );
  assertEquals(statusFrom({ ...base, expiresMs: null }, T).status, 'active');
  assertEquals(statusFrom({ ...base, paused: true }, T), { status: 'paused', tier: 'free' });
});

Deno.test('deriveFromSubscriber: billing issue, unsubscribe, refund, sandbox', () => {
  const rows = (s: Partial<RcSubscriber['subscriptions'][string]>) =>
    deriveFromSubscriber(USER, subscriber(s), null, T);
  assertEquals(rows({})[0]?.status, 'active');
  assertEquals(rows({ unsubscribe_detected_at: '2026-12-01T00:00:00Z' })[0]?.status, 'cancelled');
  assertEquals(rows({ refunded_at: '2026-12-01T00:00:00Z' })[0]?.tier, 'free');
  const grace = rows({
    expires_date: new Date(T - DAY).toISOString(),
    billing_issues_detected_at: '2026-12-20T00:00:00Z',
    grace_period_expires_date: new Date(T + 6 * DAY).toISOString(),
  })[0];
  assertEquals(grace?.status, 'in_grace');
  assertEquals(grace?.grace_period_expires_at, new Date(T + 6 * DAY).toISOString());
  assertEquals(rows({ is_sandbox: true })[0]?.environment, 'sandbox');
  assertEquals(rows({ store: 'stripe' }).length, 0);
});

Deno.test('payload schema tolerates new fields and types; userIdsOf ignores anonymous ids', () => {
  const parsed = RevenueCatWebhook.parse({
    event: { ...event('BRAND_NEW_TYPE'), subscriber_attributes: { $email: { value: 'x' } } },
  });
  assertEquals(parsed.api_version, '1.0');
  assertEquals(userIdsOf(event('RENEWAL', { app_user_id: '$RCAnonymousID:1' })).to, []);
  assertEquals(
    userIdsOf(event('TRANSFER', { transferred_from: [USER, 'anon'], transferred_to: [OTHER] })),
    {
      from: [USER],
      to: [OTHER],
    },
  );
  const d = deriveFromEvent(
    event('INITIAL_PURCHASE', { entitlement_ids: ['coach'] }),
    USER,
    null,
    T,
  );
  assertEquals(d.kind === 'row' && d.row.entitlement, 'coach');
});
