import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient } from '../_shared/clients.ts';
import { createAnalyticsRollupHandler } from './handler.ts';
import { supabaseAnalyticsStore } from './store.ts';

const threshold = Number(Deno.env.get('AI_DAILY_COST_ALERT_USD'));

Deno.serve(
  createAnalyticsRollupHandler({
    secrets: internalSecretsFromEnv,
    store: supabaseAnalyticsStore(adminClient()),
    ...(Number.isFinite(threshold) && threshold > 0 ? { aiCostAlertUsd: threshold } : {}),
  }),
);
