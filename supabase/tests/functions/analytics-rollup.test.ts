import { assert, assertEquals } from 'jsr:@std/assert@1';

import { createAnalyticsRollupHandler } from '../../functions/analytics-rollup/handler.ts';
import type { AnalyticsStore, KpiSnapshot } from '../../functions/analytics-rollup/store.ts';

const SECRET = 'cron-secret-for-tests';
const NOW = new Date('2026-10-06T08:10:00Z');

function setup(
  o: {
    defaultRows?: number;
    cost?: number;
    stale?: number;
    kpis?: Record<string, number | null>;
    kpiFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const snapshots: KpiSnapshot[] = [];
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
    launchKpis: async (since, until) => {
      calls.push(`kpis:${since}..${until}`);
      if (o.kpiFails) throw new Error('rpc down');
      return o.kpis ?? { notifications_due: 0, notification_on_time_rate: null };
    },
    saveSnapshots: async (rows) => {
      snapshots.push(...rows);
    },
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
  return { call, calls, snapshots };
}

Deno.test('analytics-rollup: hourly refreshes event views only', async () => {
  const { call, calls } = setup();
  const body = await (await call({})).json();
  assertEquals(body.refreshed, ['mv_dau']);
  assertEquals(body.partitions_created, []);
  assertEquals(body.alerts_raised, []);
  assertEquals(calls, [
    'refresh:hourly',
    'cost:2026-10-06T00:00:00.000Z',
    'kpis:2026-10-06T07:10:00.000Z..2026-10-06T08:10:00.000Z',
  ]);
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

Deno.test(
  'analytics-rollup: hourly KPI check raises only the push on-time alert, with enough samples',
  async () => {
    const kpis = {
      notifications_due: 50,
      notification_on_time_rate: 0.9,
      plan_generation_calls: 50,
      plan_generation_success_rate: 0.5,
    };
    const body = await (await setup({ kpis }).call({})).json();
    assertEquals(body.alerts_raised, ['kpi_notification_on_time_low']);
    assertEquals(body.kpis.notification_on_time_rate, 0.9);
    const quiet = await (
      await setup({ kpis: { notifications_due: 5, notification_on_time_rate: 0.2 } }).call({})
    ).json();
    assertEquals(quiet.alerts_raised, []);
  },
);

Deno.test('analytics-rollup: daily checks every launch gate and stores KPI snapshots', async () => {
  const { call, snapshots, calls } = setup({
    kpis: {
      notifications_due: 500,
      notification_on_time_rate: 0.995,
      plan_generation_calls: 100,
      plan_generation_success_rate: 0.9,
      active_users: 200,
      ai_cost_per_active_premium_user_week_usd: 0.5,
      signups: 100,
      onboarding_completion_rate: 0.7,
      households_past_week1: 10, // below the sample floor: no activation alert
      activation_rate: 0.1,
      median_minutes_to_first_plan: null,
    },
  });
  const body = await (await call({ scope: 'daily' })).json();
  assertEquals(body.alerts_raised, [
    'kpi_plan_generation_success_low',
    'kpi_ai_cost_per_active_user_high',
  ]);
  assert(calls.includes('kpis:2026-09-29T08:10:00.000Z..2026-10-06T08:10:00.000Z'));
  assertEquals(snapshots.length, 10); // nulls are not stored
  assertEquals(snapshots[0], {
    metric: 'kpi.notifications_due',
    period_start: '2026-09-29',
    period_end: '2026-10-05',
    value: 500,
  });
});

Deno.test('analytics-rollup: a failing KPI query never fails the rollup', async () => {
  const res = await setup({ kpiFails: true }).call({});
  assertEquals(res.status, 200);
  assertEquals((await res.json()).kpis, undefined);
});
