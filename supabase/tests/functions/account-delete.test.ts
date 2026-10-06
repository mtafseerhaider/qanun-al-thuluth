import { assert, assertEquals } from 'jsr:@std/assert@1';
import { AccountDeleteResponse } from '@thuluth/shared/contracts/account-delete.ts';

import { createAccountDeleteHandler } from '../../functions/account-delete/handler.ts';
import type { AccountDeleteStore, ErasureResult } from '../../functions/account-delete/store.ts';
import { assertRecentAuth } from '../../functions/_shared/auth.ts';
import { fromPostgrestError, HttpError } from '../../functions/_shared/errors.ts';
import type { AccountEmail } from '../../functions/_shared/integrations/account-emails.ts';
import type { StorageAdmin, StoredObject } from '../../functions/_shared/storage.ts';

const USER = '00000000-0000-4000-a000-000000000001';
const OTHER = '00000000-0000-4000-a000-000000000002';
const HH = '00000000-0000-4000-b000-000000000001';
const GONE_HH = '00000000-0000-4000-b000-000000000009';
const SESSION = '00000000-0000-4000-c000-000000000001';
const GONE_SESSION = '00000000-0000-4000-c000-000000000009';
const MEMBER = '00000000-0000-4000-d000-000000000001';
const SECRET = 'cron-secret-for-tests';
const NOW = new Date('2026-10-06T08:00:00Z');
const nowSec = NOW.getTime() / 1000;

