import { assertEquals } from 'jsr:@std/assert@1';

import {
  cachedMaintenanceProbe,
  isInternalRequest,
  MAINTENANCE_FLAG,
  withMaintenance,
} from '../../functions/_shared/maintenance.ts';

const ok = async () => Response.json({ ok: true });
const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/functions/v1${path}`, { method: 'POST', headers, body: '{}' });

Deno.test('maintenance: off passes the request through', async () => {
  let calls = 0;
  const h = withMaintenance(
    async () => (calls++, await ok()),
    async () => false,
  );
  const res = await h(post('/grocery-generate'));
  assertEquals(res.status, 200);
  assertEquals(calls, 1);
});

Deno.test('maintenance: on answers 503 FEATURE_DISABLED with reason maintenance', async () => {
  let calls = 0;
  const h = withMaintenance(
    async () => (calls++, await ok()),
    async () => true,
  );
  const res = await h(post('/ai-chat', { 'x-request-id': 'req-1' }));
  assertEquals(res.status, 503);
  assertEquals(res.headers.get('x-request-id'), 'req-1');
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assertEquals(body.error.code, 'FEATURE_DISABLED');
  assertEquals(body.error.details, {
    reason: 'maintenance',
    flag: MAINTENANCE_FLAG,
    request_id: 'req-1',
  });
  assertEquals(calls, 0);
});

Deno.test('maintenance: preflight and internal calls still run', async () => {
  let calls = 0;
  const h = withMaintenance(
    async () => (calls++, await ok()),
    async () => true,
  );
  const preflight = await h(
    new Request('http://localhost/functions/v1/ai-chat', { method: 'OPTIONS' }),
  );
  assertEquals(preflight.status, 200);
  for (const req of [
    post('/ai-generate-plan/worker'),
    post('/account-delete/execute/'),
    post('/export-pdf', { 'x-internal-secret': 'anything' }),
  ]) {
    assertEquals(isInternalRequest(req), true);
    assertEquals((await h(req)).status, 200);
  }
  assertEquals(isInternalRequest(post('/ai-generate-plan')), false);
  assertEquals(calls, 4);
});

Deno.test('maintenance: the flag lookup is cached per isolate and shared', async () => {
  let reads = 0;
  let t = 0;
  let on = false;
  const probe = cachedMaintenanceProbe(async () => (reads++, on), { ttlMs: 15_000, now: () => t });
  assertEquals(await Promise.all([probe(), probe()]), [false, false]);
  on = true;
  t = 14_000;
  assertEquals(await probe(), false);
  assertEquals(reads, 1);
  t = 15_000;
  assertEquals(await probe(), true);
  assertEquals(reads, 2);
});

Deno.test('maintenance: a failed lookup fails open and is cached', async () => {
  let reads = 0;
  const err = console.error;
  console.error = () => {};
  try {
    const probe = cachedMaintenanceProbe(
      async () => {
        reads++;
        throw new Error('db down');
      },
      { now: () => 0 },
    );
    assertEquals(await probe(), false);
    assertEquals(await probe(), false);
    assertEquals(reads, 1);
  } finally {
    console.error = err;
  }
});
