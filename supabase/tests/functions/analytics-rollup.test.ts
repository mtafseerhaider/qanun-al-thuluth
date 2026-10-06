import { assertEquals } from 'jsr:@std/assert@1';

import { createAnalyticsRollupHandler } from '../../functions/analytics-rollup/handler.ts';
import type { AnalyticsStore } from '../../functions/analytics-rollup/store.ts';

const SECRET = 'cron-secret-for-tests';
const NOW = new Date('2026-10-06T08:10:00Z');

function setup(o: { defaultRows?: number; cost?: number; stale?: number } = {}) {
  const calls: string[] = [];
  const store: AnalyticsStore = {
    refresh: async (scope) => {
      calls.push(`refresh:${scope}`);
      return scope === 'daily' ? ['mv_dau', 'mv_family_weekly_summary'] : ['mv_dau'];
    },
    maintainPartitions: async () => {
      calls.push('partitions');
      return { created: ['analytics_events_y2027m01'], detached: ['analytics_events_y2025m09'] };
    },
    defaultPartitionRows: async () => o.defaultRows ?? 0,
    aiCostUsdSince: async (since) => {
      calls.push(`cost:${since}`);
      return o.cost ?? 3.2;
    },
    stalePushes: async () => o.stale ?? 0,
  };
  const handler = createAnalyticsRollupHandler({ secrets: () => [SECRET], store, now: () => NOW });
  const call = (body: unknown, secret = SECRET) =>
    handler(
      new Request('http://localhost/analytics-rollup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify(body),
      }),
    );
  return { call, calls };
}

Deno.test('analytics-rollup: hourly refreshes event views only', async () => {
  const { call, calls } = setup();
  const body = await (await call({})).json();
  assertEquals(body.refreshed, ['mv_dau']);
  assertEquals(body.partitions_created, []);
  assertEquals(body.alerts_raised, []);
  assertEquals(calls, ['refresh:hourly', 'cost:2026-10-06T00:00:00.000Z']);
});

Deno.test('analytics-rollup: daily also maintains partitions', async () => {
  const { call } = setup();
  const body = await (await call({ scope: 'daily' })).json();
  assertEquals(body.refreshed.length, 2);
  assertEquals(body.partitions_created, ['analytics_events_y2027m01']);
  assertEquals(body.partitions_detached, ['analytics_events_y2025m09']);
});

Deno.test('analytics-rollup: raises alerts and refuses callers without the secret', async () => {
  const { call } = setup({ defaultRows: 3, cost: 75, stale: 2 });
  const body = await (await call({})).json();
  assertEquals(body.alerts_raised, [
    'analytics_default_partition_not_empty',
    'ai_cost_daily_high',
    'push_lag',
  ]);
  assertEquals((await call({}, 'not-the-secret-123')).status, 401);
  assertEquals((await (await call({ scope: 'weekly' })).json()).error.code, 'VALIDATION_FAILED');
});