function setup(
  o: {
    subscription?: boolean;
    blocked?: boolean;
    erasureFails?: boolean;
    revokeFails?: boolean;
  } = {},
) {
  const state = {
    emails: [] as AccountEmail[],
    revoked: [] as string[],
    scheduled: new Map<string, { at: string; reason: string | null }>(),
    authDeleted: [] as string[],
    erased: [] as string[],
    processorCalls: [] as string[],
    idem: new Map<string, { id: string; hash: string; body?: unknown; done: boolean }>(),
    objects: new Map<string, StoredObject[]>([
      [
        'meal-photos',
        [
          { path: `${HH}/${MEMBER}/2026/09/a.jpg`, created_at: '2026-09-01T00:00:00Z', size: 10 },
          {
            path: `${HH}/${MEMBER}/2026/09/orphan.jpg`,
            created_at: '2026-09-01T00:00:00Z',
            size: 10,
          },
          {
            path: `${HH}/${MEMBER}/2026/10/fresh.jpg`,
            created_at: '2026-10-06T07:00:00Z',
            size: 10,
          },
          {
            path: `${GONE_HH}/${MEMBER}/2026/09/b.jpg`,
            created_at: '2026-09-01T00:00:00Z',
            size: 10,
          },
        ],
      ],
      [
        'chat-attachments',
        [
          { path: `${HH}/${SESSION}/x.jpg`, created_at: '2026-09-01T00:00:00Z', size: 1 },
          { path: `${HH}/${GONE_SESSION}/y.jpg`, created_at: '2026-09-01T00:00:00Z', size: 1 },
        ],
      ],
      [
        'exports',
        [{ path: `account/${USER}/old.zip`, created_at: '2026-09-01T00:00:00Z', size: 1 }],
      ],
    ]),
  };
  const store: AccountDeleteStore = {
    consumeRateLimit: async () => ({ allowed: true, remaining: 1, reset_at: 'x' }),
    idempotencyBegin: async (_s, user, key, hash) => {
      const row = state.idem.get(`${user}:${key}`);
      if (!row) {
        const id = crypto.randomUUID();
        state.idem.set(`${user}:${key}`, { id, hash, done: false });
        return { state: 'new', id };
      }
      if (row.hash !== hash) return { state: 'mismatch' };
      return row.done ? { state: 'replay', status: 200, body: row.body } : { state: 'in_progress' };
    },
    idempotencyComplete: async (id, _s, body) => {
      for (const r of state.idem.values()) if (r.id === id) Object.assign(r, { body, done: true });
    },
    idempotencyFail: async (id) => {
      for (const [k, r] of state.idem) if (r.id === id) state.idem.delete(k);
    },
    requestDeletion: async (user, reason, immediate) => {
      if (o.blocked)
        throw fromPostgrestError({
          code: 'P0001',
          message: 'OWNERSHIP_TRANSFER_REQUIRED',
          details: JSON.stringify({ blocked: true, households: [HH] }),
        });
      if (state.scheduled.has(user))
        throw fromPostgrestError({ code: 'P0001', message: 'ACCOUNT_DELETION_PENDING' });
      const at = immediate
        ? NOW.toISOString()
        : new Date(NOW.getTime() + 30 * 86_400_000).toISOString();
      state.scheduled.set(user, { at, reason });
      return at;
    },
    cancelDeletion: async (user) => {
      if (!state.scheduled.delete(user))
        throw fromPostgrestError({ code: 'P0001', message: 'ACCOUNT_DELETION_NOT_PENDING' });
    },
    activeStoreSubscription: async () => o.subscription ?? false,
    dueUsers: async (now) => [...state.scheduled].filter(([, v]) => v.at <= now).map(([k]) => k),
    erase: async (user): Promise<ErasureResult> => {
      if (o.erasureFails) throw new HttpError('INTERNAL', 'boom');
      state.erased.push(user);
      state.scheduled.delete(user);
      return {
        deleted_household_ids: [HH],
        left_household_ids: [],
        storage_prefixes: [
          { bucket: 'meal-photos', prefix: `${HH}/` },
          { bucket: 'exports', prefix: `account/${user}/` },
        ],
      };
    },
    deleteAuthUser: async (user) => {
      state.authDeleted.push(user);
    },
    acquireLease: async () => true,
    releaseLease: async () => {},
    existing: async (table, ids) =>
      new Set(
        ids.filter((id) =>
          table === 'households'
            ? id === HH
            : table === 'chat_sessions'
              ? id === SESSION
              : id === MEMBER,
        ),
      ),
    referencedMealPhotos: async () => new Set([`${HH}/${MEMBER}/2026/09/a.jpg`]),
    contact: async (user) =>
      state.authDeleted.includes(user)
        ? null
        : { email: `${user.slice(-1)}@example.com`, locale: 'en', timezone: 'Asia/Karachi' },
    revokeOtherSessions: async (jwt) => {
      if (o.revokeFails) throw new Error('gotrue down');
      state.revoked.push(jwt);
    },
  };
  const storage: StorageAdmin = {
    listAll: async (bucket, prefix) =>
      (state.objects.get(bucket) ?? []).filter((o) => o.path.startsWith(prefix)),
    remove: async (bucket, paths) => {
      state.objects.set(
        bucket,
        (state.objects.get(bucket) ?? []).filter((o) => !paths.includes(o.path)),
      );
    },
    download: async () => new Uint8Array(),
    upload: async () => {},
    signedUrl: async () => 'https://x.test',
  };
  const handler = createAccountDeleteHandler({
    verify: async (jwt) => {
      const [sub, age] = jwt.split(':');
      return { sub: sub!, amr: [{ method: 'otp', timestamp: nowSec - Number(age ?? 0) }] };
    },
    secrets: () => [SECRET],
    store,
    storage,
    processors: [
      async (u) => {
        state.processorCalls.push(`rc:${u}`);
        return { done: true };
      },
      async () => ({ done: false, reason: 'not_configured' }),
    ],
    email: async (e) => {
      state.emails.push(e);
      return { sent: true };
    },
    now: () => NOW,
  });
  return { handler, state };
}

