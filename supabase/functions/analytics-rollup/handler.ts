import {
  AnalyticsRollupRequest,
  AnalyticsRollupResponse,
} from '@thuluth/shared/contracts/analytics-rollup.ts';

import { requireInternal } from '../_shared/auth.ts';
import type { InternalSecrets } from '../_shared/auth.ts';
import { jsonHandler } from '../_shared/http.ts';
import type { AnalyticsStore } from './store.ts';

/** Daily AI spend that raises `ai_cost_daily_high` (USD); `AI_DAILY_COST_ALERT_USD` overrides. */
export const DEFAULT_AI_COST_ALERT_USD = 50;
/** Pushes pending longer than this past their due time raise `push_lag`. */
export const PUSH_LAG_MINUTES = 10;

export interface AnalyticsRollupDeps {
  secrets: InternalSecrets;
  store: AnalyticsStore;
  aiCostAlertUsd?: number;
  now?: () => Date;
}

/**
 * 06 §4.17 `analytics-rollup` (S6-13, FR-ANL-03, -05). Internal cron: hourly refreshes the
 * event-driven materialized views, nightly (`daily`) refreshes all of them and maintains the
 * `analytics_events` partitions (create ahead, drop past 13 months). Each run checks three alerts,
 * reported in `alerts_raised` and logged at `warn` for Sentry log alerts: rows landing in the
 * default partition, AI spend today above the threshold, and push notifications stuck pending.
 * Refreshing is idempotent, so a retried run is harmless.
 */
export function createAnalyticsRollupHandler(deps: AnalyticsRollupDeps) {
  const now = deps.now ?? (() => new Date());
  const threshold = deps.aiCostAlertUsd ?? DEFAULT_AI_COST_ALERT_USD;
  return jsonHandler(AnalyticsRollupRequest, async ({ req, input, requestId }) => {
    requireInternal(req, deps.secrets);
    const started = Date.now();
    const at = now();
    const refreshed = await deps.store.refresh(input.scope);
    const partitions =
      input.scope === 'daily'
        ? await deps.store.maintainPartitions()
        : { created: [], detached: [] };

    const alerts: string[] = [];
    if ((await deps.store.defaultPartitionRows()) > 0)
      alerts.push('analytics_default_partition_not_empty');
    const dayStart = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
    ).toISOString();
    const cost = await deps.store.aiCostUsdSince(dayStart);
    if (cost > threshold) alerts.push('ai_cost_daily_high');
    const stale = await deps.store.stalePushes(
      new Date(at.getTime() - PUSH_LAG_MINUTES * 60_000).toISOString(),
    );
    if (stale > 0) alerts.push('push_lag');

    const body = AnalyticsRollupResponse.parse({
      refreshed,
      partitions_created: partitions.created,
      partitions_detached: partitions.detached,
      alerts_raised: alerts,
      duration_ms: Date.now() - started,
    });
    console.log(
      JSON.stringify({
        level: alerts.length ? 'warn' : 'info',
        scope: 'analytics-rollup',
        request_id: requestId,
        ...body,
        ai_cost_usd_today: Math.round(cost * 100) / 100,
        stale_pushes: stale,
      }),
    );
    return body;
  });
}
