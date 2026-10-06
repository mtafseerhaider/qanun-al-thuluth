import { assertEquals } from 'jsr:@std/assert@1';
import { HealthResponse } from '@thuluth/shared/contracts/health.ts';

import { createHealthHandler } from '../../functions/health/handler.ts';
import type { OpsHealth } from '../../functions/health/store.ts';

const NOW = new Date('2027-02-01T03:00:00Z');
const OK: OpsHealth = {
  feature_flags: 12,
  maintenance: false,
  stale_pushes: 0,
  cron_failures_1h: 0,
};

function handler(ops: () => Promise<OpsHealth>, timeoutMs = 50, cacheMs = 0, now = () => NOW) {
  return createHealthHandler({
    store: { opsHealth: ops },
    env: 'production',
    release: 'abc1234',
    now,
    timeoutMs,
    cacheMs,
  });
}
const get = (h: (r: Request) => Promise<Response>, method = 'GET') =>
  h(new Request('http://localhost/health', { method }));

Deno.test('health: ok when every check passes, never cached', async () => {
  const res = await get(handler(async () => OK));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('cache-control'), 'no-store');
  const body = HealthResponse.parse(await res.json());
  assertEquals(body.status, 'ok');
  assertEquals(body.checks, { database: 'ok', feature_flags: 'ok', cron: 'ok', maintenance: 'ok' });
  assertEquals(body.release, 'abc1234');
  assertEquals(body.env, 'production');
});

Deno.test('health: degraded (200) on cron failures, stuck pushes or maintenance', async () => {
  for (const ops of [
    { ...OK, cron_failures_1h: 2 },
    { ...OK, stale_pushes: 3, cron_failures_1h: null },
    { ...OK, maintenance: true },
    { ...OK, feature_flags: 0 },
  ]) {
    const res = await get(handler(async () => ops));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).status, 'degraded');
  }
  const noCron = await (await get(handler(async () => ({ ...OK, cron_failures_1h: null })))).json();
  assertEquals(noCron.checks.cron, 'skipped');
  assertEquals(noCron.status, 'ok');
});

Deno.test(
  'health: down (503) when the database fails or is slow, without error details',
  async () => {
    const failed = await get(
      handler(async () => {
        throw new Error('connection refused to db.internal:5432');
      }),
    );
    assertEquals(failed.status, 503);
    const text = await failed.text();
    assertEquals(text.includes('5432'), false);
    assertEquals(JSON.parse(text).status, 'down');
    const slow = await get(handler(() => new Promise((r) => setTimeout(() => r(OK), 200)), 10));
    assertEquals(slow.status, 503);
    await slow.body?.cancel();
  },
);

Deno.test('health: HEAD and OPTIONS are supported, other methods are not', async () => {
  const h = handler(async () => OK);
  const head = await get(h, 'HEAD');
  assertEquals(head.status, 200);
  assertEquals(await head.text(), '');
  assertEquals((await get(h, 'OPTIONS')).status, 204);
  assertEquals((await get(h, 'POST')).status, 405);
});

Deno.test('health: the database probe is cached per isolate (public endpoint)', async () => {
  let calls = 0;
  let t = NOW.getTime();
  const h = handler(
    async () => {
      calls++;
      return OK;
    },
    50,
    20_000,
    () => new Date(t),
  );
  await Promise.all([get(h), get(h), get(h)].map(async (p) => (await p).body?.cancel()));
  t += 19_000;
  await (await get(h)).body?.cancel();
  assertEquals(calls, 1);
  t += 2_000;
  await (await get(h)).body?.cancel();
  assertEquals(calls, 2);
});