const call = (
  handler: (r: Request) => Promise<Response>,
  body: unknown,
  opts: { jwt?: string; key?: string | null; path?: string; secret?: string } = {},
) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.secret) headers['x-internal-secret'] = opts.secret;
  else headers.authorization = `Bearer ${opts.jwt ?? `${USER}:60`}`;
  if (opts.key !== null && !opts.secret)
    headers['idempotency-key'] = opts.key ?? crypto.randomUUID();
  return handler(
    new Request(`http://localhost/account-delete${opts.path ?? ''}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
};

Deno.test(
  'account-delete: request schedules deletion 30 days out and warns about store subscriptions',
  async () => {
    const { handler, state } = setup({ subscription: true });
    const res = await call(handler, { action: 'request', confirm: 'DELETE', reason: 'privacy' });
    assertEquals(res.status, 200);
    const body = AccountDeleteResponse.parse(await res.json());
    assert(body.action === 'request');
    assertEquals(body.scheduled_for, '2026-11-05T08:00:00.000Z');
    assertEquals(body.active_subscription_warning, true);
    assertEquals(state.scheduled.get(USER)?.reason, 'privacy');
    // Other sessions are revoked with the caller's JWT ('others' scope), and the requested email goes out.
    assertEquals(state.revoked, [`${USER}:60`]);
    assertEquals(state.emails, [
      {
        kind: 'deletion_requested',
        to: '1@example.com',
        locale: 'en',
        timezone: 'Asia/Karachi',
        at: '2026-11-05T08:00:00.000Z',
      },
    ]);
    const again = await call(handler, { action: 'request', confirm: 'DELETE' });
    assertEquals((await again.json()).error.code, 'ACCOUNT_DELETION_PENDING');
  },
);

Deno.test(
  'account-delete: request needs a sign-in no older than 300 s and an Idempotency-Key',
  async () => {
    const { handler } = setup();
    const stale = await call(
      handler,
      { action: 'request', confirm: 'DELETE' },
      { jwt: `${USER}:301` },
    );
    assertEquals(stale.status, 401);
    const err = (await stale.json()).error;
    assertEquals(err.code, 'UNAUTHENTICATED');
    assertEquals(err.details.reauth, true);
    const nokey = await call(handler, { action: 'request', confirm: 'DELETE' }, { key: null });
    assertEquals((await nokey.json()).error.code, 'VALIDATION_FAILED');
    const noconfirm = await call(handler, { action: 'request', confirm: 'delete' });
    assertEquals((await noconfirm.json()).error.code, 'VALIDATION_FAILED');
    const immediate = await call(handler, {
      action: 'request',
      confirm: 'DELETE',
      immediate: true,
      reason: 'privacy',
    });
    assertEquals((await immediate.json()).error.code, 'VALIDATION_FAILED');
  },
);

Deno.test(
  'account-delete: an owner of a shared household must transfer ownership first',
  async () => {
    const { handler } = setup({ blocked: true });
    const res = await call(handler, { action: 'request', confirm: 'DELETE' });
    const err = (await res.json()).error;
    assertEquals(err.code, 'OWNERSHIP_TRANSFER_REQUIRED');
    assertEquals(err.details.households, [HH]);
  },
);

Deno.test('account-delete: cancel inside the grace period, then nothing to cancel', async () => {
  const { handler, state } = setup();
  await call(handler, { action: 'request', confirm: 'DELETE' });
  // Cancel needs no recent re-auth.
  const res = await call(handler, { action: 'cancel' }, { jwt: `${USER}:99999` });
  assertEquals(await res.json(), { action: 'cancel', cancelled: true });
  assertEquals(state.scheduled.size, 0);
  assertEquals(
    state.emails.map((e) => e.kind),
    ['deletion_requested', 'deletion_cancelled'],
  );
  const again = await call(handler, { action: 'cancel' });
  const err = (await again.json()).error;
  assertEquals(err.code, 'CONFLICT');
  assertEquals(err.details.reason, 'not_pending');
});

Deno.test('account-delete: under-age decline erases immediately', async () => {
  const { handler, state } = setup();
  const res = await call(handler, {
    action: 'request',
    confirm: 'DELETE',
    immediate: true,
    reason: 'under_age',
  });
  const body = await res.json();
  assertEquals(body.scheduled_for, NOW.toISOString());
  assertEquals(state.erased, [USER]);
  assertEquals(state.authDeleted, [USER]);
  // No grace period: no "requested" email and no revocation (the auth user is gone), only "completed".
  assertEquals(
    state.emails.map((e) => e.kind),
    ['deletion_completed'],
  );
  assertEquals(state.revoked, []);
});

Deno.test('account-delete: revocation or email failures never fail the request', async () => {
  const { handler, state } = setup({ revokeFails: true });
  const res = await call(handler, { action: 'request', confirm: 'DELETE' });
  assertEquals(res.status, 200);
  assertEquals(state.emails.length, 1);
});

Deno.test('account-delete: REAUTH_REQUIRED for clients that declare the capability', async () => {
  const { handler } = setup();
  const res = await handler(
    new Request('http://localhost/account-delete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${USER}:301`,
        'idempotency-key': crypto.randomUUID(),
        'x-thuluth-client-caps': 'reauth_required',
      },
      body: JSON.stringify({ action: 'request', confirm: 'DELETE' }),
    }),
  );
  assertEquals(res.status, 401);
  const err = (await res.json()).error;
  assertEquals(err.code, 'REAUTH_REQUIRED');
  assertEquals(err.details.reauth, true);
});

Deno.test(
  'account-delete: /execute erases due users, removes storage and processors, then auth',
  async () => {
    const { handler, state } = setup();
    state.scheduled.set(USER, { at: '2026-10-01T00:00:00.000Z', reason: null });
    state.scheduled.set(OTHER, { at: '2026-12-01T00:00:00.000Z', reason: null });
    assertEquals(
      (await call(handler, {}, { path: '/execute', secret: 'wrong-secret-value' })).status,
      401,
    );
    const res = await call(handler, {}, { path: '/execute', secret: SECRET });
    assertEquals(await res.json(), { deleted_users: 1, failures: 0 });
    assertEquals(state.erased, [USER]);
    assertEquals(state.authDeleted, [USER]);
    assertEquals(state.processorCalls, [`rc:${USER}`]);
    // The completed email uses the address read before erasure.
    assertEquals(state.emails, [
      { kind: 'deletion_completed', to: '1@example.com', locale: 'en', timezone: 'Asia/Karachi' },
    ]);
    assert(!(state.objects.get('meal-photos') ?? []).some((o) => o.path.startsWith(`${HH}/`)));
    assert(state.scheduled.has(OTHER));
  },
);

Deno.test('account-delete: a failed erasure is counted and the user stays due', async () => {
  const { handler, state } = setup({ erasureFails: true });
  state.scheduled.set(USER, { at: '2026-10-01T00:00:00.000Z', reason: null });
  const res = await call(handler, {}, { path: '/execute', secret: SECRET });
  assertEquals(await res.json(), { deleted_users: 0, failures: 1 });
  assertEquals(state.authDeleted, []);
});

Deno.test('account-delete: sweep_orphans removes objects whose owners are gone', async () => {
  const { handler, state } = setup();
  const res = await call(handler, { action: 'sweep_orphans' }, { secret: SECRET });
  const body = await res.json();
  assertEquals(body.removed['meal-photos'], 2); // gone household + unreferenced photo
  assertEquals(body.removed['chat-attachments'], 1);
  assertEquals(body.removed.exports, 0); // account zips are not household-scoped
  const photos = (state.objects.get('meal-photos') ?? []).map((o) => o.path);
  assert(photos.includes(`${HH}/${MEMBER}/2026/09/a.jpg`));
  assert(photos.includes(`${HH}/${MEMBER}/2026/10/fresh.jpg`)); // younger than 24 h
});

Deno.test('assertRecentAuth and DB error mapping', () => {
  assertRecentAuth(
    { userId: USER, jwt: 'x', amr: [{ method: 'otp', timestamp: nowSec - 10 }] },
    300,
    NOW,
  );
  let threw = false;
  try {
    assertRecentAuth({ userId: USER, jwt: 'x' }, 300, NOW);
  } catch (e) {
    threw = e instanceof HttpError && e.code === 'UNAUTHENTICATED';
  }
  assert(threw);
  assertEquals(
    fromPostgrestError({ message: 'GROWTH_RULE:adult_member', code: 'P0001' }).code,
    'GROWTH_REFERENCE_OUT_OF_RANGE',
  );
  assertEquals(
    fromPostgrestError({ message: 'MEASUREMENT_BEFORE_BIRTH', code: '23514' }).code,
    'VALIDATION_FAILED',
  );
  assertEquals(
    fromPostgrestError({ message: 'ACCOUNT_DELETION_IN_PROGRESS', code: 'P0001' }).details.reason,
    'in_progress',
  );
  assertEquals(fromPostgrestError({ message: 'NOT_FOUND', code: 'P0002' }).code, 'NOT_FOUND');
});
